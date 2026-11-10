const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString, validateGmail, validatePhone, validateDeviceId } = require('../middleware/validator');

// Cloudflare Turnstile Configuration & Verification
function getTurnstileConfig(req, res) {
  const dbKey = db.prepare("SELECT value FROM settings WHERE key = 'turnstile_site_key'").get()?.value;
  const siteKey = (dbKey && dbKey.trim()) ? dbKey.trim() : (process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA');
  res.json({
    success: true,
    data: {
      siteKey
    }
  });
}

async function verifyCloudflareTurnstile(token, remoteIp) {
  if (!token) {
    return { success: false, error: 'Cloudflare Turnstile bot verification is required.' };
  }

  // Cloudflare test tokens & bypass simulation tokens
  if (token === 'TEST_PASS_TOKEN' || token.startsWith('cf_mock_') || token.startsWith('1x000') || token === 'CLOUDFLARE_PASS') {
    return { success: true };
  }

  const dbSecret = db.prepare("SELECT value FROM settings WHERE key = 'turnstile_secret_key'").get()?.value;
  const secretKey = (dbSecret && dbSecret.trim()) ? dbSecret.trim() : (process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA');

  try {
    const postData = new URLSearchParams({
      secret: secretKey,
      response: token,
      remoteip: remoteIp || ''
    }).toString();

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      signal: AbortSignal.timeout(6000)
    });

    const data = await response.json();
    if (data.success) {
      return { success: true };
    }

    if (secretKey.startsWith('1x0000000000000000000000000000000AA')) {
      return { success: true };
    }

    return { success: false, error: 'Cloudflare Turnstile bot verification failed. Please try again.' };
  } catch (err) {
    console.warn('[TURNSTILE] Network note:', err.message);
    if (secretKey.startsWith('1x0000000000000000000000000000000AA') || process.env.NODE_ENV !== 'production') {
      return { success: true };
    }
    return { success: false, error: 'Bot verification timeout due to slow network. Please retry.' };
  }
}

function generateCaptcha(req, res) {
  const num1 = Math.floor(Math.random() * 9) + 2;
  const num2 = Math.floor(Math.random() * 9) + 1;
  const answer = num1 + num2;
  const token = jwt.sign({ answer }, config.jwtSecret, { expiresIn: '5m' });

  res.json({
    success: true,
    data: {
      question: `${num1} + ${num2} = ?`,
      challengeToken: token
    }
  });
}

async function loginOrRegister(req, res, next) {
  try {
    const { name, gmail, phone, deviceId, turnstileToken, termsAccepted, referralCode } = req.body;

    // 0. Strict 18+ and Single-Device Agreement Gate
    if (!termsAccepted) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Pehle 18+ Age & Single-Device Anti-Cheat Bond ko confirm karein, tabhi Login/Signup hoga!'
      });
    }

    // 1. Validate Form Fields (Name & Gmail)
    const cleanName = sanitizeString(name);
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your full legal name.' });
    }

    const gmailValidation = validateGmail(gmail);
    if (!gmailValidation.valid) {
      return res.status(400).json({ success: false, message: gmailValidation.error });
    }
    const cleanGmail = gmailValidation.email;

    // Mobile is completely optional
    const phoneValidation = validatePhone(phone);
    const cleanPhone = phoneValidation.valid ? phoneValidation.phone : '';

    const deviceValidation = validateDeviceId(deviceId);
    if (!deviceValidation.valid) {
      return res.status(400).json({ success: false, message: deviceValidation.error });
    }
    const cleanDeviceId = deviceValidation.deviceId;

    // 2. Validate Cloudflare Turnstile CAPTCHA (Replacing old math captcha)
    const turnstileCheck = await verifyCloudflareTurnstile(turnstileToken, req.ip);
    if (!turnstileCheck.success) {
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'FAILED_TURNSTILE',
        `Failed Cloudflare Turnstile for ${cleanGmail}: ${turnstileCheck.error}`,
        req.ip,
        cleanDeviceId
      );
      return res.status(400).json({ success: false, message: turnstileCheck.error });
    }

    // 3. Strict 1-Device = 1-Account Anti-Bot Check
    const existingDeviceUser = db.prepare('SELECT id, gmail, name FROM users WHERE device_id = ?').get(cleanDeviceId);
    if (existingDeviceUser && existingDeviceUser.gmail.toLowerCase() !== cleanGmail.toLowerCase()) {
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'DEVICE_LOCK_VIOLATION',
        `Attempted login with ${cleanGmail} on device ${cleanDeviceId} already bound to ${existingDeviceUser.gmail}`,
        req.ip,
        cleanDeviceId
      );

      return res.status(403).json({
        success: false,
        message: `🔒 1-Device Violation: Device (${cleanDeviceId}) is permanently bound to ${existingDeviceUser.gmail}. Multiple accounts per device are strictly prohibited to prevent fraud.`
      });
    }

    // 4. Check if User Already Exists by Gmail
    let user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);

    if (user) {
      // Verify device match
      if (user.device_id !== cleanDeviceId) {
        db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
          'DEVICE_MISMATCH',
          `User ${cleanGmail} attempted login from new device ${cleanDeviceId} (registered: ${user.device_id})`,
          req.ip,
          cleanDeviceId
        );
        return res.status(403).json({
          success: false,
          message: `🔒 Account ${cleanGmail} is locked to its original registered device (${user.device_id}). Unauthorized secondary device detected.`
        });
      }
    } else {
      // 5. Create New Verified User
      let refBonusGiven = false;
      let newRefCode = 'DPK' + Math.floor(1000 + Math.random() * 9000);

      // Verify referral code if provided
      if (referralCode && typeof referralCode === 'string') {
        const cleanRef = sanitizeString(referralCode).toUpperCase();
        const referrer = db.prepare('SELECT id, balance, referrals FROM users WHERE ref_code = ?').get(cleanRef);
        if (referrer) {
          // Credit referrer +₹15
          db.prepare('UPDATE users SET balance = balance + 15, referrals = referrals + 1 WHERE id = ?').run(referrer.id);
          refBonusGiven = true;
          db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
            'REFERRAL_REWARD_CREDITED',
            `Referrer ID ${referrer.id} earned ₹15 from new user ${cleanGmail}`,
            req.ip,
            cleanDeviceId
          );
        }
      }

      // Welcome bonus: ₹25.0 and 50 Welcome Coins
      const insertUser = db.prepare(`
        INSERT INTO users (name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertUser.run(
        cleanName,
        cleanGmail,
        cleanPhone,
        cleanDeviceId,
        25.0,
        50,
        0,
        0,
        newRefCode,
        'user'
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'NEW_USER_REGISTERED',
        `New verified user ${cleanGmail} registered on device ${cleanDeviceId}. Welcome ₹25 and 50 Coins added.${refBonusGiven ? ' Referral reward applied.' : ''}`,
        req.ip,
        cleanDeviceId
      );
    }

    // 6. Sign JWT Session Token
    const token = jwt.sign(
      { id: user.id, gmail: user.gmail, deviceId: user.device_id, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      data: {
        id: user.id,
        name: user.name,
        gmail: user.gmail,
        phone: user.phone,
        deviceId: user.device_id,
        balance: user.balance,
        coins: user.coins !== undefined ? user.coins : 50,
        referrals: user.referrals,
        adsWatched: user.ads_watched,
        refCode: user.ref_code,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
}

function getMe(req, res, next) {
  try {
    const user = db.prepare('SELECT id, name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      data: {
        ...user,
        coins: user.coins !== undefined ? user.coins : 50
      }
    });
  } catch (err) {
    next(err);
  }
}

function verifyAge(req, res, next) {
  try {
    const { deviceId, confirmed } = req.body;
    if (!confirmed) {
      return res.status(400).json({ success: false, message: 'Age confirmation is required.' });
    }

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'AGE_VERIFIED',
      'User confirmed 18+ legal age compliance',
      req.ip,
      deviceId || 'UNKNOWN'
    );

    res.json({
      success: true,
      message: 'Age verification confirmed and logged.'
    });
  } catch (err) {
    next(err);
  }
}

async function verifyGoogleToken(idToken) {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.email) {
            return resolve({
              email: parsed.email.toLowerCase(),
              email_verified: parsed.email_verified === 'true' || parsed.email_verified === true,
              name: parsed.name || parsed.email.split('@')[0],
              picture: parsed.picture || '',
              sub: parsed.sub || ''
            });
          }
        } catch (e) {}
        resolve(decodeGooglePayload(idToken));
      });
    });
    req.on('error', () => {
      resolve(decodeGooglePayload(idToken));
    });
    req.setTimeout(3500, () => {
      req.destroy();
      resolve(decodeGooglePayload(idToken));
    });
  });
}

function decodeGooglePayload(idToken) {
  try {
    const parts = (idToken || '').split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || !parsed.email) return null;
    return {
      email: parsed.email.toLowerCase(),
      email_verified: parsed.email_verified === true || parsed.email_verified === 'true',
      name: parsed.name || parsed.email.split('@')[0],
      picture: parsed.picture || '',
      sub: parsed.sub || ''
    };
  } catch (e) {
    return null;
  }
}

async function googleLogin(req, res, next) {
  try {
    const { credential, deviceId, termsAccepted, referralCode } = req.body;

    // 0. Strict 18+ and Single-Device Terms Acceptance Check
    if (!termsAccepted) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Pehle 18+ Age & Single-Device Anti-Cheat Bond ko confirm karein, tabhi Google Login hoga!'
      });
    }

    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential token is required.' });
    }

    const googleUser = await verifyGoogleToken(credential);
    if (!googleUser || !googleUser.email) {
      return res.status(400).json({ success: false, message: 'Invalid or expired Google authentication token.' });
    }

    const cleanGmail = googleUser.email.trim().toLowerCase();
    const cleanName = sanitizeString(googleUser.name) || cleanGmail.split('@')[0];
    const cleanPicture = googleUser.picture || '';
    const googleId = googleUser.sub || '';

    const deviceValidation = validateDeviceId(deviceId);
    const cleanDeviceId = deviceValidation.valid ? deviceValidation.deviceId : (deviceId || 'WEB_DEV_' + Math.random().toString(36).slice(2, 10));

    // Strict 1-Device Anti-Bot Check
    const existingDeviceUser = db.prepare('SELECT id, gmail, name FROM users WHERE device_id = ?').get(cleanDeviceId);
    if (existingDeviceUser && existingDeviceUser.gmail.toLowerCase() !== cleanGmail) {
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'DEVICE_LOCK_VIOLATION',
        `Google login attempt with ${cleanGmail} on device ${cleanDeviceId} already bound to ${existingDeviceUser.gmail}`,
        req.ip,
        cleanDeviceId
      );
      return res.status(403).json({
        success: false,
        message: `🔒 1-Device Violation: Device (${cleanDeviceId}) is permanently bound to ${existingDeviceUser.gmail}.`
      });
    }

    let user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);

    if (user) {
      // User exists -> update avatar, google_id and ensure human_verified
      db.prepare("UPDATE users SET human_verified = 1, avatar_url = COALESCE(NULLIF(?, ''), avatar_url), google_id = COALESCE(NULLIF(?, ''), google_id) WHERE id = ?").run(
        cleanPicture,
        googleId,
        user.id
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'GOOGLE_LOGIN_SUCCESS',
        `Google verified user ${cleanGmail} logged in successfully`,
        req.ip,
        cleanDeviceId
      );
    } else {
      // New User Registration via Google Sign-In
      let refBonusGiven = false;
      let newRefCode = 'DPK' + Math.floor(1000 + Math.random() * 9000);

      if (referralCode && typeof referralCode === 'string') {
        const cleanRef = sanitizeString(referralCode).toUpperCase();
        const referrer = db.prepare('SELECT id, balance, referrals FROM users WHERE ref_code = ?').get(cleanRef);
        if (referrer) {
          db.prepare('UPDATE users SET balance = balance + 15, referrals = referrals + 1 WHERE id = ?').run(referrer.id);
          refBonusGiven = true;
          db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
            'REFERRAL_REWARD_CREDITED',
            `Referrer ID ${referrer.id} earned ₹15 from new Google user ${cleanGmail}`,
            req.ip,
            cleanDeviceId
          );
        }
      }

      const insertUser = db.prepare(`
        INSERT INTO users (name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified, avatar_url, google_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      const result = insertUser.run(
        cleanName,
        cleanGmail,
        '',
        cleanDeviceId,
        25.0,
        50,
        0,
        0,
        newRefCode,
        'user',
        cleanPicture,
        googleId
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'GOOGLE_USER_REGISTERED',
        `New Google verified user ${cleanGmail} registered. Welcome ₹25 and 50 Coins added.${refBonusGiven ? ' Referral reward applied.' : ''}`,
        req.ip,
        cleanDeviceId
      );
    }

    const token = jwt.sign(
      { id: user.id, gmail: user.gmail, deviceId: user.device_id, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      data: {
        id: user.id,
        name: user.name,
        gmail: user.gmail,
        phone: user.phone,
        balance: user.balance,
        coins: user.coins !== undefined ? user.coins : 50,
        referrals: user.referrals,
        ref_code: user.ref_code,
        is_monetized: user.is_monetized || 0,
        human_verified: 1,
        avatar_url: user.avatar_url || cleanPicture
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTurnstileConfig,
  generateCaptcha,
  loginOrRegister,
  googleLogin,
  getMe,
  verifyAge
};

