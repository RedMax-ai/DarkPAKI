/**
 * tests/idor.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security Test Suite: Insecure Direct Object Reference (IDOR) & Tenant Isolation
 *
 * Verifies that:
 *  1. User A cannot view User B's profile or account balance
 *  2. User A cannot view User B's coin ledger history
 *  3. User A cannot view User B's withdrawal history
 *  4. Client cannot specify target userId when creating withdrawals or mutations
 *  5. Regular user cannot enumerate or access other users' data via URL parameters
 *  6. Non-admin users are strictly blocked from admin audit logs and user lists
 * ─────────────────────────────────────────────────────────────────────────────
 */

const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const {
  getApp,
  createTestUser,
  authCookiesFor,
  csrfPair,
  creditCoins,
  pool,
} = require('./setup');

describe('Security: IDOR & Object Ownership Defenses', () => {
  let app;

  beforeAll(() => {
    app = getApp();
  });

  describe('1. Cross-Account Data Leakage Prevention', () => {
    test('User A requesting /api/user/profile receives only User A data, never User B', async () => {
      const userA = await createTestUser({ email: 'userA@gmail.com', name: 'User A' });
      const userB = await createTestUser({ email: 'userB@gmail.com', name: 'User B' });

      await creditCoins(userA.id, 100);
      await creditCoins(userB.id, 9999);

      const cookiesA = authCookiesFor(userA);

      const res = await request(app)
        .get('/api/user/profile')
        .set('Cookie', cookiesA);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(userA.id);
      expect(res.body.user.email).toBe('userA@gmail.com');
      expect(res.body.balance).toBe(100);
      // Ensure User B's private balance is NOT leaked
      expect(res.body.balance).not.toBe(9999);
    });

    test('User A requesting /api/user/coins cannot view User B transactions', async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();

      await creditCoins(userA.id, 50, 'signup_bonus', 'userA_tx');
      await creditCoins(userB.id, 5000, 'referral_bonus', 'userB_secret_tx');

      const cookiesA = authCookiesFor(userA);

      const res = await request(app)
        .get('/api/user/coins')
        .set('Cookie', cookiesA);

      expect(res.status).toBe(200);
      const entries = res.body.entries;
      for (const entry of entries) {
        expect(entry.user_id).toBe(userA.id);
        expect(entry.ref_id).not.toBe('userB_secret_tx');
      }
    });

    test('User A requesting /api/withdrawal/history sees only their own withdrawals', async () => {
      const userA = await createTestUser();
      const userB = await createTestUser();

      // Insert dummy withdrawal for user B
      await pool.query(
        `INSERT INTO withdrawals (user_id, amount_coins, amount_currency, currency, method, payment_details, status, idempotency_key)
         VALUES ($1, 50000, 500, 'INR', 'upi', 'enc_data', 'pending', $2)`,
        [userB.id, uuidv4()]
      );

      const cookiesA = authCookiesFor(userA);

      const res = await request(app)
        .get('/api/withdrawal/history')
        .set('Cookie', cookiesA);

      expect(res.status).toBe(200);
      expect(res.body.withdrawals).toHaveLength(0); // User A has zero withdrawals
    });
  });

  describe('2. Parameter Tampering & Spoofed Ownership Defenses', () => {
    test('User A cannot inject target userId in withdrawal creation (Derived strictly from verified JWT)', async () => {
      const userA = await createTestUser({ country_code: 'IN' });
      const userB = await createTestUser({ country_code: 'IN' });

      await creditCoins(userA.id, 50000);
      await creditCoins(userB.id, 50000);

      const cookiesA = authCookiesFor(userA);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      // Attempt to maliciously charge User B's balance by sending spoofed userId
      const res = await request(app)
        .post('/api/withdrawal/create')
        .set('Cookie', [...cookiesA, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({
          userId: userB.id, // Malicious spoof attempt
          user_id: userB.id,
          amountCoins: 50000,
          method: 'upi',
          paymentDetails: { upiId: 'attacker@upi' },
          turnstileToken: 'TEST_BYPASS',
          idempotencyKey: uuidv4(),
        });

      expect(res.status).toBe(201);

      // Verify the withdrawal was debited from userA (the authenticated caller), NOT userB!
      const { rows } = await pool.query(
        'SELECT user_id FROM withdrawals WHERE idempotency_key = $1',
        [res.body.data.idempotencyKey]
      );
      expect(rows[0].user_id).toBe(userA.id);
      expect(rows[0].user_id).not.toBe(userB.id);
    });

    test('Regular user cannot mutate withdrawal review or approval status (403)', async () => {
      const userA = await createTestUser();
      const cookiesA = authCookiesFor(userA);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      const res = await request(app)
        .put('/api/admin/withdrawals/1/review')
        .set('Cookie', [...cookiesA, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({ status: 'approved' });

      expect(res.status).toBe(403);
    });

    test('Regular user cannot query admin audit logs (403)', async () => {
      const userA = await createTestUser();
      const cookiesA = authCookiesFor(userA);

      const res = await request(app)
        .get('/api/admin/audit-log')
        .set('Cookie', cookiesA);

      expect(res.status).toBe(403);
    });

    test('Regular user cannot query complete user list (403)', async () => {
      const userA = await createTestUser();
      const cookiesA = authCookiesFor(userA);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Cookie', cookiesA);

      expect(res.status).toBe(403);
    });
  });
});
