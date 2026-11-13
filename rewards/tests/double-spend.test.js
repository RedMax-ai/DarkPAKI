/**
 * tests/double-spend.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security Test Suite: Concurrency, Double-Spend & Ledger Integrity Defenses
 *
 * Verifies that:
 *  1. Concurrent withdrawal requests cannot double-spend user coins (Row Locking)
 *  2. Duplicate transactions with same idempotency key execute exactly once
 *  3. Overdraft attempts are strictly rejected
 *  4. Withdrawals below country-specific minimum floor are rejected
 *  5. Append-only ledger invariant holds: balance is strictly SUM(amount)
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
  getBalance,
  pool,
} = require('./setup');
const coinService = require('../server/services/coinService');

describe('Security: Double-Spend & Concurrency Defenses', () => {
  let app;

  beforeAll(() => {
    app = getApp();
  });

  describe('1. Idempotency & Duplicate Credit Protection', () => {
    test('Rapid-fire coin credits with identical ref_id credit exactly once', async () => {
      const user = await createTestUser();
      const idempotencyKey = 'signup_ref_' + uuidv4();

      // Trigger 5 concurrent credit attempts with the same idempotency key
      const client = await pool.connect();
      try {
        await Promise.all([
          coinService.creditCoins(user.id, 500, 'signup_bonus', idempotencyKey, 'Bonus attempt 1', client),
          coinService.creditCoins(user.id, 500, 'signup_bonus', idempotencyKey, 'Bonus attempt 2', client),
          coinService.creditCoins(user.id, 500, 'signup_bonus', idempotencyKey, 'Bonus attempt 3', client),
          coinService.creditCoins(user.id, 500, 'signup_bonus', idempotencyKey, 'Bonus attempt 4', client),
          coinService.creditCoins(user.id, 500, 'signup_bonus', idempotencyKey, 'Bonus attempt 5', client),
        ]);
      } finally {
        client.release();
      }

      // Balance must be exactly 500, not 2500
      const balance = await getBalance(user.id);
      expect(balance).toBe(500);

      // Verify row count in ledger
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM coin_ledger WHERE user_id = $1 AND ref_id = $2',
        [user.id, idempotencyKey]
      );
      expect(rows[0].count).toBe(1);
    });
  });

  describe('2. Overdraft Prevention (Row-Level Locking)', () => {
    test('Withdrawal request exceeding available balance is rejected (400)', async () => {
      const user = await createTestUser({ country_code: 'IN' });
      await creditCoins(user.id, 50000); // 50,000 coins available (₹500)

      const cookies = authCookiesFor(user);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      // Attempt to withdraw 60,000 coins (exceeds balance)
      const res = await request(app)
        .post('/api/withdrawal/create')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({
          amountCoins: 60000,
          method: 'upi',
          paymentDetails: { upiId: 'user@okaxis' },
          turnstileToken: 'TEST_BYPASS',
          idempotencyKey: uuidv4(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/insufficient balance/i);

      // Verify no coins were locked
      const finalBalance = await getBalance(user.id);
      expect(finalBalance).toBe(50000);
    });

    test('Concurrent withdrawal race condition locks coins cleanly (only 1 succeeds)', async () => {
      const user = await createTestUser({ country_code: 'IN' });
      // Exactly enough coins for ONE ₹500 withdrawal (50,000 coins)
      await creditCoins(user.id, 50000);

      const cookies = authCookiesFor(user);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      // Launch 2 simultaneous withdrawal requests for 50,000 coins
      const req1 = request(app)
        .post('/api/withdrawal/create')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({
          amountCoins: 50000,
          method: 'upi',
          paymentDetails: { upiId: 'user@okaxis' },
          turnstileToken: 'TEST_BYPASS',
          idempotencyKey: uuidv4(),
        });

      const req2 = request(app)
        .post('/api/withdrawal/create')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({
          amountCoins: 50000,
          method: 'upi',
          paymentDetails: { upiId: 'user@okaxis' },
          turnstileToken: 'TEST_BYPASS',
          idempotencyKey: uuidv4(),
        });

      const [res1, res2] = await Promise.all([req1, req2]);

      const successCount = [res1, res2].filter((r) => r.status === 201).length;
      const failCount = [res1, res2].filter((r) => r.status === 400).length;

      // Exactly ONE request can succeed; the other must fail (either insufficient balance or pending request already active)
      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      // Remaining unlocked balance must be 0, never negative!
      const remainingBalance = await getBalance(user.id);
      expect(remainingBalance).toBe(0);
    });
  });

  describe('3. Minimum Withdrawal Floor Validation', () => {
    test('India user cannot withdraw below ₹500 (50,000 coins)', async () => {
      const user = await createTestUser({ country_code: 'IN' });
      await creditCoins(user.id, 20000); // 20,000 coins

      const cookies = authCookiesFor(user);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      const res = await request(app)
        .post('/api/withdrawal/create')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({
          amountCoins: 20000,
          method: 'upi',
          paymentDetails: { upiId: 'user@okhdfcbank' },
          turnstileToken: 'TEST_BYPASS',
          idempotencyKey: uuidv4(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/minimum/i);
    });
  });

  describe('4. Append-Only Ledger Mathematical Invariant', () => {
    test('Ledger balance strictly equals arithmetic SUM of all ledger entries', async () => {
      const user = await createTestUser();

      // Create a sequence of positive and negative transactions
      await creditCoins(user.id, 500, 'signup_bonus', 'tx1');
      await creditCoins(user.id, 3000, 'referral_bonus', 'tx2');
      await creditCoins(user.id, 10, 'watch_reward', 'tx3');
      await creditCoins(user.id, -1000, 'withdrawal_lock', 'tx4');

      const expectedSum = 500 + 3000 + 10 - 1000; // 2510

      const computedBalance = await getBalance(user.id);
      expect(computedBalance).toBe(expectedSum);

      const serviceBalance = await coinService.getBalance(user.id);
      expect(serviceBalance).toBe(expectedSum);
    });
  });
});
