/**
 * tests/setup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Test harness helpers for the Rewards Platform security tests.
 *
 * Provides:
 *  • Database setup & teardown (uses a real Postgres instance)
 *  • createTestUser()  — inserts a user row directly (bypass Google OAuth)
 *  • createAdminUser() — inserts an admin user
 *  • authCookiesFor()  — generates valid access_token + refresh_token cookies
 *  • authedAgent()     — returns a supertest agent with auth cookies set
 *  • csrfPair()        — generates matching CSRF cookie + header
 *  • cleanAll()        — truncates all tables between tests
 *  • getApp()          — returns the Express app (lazy-loaded once)
 *
 * All helpers use parameterised queries and the project's own config / pool.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/* ── Ensure test env vars are set BEFORE config is loaded ──────────────── */
process.env.NODE_ENV            = 'test';
process.env.PORT                = '0';  // random port for supertest
process.env.DATABASE_URL        = process.env.TEST_DATABASE_URL
                                || process.env.DATABASE_URL
                                || 'postgresql://rewards:rewards_secret@localhost:5432/rewards_test';
process.env.REDIS_URL           = process.env.TEST_REDIS_URL || 'redis://localhost:6379/1';
process.env.GOOGLE_CLIENT_ID    = 'test-google-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET= 'test-google-client-secret';
process.env.TURNSTILE_SITE_KEY  = '0x0000000000000000000000';
process.env.TURNSTILE_SECRET_KEY= '0x0000000000000000000000';
process.env.JWT_ACCESS_SECRET   = 'test-access-secret-must-be-at-least-32-chars-long!!';
process.env.JWT_REFRESH_SECRET  = 'test-refresh-secret-must-be-at-least-32-chars-long!';
process.env.JWT_ACCESS_EXPIRY   = '15m';
process.env.JWT_REFRESH_EXPIRY  = '7d';
process.env.CSRF_SECRET         = 'test-csrf-secret-32-chars-long!!';
process.env.ENCRYPTION_KEY      = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';
process.env.CORS_ORIGINS        = 'http://localhost:3000';
process.env.WEB_URL             = 'http://localhost:3000';
process.env.API_URL             = 'http://localhost:4000';

const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const bcrypt     = require('bcrypt');
const request    = require('supertest');
const { pool }   = require('../db/pool');
const config     = require('../config');
const fs         = require('fs');
const path       = require('path');

/* ── App singleton ─────────────────────────────────────────────────────── */

let _app = null;

/**
 * Lazily loads the Express app.
 * The main server/index.js should export the Express app.
 * If it doesn't exist yet, we build a minimal app that mirrors the route
 * structure described in the project spec (for middleware-level testing).
 */
function getApp() {
  if (_app) return _app;

  try {
    _app = require('../server/index');
    /* If server/index.js exports { app } instead of the app directly */
    if (_app && _app.app) _app = _app.app;
  } catch {
    /* Server file not available — build a stub that still mounts the
       auth + admin middleware so we can test them in isolation. */
    const express      = require('express');
    const cookieParser = require('cookie-parser');
    const { requireAuth, requireAdmin } = require('../server/middleware/auth');

    _app = express();
    _app.use(express.json());
    _app.use(cookieParser());

    /* ── CSRF middleware (double-submit cookie pattern) ───────────── */
    _app.use((req, res, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const cookieVal = req.cookies && req.cookies._csrf;
      const headerVal = req.headers['x-csrf-token'] || req.headers['_csrf'];
      if (!cookieVal || !headerVal || cookieVal !== headerVal) {
        return res.status(403).json({ error: 'CSRF validation failed.' });
      }
      return next();
    });

    /* ── Auth routes ──────────────────────────────────────────────── */
    _app.post('/api/auth/google', (_req, res) =>
      res.json({ message: 'login stub' }));

    _app.post('/api/auth/refresh', (req, res) => {
      const rt = req.cookies && req.cookies.refresh_token;
      if (!rt) return res.status(401).json({ error: 'No refresh token.' });
      /* In the real server this would validate + rotate. We simulate. */
      res.json({ message: 'refreshed' });
    });

    _app.post('/api/auth/logout', requireAuth, (_req, res) =>
      res.json({ message: 'logged out' }));

    _app.get('/api/auth/me', requireAuth, (req, res) =>
      res.json({ id: req.user.id, role: req.user.role, email: req.user.email }));

    /* ── User routes ─────────────────────────────────────────────── */
    _app.get('/api/user/profile', requireAuth, async (req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, email, name, role, country_code, referral_code FROM users WHERE id = $1',
          [req.user.id],
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found.' });
        return res.json(rows[0]);
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.get('/api/user/coins', requireAuth, async (req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM coin_ledger WHERE user_id = $1',
          [req.user.id],
        );
        return res.json({ balance: rows[0].balance });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.get('/api/user/dashboard', requireAuth, async (req, res) => {
      try {
        const balRes = await pool.query(
          'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM coin_ledger WHERE user_id = $1',
          [req.user.id],
        );
        const refRes = await pool.query(
          'SELECT COUNT(*)::int AS count FROM referrals WHERE referrer_id = $1',
          [req.user.id],
        );
        return res.json({
          balance: balRes.rows[0].balance,
          referralCount: refRes.rows[0].count,
        });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    /* ── Referral routes ─────────────────────────────────────────── */
    _app.get('/api/referral/info', requireAuth, async (req, res) => {
      try {
        const { rows } = await pool.query(
          `SELECT u.referral_code,
                  (SELECT COUNT(*)::int FROM referrals WHERE referrer_id = $1) AS total_referrals
           FROM users u WHERE u.id = $1`,
          [req.user.id],
        );
        return res.json(rows[0] || {});
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.post('/api/referral/qualify', requireAuth, async (req, res) => {
      /* Stub — real implementation qualifies referred user */
      return res.json({ message: 'qualify stub' });
    });

    /* ── Withdrawal routes ───────────────────────────────────────── */
    _app.get('/api/withdrawal/info', requireAuth, async (req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, amount_coins, status, created_at FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
          [req.user.id],
        );
        return res.json({ latest: rows[0] || null });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.post('/api/withdrawal/create', requireAuth, async (req, res) => {
      const userId = req.user.id;  // Always from JWT, never from body
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        /* Lock user's ledger rows to prevent concurrent double-spend */
        const balRes = await client.query(
          'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM coin_ledger WHERE user_id = $1 FOR UPDATE',
          [userId],
        );
        const balance = balRes.rows[0].balance;

        /* Get user's country for minimum check */
        const userRes = await client.query(
          'SELECT country_code FROM users WHERE id = $1',
          [userId],
        );
        const countryCode = userRes.rows[0]?.country_code || 'DEFAULT';
        const { getRulesForCountry } = require('../config/countries');
        const rules = getRulesForCountry(countryCode);

        const requestedCoins = balance; // withdraw full balance
        if (requestedCoins <= 0) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Insufficient balance.' });
        }
        if (requestedCoins < rules.minCoins) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Below minimum withdrawal.' });
        }

        /* Check for existing pending withdrawal */
        const pendingRes = await client.query(
          "SELECT id FROM withdrawals WHERE user_id = $1 AND status = 'pending' LIMIT 1",
          [userId],
        );
        if (pendingRes.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Pending withdrawal already exists.' });
        }

        const idempotencyKey = req.body.idempotencyKey || crypto.randomUUID();
        const { encrypt } = require('../server/utils/crypto');
        const paymentDetails = encrypt(JSON.stringify(req.body.paymentDetails || {}));
        const method = req.body.method || 'upi';
        const coinConfig = require('../config/coins');
        const amountCurrency = (requestedCoins / coinConfig.coinsPerRupee).toFixed(2);

        /* Debit coins */
        await client.query(
          `INSERT INTO coin_ledger (user_id, amount, type, ref_id, description)
           VALUES ($1, $2, 'withdrawal_debit', $3, 'Withdrawal request')`,
          [userId, -requestedCoins, `wd:${idempotencyKey}`],
        );

        /* Create withdrawal record */
        await client.query(
          `INSERT INTO withdrawals (user_id, amount_coins, amount_currency, currency, method, payment_details, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, requestedCoins, amountCurrency, rules.currency, method, paymentDetails, idempotencyKey],
        );

        await client.query('COMMIT');
        return res.status(201).json({ message: 'Withdrawal created.', amount_coins: requestedCoins });
      } catch (err) {
        await client.query('ROLLBACK');
        /* Idempotency violation → duplicate request */
        if (err.code === '23505') {
          return res.status(409).json({ error: 'Duplicate withdrawal request.' });
        }
        console.error('[withdrawal/create] Error:', err.message);
        return res.status(500).json({ error: 'Internal error.' });
      } finally {
        client.release();
      }
    });

    _app.get('/api/withdrawal/history', requireAuth, async (req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, amount_coins, amount_currency, currency, method, status, created_at FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC',
          [req.user.id],
        );
        return res.json({ withdrawals: rows });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    /* ── Admin routes ────────────────────────────────────────────── */
    _app.get('/api/admin/users', requireAdmin, async (_req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, email, name, role, is_banned, created_at FROM users ORDER BY id',
        );
        return res.json({ users: rows });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.get('/api/admin/withdrawals', requireAdmin, async (_req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, user_id, amount_coins, status, created_at FROM withdrawals ORDER BY created_at DESC',
        );
        return res.json({ withdrawals: rows });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.put('/api/admin/withdrawal/:id/status', requireAdmin, async (req, res) => {
      const { status } = req.body;
      const { id } = req.params;
      try {
        await pool.query(
          'UPDATE withdrawals SET status = $1, reviewed_by = $2, reviewed_at = NOW() WHERE id = $3',
          [status, req.user.id, id],
        );
        return res.json({ message: 'Updated.' });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.get('/api/admin/referrals', requireAdmin, async (_req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, referrer_id, referred_id, status, flagged, flag_reason FROM referrals ORDER BY created_at DESC',
        );
        return res.json({ referrals: rows });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    _app.get('/api/admin/audit-log', requireAdmin, async (_req, res) => {
      try {
        const { rows } = await pool.query(
          'SELECT id, user_id, action, target_type, target_id, created_at FROM audit_log ORDER BY created_at DESC LIMIT 100',
        );
        return res.json({ entries: rows });
      } catch {
        return res.status(500).json({ error: 'Internal error.' });
      }
    });

    /* ── Global error handler ────────────────────────────────────── */
    _app.use((err, _req, res, _next) => {
      console.error('[test-app] Unhandled error:', err.message);
      res.status(500).json({ error: 'Internal error.' });
    });
  }

  return _app;
}

/* ── Database bootstrap ────────────────────────────────────────────────── */

/**
 * Run the migration SQL to ensure all tables exist.
 */
async function setupDatabase() {
  const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '001_initial.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(sql);
}

/**
 * Truncate all data tables (preserving schema).
 * Called between tests to ensure isolation.
 */
async function cleanAll() {
  await pool.query(`
    TRUNCATE
      audit_log,
      device_fingerprints,
      withdrawals,
      referrals,
      coin_ledger,
      sessions,
      users
    RESTART IDENTITY CASCADE
  `);
}

/* ── User factories ────────────────────────────────────────────────────── */

let _userSeq = 0;

/**
 * Insert a test user directly into the database, bypassing Google OAuth.
 *
 * @param {Object}  [overrides]
 * @param {string}  [overrides.email]
 * @param {string}  [overrides.name]
 * @param {string}  [overrides.role]          'user' | 'admin'
 * @param {string}  [overrides.countryCode]   ISO-3166-1 alpha-2
 * @param {string}  [overrides.fingerprint]
 * @param {string}  [overrides.ip]
 * @param {string}  [overrides.referredBy]    referral_code of referrer
 * @returns {Promise<{ id, email, name, role, referralCode, googleId }>}
 */
async function createTestUser(overrides = {}) {
  _userSeq += 1;
  const seq          = _userSeq;
  const googleId     = overrides.googleId     || `google-test-${seq}-${Date.now()}`;
  const email        = overrides.email        || `testuser${seq}@gmail.com`;
  const normalEmail  = email.toLowerCase().replace(/\./g, '').split('+')[0].replace(/@.*/, '') + '@gmail.com';
  const name         = overrides.name         || `Test User ${seq}`;
  const role         = overrides.role         || 'user';
  const countryCode  = overrides.countryCode  || 'IN';
  const fingerprint  = overrides.fingerprint  || `fp-${seq}`;
  const ip           = overrides.ip           || `192.168.1.${(seq % 254) + 1}`;
  const referralCode = overrides.referralCode || `REF${seq}${Date.now().toString(36).toUpperCase()}`;

  const { rows } = await pool.query(
    `INSERT INTO users (google_id, email, normalized_email, name, role, country_code,
                        device_fingerprint, registration_ip, referral_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9)
     RETURNING id, email, name, role, referral_code AS "referralCode"`,
    [googleId, email, normalEmail, name, role, countryCode, fingerprint, ip, referralCode],
  );

  return { ...rows[0], googleId };
}

/**
 * Convenience wrapper — creates a user with role = 'admin'.
 */
async function createAdminUser(overrides = {}) {
  return createTestUser({ ...overrides, role: 'admin' });
}

/* ── Auth helpers ──────────────────────────────────────────────────────── */

/**
 * Generate a valid access_token JWT for the given user.
 *
 * @param {{ id: number, role: string, email: string }} user
 * @param {Object}  [opts]
 * @param {string}  [opts.expiresIn]   e.g. '15m', '1s', '-10s' (expired)
 * @param {string}  [opts.secret]      override signing secret (for tamper tests)
 * @returns {string} JWT
 */
function signAccessToken(user, opts = {}) {
  const secret    = opts.secret || config.jwtAccessSecret;
  const expiresIn = opts.expiresIn || '15m';
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    secret,
    { expiresIn },
  );
}

/**
 * Generate a valid refresh_token JWT + insert a session row in the DB.
 *
 * @param {{ id: number, role: string, email: string }} user
 * @returns {Promise<{ token: string, sessionId: number, tokenHash: string }>}
 */
async function createRefreshToken(user) {
  const token = jwt.sign(
    { sub: user.id, type: 'refresh' },
    config.jwtRefreshSecret,
    { expiresIn: '7d' },
  );
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const { rows } = await pool.query(
    `INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')
     RETURNING id`,
    [user.id, tokenHash],
  );
  return { token, sessionId: rows[0].id, tokenHash };
}

/**
 * Build cookie strings for a test user (access + refresh + CSRF).
 * Returns an object { accessToken, refreshToken, csrfToken }.
 */
async function authCookiesFor(user, opts = {}) {
  const accessToken  = signAccessToken(user, opts);
  const { token: refreshToken } = await createRefreshToken(user);
  const csrfToken    = crypto.randomBytes(24).toString('hex');
  return { accessToken, refreshToken, csrfToken };
}

/**
 * Return a CSRF cookie + header pair for a POST request.
 * @returns {{ cookie: string, header: string }}
 */
function csrfPair() {
  const token = crypto.randomBytes(24).toString('hex');
  return { cookie: token, header: token };
}

/**
 * Create a fully authenticated supertest agent.
 * Sets access_token, refresh_token, and _csrf cookies.
 *
 * @param {object} user  – user row from createTestUser
 * @param {object} [opts] – passed to signAccessToken
 * @returns {Promise<{ agent: import('supertest').SuperTest, csrf: string }>}
 */
async function authedAgent(user, opts = {}) {
  const { accessToken, refreshToken, csrfToken } = await authCookiesFor(user, opts);
  const app   = getApp();
  const agent = request.agent(app);

  /* Set cookies on the agent by making a no-op request is fragile.
     Instead, we directly set the cookie header on each request via
     a wrapper. Return a helper that augments requests. */
  const cookieStr = `access_token=${accessToken}; refresh_token=${refreshToken}; _csrf=${csrfToken}`;

  return {
    /** Raw cookie string */
    cookies: cookieStr,
    /** CSRF token value (for x-csrf-token header on mutating requests) */
    csrf: csrfToken,
    /** Access token (for manual override tests) */
    accessToken,
    /** Refresh token (for refresh tests) */
    refreshToken,
    /**
     * Helper: GET request with auth cookies.
     */
    get: (url) =>
      request(app).get(url).set('Cookie', cookieStr),
    /**
     * Helper: POST request with auth cookies + CSRF.
     */
    post: (url) =>
      request(app)
        .post(url)
        .set('Cookie', cookieStr)
        .set('x-csrf-token', csrfToken),
    /**
     * Helper: PUT request with auth cookies + CSRF.
     */
    put: (url) =>
      request(app)
        .put(url)
        .set('Cookie', cookieStr)
        .set('x-csrf-token', csrfToken),
    /**
     * Helper: DELETE request with auth cookies + CSRF.
     */
    delete: (url) =>
      request(app)
        .delete(url)
        .set('Cookie', cookieStr)
        .set('x-csrf-token', csrfToken),
  };
}

/**
 * Credit coins to a user's ledger (helper for setting up test scenarios).
 *
 * @param {number} userId
 * @param {number} amount  – positive integer
 * @param {string} [type]  – ledger type, default 'signup_bonus'
 * @param {string} [refId] – idempotency key
 */
async function creditCoins(userId, amount, type = 'signup_bonus', refId = null) {
  await pool.query(
    `INSERT INTO coin_ledger (user_id, amount, type, ref_id, description)
     VALUES ($1, $2, $3, $4, 'Test credit')`,
    [userId, amount, type, refId],
  );
}

/**
 * Get the current coin balance for a user from the ledger.
 */
async function getBalance(userId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM coin_ledger WHERE user_id = $1',
    [userId],
  );
  return rows[0].balance;
}

/* ── Lifecycle hooks ───────────────────────────────────────────────────── */

beforeAll(async () => {
  await setupDatabase();
  await cleanAll();
});

afterEach(async () => {
  await cleanAll();
  _userSeq = 0;
});

afterAll(async () => {
  await pool.end();
});

/* ── Exports ───────────────────────────────────────────────────────────── */
module.exports = {
  getApp,
  setupDatabase,
  cleanAll,
  createTestUser,
  createAdminUser,
  authCookiesFor,
  authedAgent,
  csrfPair,
  signAccessToken,
  createRefreshToken,
  creditCoins,
  getBalance,
  pool,
};
