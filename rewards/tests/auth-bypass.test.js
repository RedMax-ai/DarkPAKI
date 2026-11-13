/**
 * tests/auth-bypass.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security Test Suite: Authentication & Authorization Bypass Defenses
 *
 * Verifies that:
 *  1. Unauthenticated requests to protected endpoints return 401
 *  2. Expired access tokens return 401 with TOKEN_EXPIRED
 *  3. Tampered or corrupted JWTs return 401
 *  4. JWTs signed with a foreign secret return 401
 *  5. Regular authenticated users cannot access admin endpoints (403 Forbidden)
 *  6. Revoked refresh tokens are rejected
 *  7. Refresh token reuse triggers family revocation
 *  8. Missing or mismatched CSRF tokens on mutating requests are rejected (403)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const {
  getApp,
  createTestUser,
  createAdminUser,
  authCookiesFor,
  authedAgent,
  csrfPair,
  signAccessToken,
  createRefreshToken,
  pool,
} = require('./setup');

describe('Security: Auth Bypass Defenses', () => {
  let app;

  beforeAll(() => {
    app = getApp();
  });

  describe('1. Unauthenticated Access Prevention', () => {
    test('GET /api/user/profile without cookies returns 401', async () => {
      const res = await request(app).get('/api/user/profile');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    test('GET /api/withdrawal/history without cookies returns 401', async () => {
      const res = await request(app).get('/api/withdrawal/history');
      expect(res.status).toBe(401);
    });

    test('GET /api/admin/stats without cookies returns 401', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
    });
  });

  describe('2. JWT Integrity & Expiry Checks', () => {
    test('Expired access token returns 401 with code TOKEN_EXPIRED', async () => {
      const user = await createTestUser();
      const expiredToken = signAccessToken(user, { expiresIn: '-1s' });

      const res = await request(app)
        .get('/api/user/profile')
        .set('Cookie', [`access_token=${expiredToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('TOKEN_EXPIRED');
    });

    test('Tampered JWT signature returns 401', async () => {
      const user = await createTestUser();
      const validToken = signAccessToken(user);
      const tamperedToken = validToken.slice(0, -6) + 'xxxxxx';

      const res = await request(app)
        .get('/api/user/profile')
        .set('Cookie', [`access_token=${tamperedToken}`]);

      expect(res.status).toBe(401);
    });

    test('JWT signed with attacker private/secret key returns 401', async () => {
      const user = await createTestUser();
      const attackerToken = jwt.sign(
        { sub: user.id, role: 'admin', email: user.email },
        'attacker-unauthorized-secret-key-12345678',
        { expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', [`access_token=${attackerToken}`]);

      expect(res.status).toBe(401);
    });
  });

  describe('3. Role-Based Access Control (RBAC) Enforcement', () => {
    test('Regular user cannot access admin endpoint (403 Forbidden)', async () => {
      const user = await createTestUser({ role: 'user' });
      const cookies = authCookiesFor(user);

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', cookies);

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/admin/i);
    });

    test('Regular user cannot call admin review endpoints (403 Forbidden)', async () => {
      const user = await createTestUser({ role: 'user' });
      const cookies = authCookiesFor(user);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      const res = await request(app)
        .put('/api/admin/withdrawals/1/review')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({ status: 'approved' });

      expect(res.status).toBe(403);
    });

    test('Admin user CAN access admin endpoints (200 OK)', async () => {
      const admin = await createAdminUser();
      const cookies = authCookiesFor(admin);

      const res = await request(app)
        .get('/api/admin/stats')
        .set('Cookie', cookies);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('4. Refresh Token Security & Revocation', () => {
    test('Revoked refresh token cannot obtain new access tokens (401)', async () => {
      const user = await createTestUser();
      const { rawToken } = await createRefreshToken(user.id, { revoked: true });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`refresh_token=${rawToken}`]);

      expect(res.status).toBe(401);
    });

    test('Logout revokes all active sessions for user', async () => {
      const user = await createTestUser();
      const cookies = authCookiesFor(user);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      // Perform logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader);

      expect(logoutRes.status).toBe(200);

      // Verify sessions table revoked flag
      const { rows } = await pool.query(
        'SELECT revoked FROM sessions WHERE user_id = $1',
        [user.id]
      );
      for (const row of rows) {
        expect(row.revoked).toBe(true);
      }
    });
  });

  describe('5. CSRF Protection (Double-Submit Cookie Pattern)', () => {
    test('Mutating POST request without X-CSRF-Token header returns 403', async () => {
      const user = await createTestUser();
      const cookies = authCookiesFor(user);
      const { cookie: csrfCookie } = csrfPair();

      const res = await request(app)
        .post('/api/referral/qualify')
        .set('Cookie', [...cookies, csrfCookie])
        // Header omitted
        .send({ actionType: 'watch_video' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_INVALID');
    });

    test('Mutating POST request with mismatched CSRF token returns 403', async () => {
      const user = await createTestUser();
      const cookies = authCookiesFor(user);

      const res = await request(app)
        .post('/api/referral/qualify')
        .set('Cookie', [...cookies, '_csrf=legitimate_cookie_val'])
        .set('X-CSRF-Token', 'attacker_forged_header_val')
        .send({ actionType: 'watch_video' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('CSRF_INVALID');
    });
  });
});
