/**
 * Auth controller — Google OAuth login, token refresh, logout.
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const config = require('../../config');
const coins = require('../../config/coins');
const disposableDomains = require('../../config/disposable-domains');
const { pool, query } = require('../../db/pool');
const { normalizeGmail } = require('../utils/crypto');
const coinService = require('../services/coinService');
const referralService = require('../services/referralService');
const auditService = require('../services/auditService');

const googleClient = new OAuth2Client(config.googleClientId);

/* ── Helpers ─────────────────────────────────────────────── */

/** Generate a unique referral code: DPK + 8 random alphanumeric chars */
function generateReferralCode() {
  return 'DPK' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
}

/** Milliseconds string → ms value (e.g. "7d" → 604800000) */
function parseDuration(str) {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000; /* default 15 min */
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (multipliers[unit] || 60_000);
}

/** Set auth cookies on the response */
function setAuthCookies(res, accessToken, refreshToken) {
  const isProduction = config.nodeEnv === 'production';

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: parseDuration(config.jwtAccessExpiry),
    path: '/',
  });

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: parseDuration(config.jwtRefreshExpiry),
    path: '/api/auth', /* only sent to auth endpoints */
  });
}

/** Clear auth cookies */
function clearAuthCookies(res) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/api/auth' });
}

/** Create a JWT access token */
function createAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    config.jwtAccessSecret,
    { expiresIn: config.jwtAccessExpiry },
  );
}

/* ── Google Login ────────────────────────────────────────── */

async function googleLogin(req, res) {
  const { credential, deviceFingerprint, referralCode } = req.body;

  try {
    /* 1. Verify Google ID token */
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: config.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) {
      return res.status(401).json({ error: 'Email not verified by Google.' });
    }

    const { sub: googleId, email, name, picture } = payload;

    /* 2. Normalize email */
    const normalizedEmail = normalizeGmail(email);

    /* 3. Disposable domain check */
    const domain = normalizedEmail.split('@')[1];
    if (disposableDomains.has(domain)) {
      return res.status(403).json({ error: 'Disposable email addresses are not allowed.' });
    }

    /* 4. Upsert user */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      /* Try to find existing user */
      const existingResult = await client.query(
        'SELECT * FROM users WHERE google_id = $1 FOR UPDATE',
        [googleId],
      );

      let user;
      let isNewUser = false;

      if (existingResult.rows.length > 0) {
        /* Existing user — update mutable fields */
        user = existingResult.rows[0];

        if (user.is_banned) {
          await client.query('COMMIT');
          return res.status(403).json({ error: 'Account is suspended.' });
        }

        await client.query(
          `UPDATE users SET name = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3`,
          [name || user.name, picture || user.avatar_url, user.id],
        );
        user.name = name || user.name;
        user.avatar_url = picture || user.avatar_url;
      } else {
        /* New user */
        isNewUser = true;

        /* Generate unique referral code (retry on collision) */
        let refCode;
        let codeExists = true;
        while (codeExists) {
          refCode = generateReferralCode();
          const check = await client.query(
            'SELECT 1 FROM users WHERE referral_code = $1',
            [refCode],
          );
          codeExists = check.rows.length > 0;
        }

        /* Determine role (bootstrap initial admin) */
        const role =
          config.initialAdminGoogleId && googleId === config.initialAdminGoogleId
            ? 'admin'
            : 'user';

        /* Look up referrer if a referral code was provided */
        let referredBy = null;
        if (referralCode) {
          const referrerResult = await client.query(
            'SELECT id FROM users WHERE referral_code = $1 AND is_banned = FALSE',
            [referralCode],
          );
          if (referrerResult.rows.length > 0) {
            referredBy = referrerResult.rows[0].id;
          }
        }

        const insertResult = await client.query(
          `INSERT INTO users
             (google_id, email, normalized_email, name, avatar_url, role,
              referral_code, referred_by, device_fingerprint, registration_ip)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            googleId,
            email.toLowerCase(),
            normalizedEmail,
            name || 'User',
            picture || null,
            role,
            refCode,
            referredBy,
            deviceFingerprint,
            req.ip,
          ],
        );
        user = insertResult.rows[0];

        /* Credit signup bonus */
        await coinService.creditCoins(
          user.id,
          coins.signupBonus,
          'signup_bonus',
          `signup_${user.id}`,
          'Welcome signup bonus',
          client,
        );

        /* Process referral if applicable */
        if (referredBy) {
          try {
            await referralService.processReferralSignup(
              referredBy,
              user.id,
              deviceFingerprint,
              req.ip,
            );
          } catch (refErr) {
            /* Log but don't fail the signup */
            console.error('[auth] Referral processing error:', refErr.message);
          }
        }
      }

      /* 5. Record device fingerprint */
      await client.query(
        `INSERT INTO device_fingerprints (user_id, fingerprint, ip_address)
         VALUES ($1, $2, $3)`,
        [user.id, deviceFingerprint, req.ip],
      );

      /* 6. Create session */
      const rawRefreshToken = crypto.randomBytes(48).toString('hex');
      const refreshTokenHash = await bcrypt.hash(rawRefreshToken, 10);
      const expiresAt = new Date(Date.now() + parseDuration(config.jwtRefreshExpiry));

      await client.query(
        `INSERT INTO sessions (user_id, refresh_token_hash, device_fingerprint, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          user.id,
          refreshTokenHash,
          deviceFingerprint,
          req.ip,
          req.headers['user-agent'] || null,
          expiresAt.toISOString(),
        ],
      );

      await client.query('COMMIT');

      /* 7. Create access token */
      const accessToken = createAccessToken(user);

      /* 8. Set cookies */
      setAuthCookies(res, accessToken, rawRefreshToken);

      /* 9. Audit log */
      await auditService.logAudit(
        user.id,
        isNewUser ? 'signup' : 'login',
        'user',
        user.id,
        { provider: 'google', isNewUser },
        req.ip,
      );

      /* 10. Return safe user profile */
      return res.status(isNewUser ? 201 : 200).json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
          role: user.role,
          referralCode: user.referral_code,
          createdAt: user.created_at,
        },
        isNewUser,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[auth] Google login error:', err.message);
    return res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
}

/* ── Refresh Token ───────────────────────────────────────── */

async function refreshToken(req, res) {
  const rawToken = req.cookies && req.cookies.refresh_token;
  if (!rawToken) {
    return res.status(401).json({ error: 'No refresh token.', code: 'TOKEN_EXPIRED' });
  }

  try {
    /* Find all active sessions — we need to check hash matches */
    const sessionsResult = await query(
      `SELECT s.*, u.role, u.email, u.is_banned
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.revoked = FALSE AND s.expires_at > NOW()
       ORDER BY s.created_at DESC`,
    );

    let matchedSession = null;
    let matchedUser = null;

    for (const session of sessionsResult.rows) {
      const matches = await bcrypt.compare(rawToken, session.refresh_token_hash);
      if (matches) {
        matchedSession = session;
        matchedUser = { id: session.user_id, role: session.role, email: session.email };
        break;
      }
    }

    if (!matchedSession) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Invalid session.', code: 'TOKEN_EXPIRED' });
    }

    if (matchedSession.is_banned) {
      clearAuthCookies(res);
      return res.status(403).json({ error: 'Account is suspended.' });
    }

    /* Rotate: revoke old session, create new one */
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      /* Revoke old session */
      await client.query(
        'UPDATE sessions SET revoked = TRUE WHERE id = $1',
        [matchedSession.id],
      );

      /* Create new session */
      const newRawToken = crypto.randomBytes(48).toString('hex');
      const newHash = await bcrypt.hash(newRawToken, 10);
      const expiresAt = new Date(Date.now() + parseDuration(config.jwtRefreshExpiry));

      await client.query(
        `INSERT INTO sessions (user_id, refresh_token_hash, device_fingerprint, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          matchedUser.id,
          newHash,
          matchedSession.device_fingerprint,
          req.ip,
          req.headers['user-agent'] || null,
          expiresAt.toISOString(),
        ],
      );

      await client.query('COMMIT');

      /* New access token */
      const accessToken = createAccessToken(matchedUser);

      /* Set cookies */
      setAuthCookies(res, accessToken, newRawToken);

      return res.json({ message: 'Token refreshed.' });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[auth] Refresh error:', err.message);
    return res.status(500).json({ error: 'Token refresh failed.' });
  }
}

/* ── Logout ──────────────────────────────────────────────── */

async function logout(req, res) {
  try {
    /* Revoke ALL sessions for this user */
    await query(
      'UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
      [req.user.id],
    );

    clearAuthCookies(res);

    await auditService.logAudit(
      req.user.id,
      'logout',
      'user',
      req.user.id,
      null,
      req.ip,
    );

    return res.json({ message: 'Logged out.' });
  } catch (err) {
    console.error('[auth] Logout error:', err.message);
    return res.status(500).json({ error: 'Logout failed.' });
  }
}

/* ── Get Me ──────────────────────────────────────────────── */

async function getMe(req, res) {
  try {
    const result = await query(
      `SELECT id, email, name, avatar_url, role, referral_code, country_code, created_at
       FROM users WHERE id = $1`,
      [req.user.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        role: user.role,
        referralCode: user.referral_code,
        countryCode: user.country_code,
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('[auth] getMe error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch user.' });
  }
}

module.exports = { googleLogin, refreshToken, logout, getMe };
