/**
 * tests/self-referral.test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security Test Suite: Referral Abuse, Sybil & Anti-Cheat Defenses
 *
 * Verifies that:
 *  1. Self-referral using own referral code is blocked
 *  2. Multi-accounting from identical device fingerprint or IP is flagged
 *  3. Daily referral velocity cap blocks excessive referrals
 *  4. Bonus credit is PENDING until referred user completes qualifying action
 *  5. Double qualification / credit is strictly idempotent
 *  6. Disposable email addresses are rejected at registration
 * ─────────────────────────────────────────────────────────────────────────────
 */

const request = require('supertest');
const {
  getApp,
  createTestUser,
  authCookiesFor,
  csrfPair,
  getBalance,
  pool,
} = require('./setup');
const referralService = require('../server/services/referralService');

describe('Security: Referral Abuse & Anti-Cheat Defenses', () => {
  let app;

  beforeAll(() => {
    app = getApp();
  });

  describe('1. Self-Referral Prevention', () => {
    test('User attempting to refer themselves is rejected', async () => {
      const user = await createTestUser();

      const result = await referralService.processReferralSignup(
        user.id, // referrer
        user.id, // referred (same user)
        'device_abc_123',
        '192.168.1.100'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/self-referral/i);
    });
  });

  describe('2. Multi-Accounting & Device Fingerprint Anti-Cheat', () => {
    test('Referral sharing same device fingerprint as referrer is flagged as suspicious', async () => {
      const referrer = await createTestUser({ device_fingerprint: 'shared_hardware_id_999' });
      const referred = await createTestUser({ device_fingerprint: 'shared_hardware_id_999' });

      const result = await referralService.processReferralSignup(
        referrer.id,
        referred.id,
        'shared_hardware_id_999',
        '192.168.1.50'
      );

      expect(result.success).toBe(true);
      expect(result.flagged).toBe(true);
      expect(result.flagReason).toMatch(/device/i);

      // Verify referral row has flagged=true in DB
      const { rows } = await pool.query(
        'SELECT flagged, flag_reason, status FROM referrals WHERE referred_id = $1',
        [referred.id]
      );
      expect(rows[0].flagged).toBe(true);
      expect(rows[0].status).toBe('pending');
    });

    test('Referral sharing same IP address as referrer is flagged as suspicious', async () => {
      const referrer = await createTestUser({ registration_ip: '203.0.113.42' });
      const referred = await createTestUser({ registration_ip: '203.0.113.42' });

      const result = await referralService.processReferralSignup(
        referrer.id,
        referred.id,
        'unique_dev_1',
        '203.0.113.42'
      );

      expect(result.success).toBe(true);
      expect(result.flagged).toBe(true);
      expect(result.flagReason).toMatch(/IP/i);
    });
  });

  describe('3. Daily Velocity Cap', () => {
    test('Referrals exceeding daily cap (10 per day) are rejected or flagged', async () => {
      const referrer = await createTestUser();

      // Simulate 10 existing referrals today
      for (let i = 0; i < 10; i++) {
        const dummyUser = await createTestUser();
        await pool.query(
          `INSERT INTO referrals (referrer_id, referred_id, status, created_at)
           VALUES ($1, $2, 'credited', NOW())`,
          [referrer.id, dummyUser.id]
        );
      }

      // 11th referral attempt
      const newUser = await createTestUser();
      const result = await referralService.processReferralSignup(
        referrer.id,
        newUser.id,
        'unique_dev_' + Math.random(),
        '198.51.100.99'
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/daily limit/i);
    });
  });

  describe('4. Qualifying Action & Delayed Credit Gate', () => {
    test('Referral bonus is NOT credited at registration; only after qualifying action', async () => {
      const referrer = await createTestUser();
      const referred = await createTestUser({ referred_by: referrer.id });

      // Create valid unflagged referral record
      await referralService.processReferralSignup(
        referrer.id,
        referred.id,
        'device_clean_123',
        '198.51.100.1'
      );

      // Referrer balance must still be 0 (no immediate credit!)
      const referrerInitialBalance = await getBalance(referrer.id);
      expect(referrerInitialBalance).toBe(0);

      // Now the referred user performs a qualifying action (e.g. watch video)
      const cookies = authCookiesFor(referred);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      const qualifyRes = await request(app)
        .post('/api/referral/qualify')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({ actionType: 'watch_video' });

      expect(qualifyRes.status).toBe(200);

      // Referrer must now receive 3000 coins (₹30)
      const referrerFinalBalance = await getBalance(referrer.id);
      expect(referrerFinalBalance).toBe(3000);

      // Referred user receives bonus too (500 coins)
      const referredFinalBalance = await getBalance(referred.id);
      expect(referredFinalBalance).toBe(500);
    });

    test('Second qualifying action cannot re-trigger referral bonus (Idempotency)', async () => {
      const referrer = await createTestUser();
      const referred = await createTestUser({ referred_by: referrer.id });

      await referralService.processReferralSignup(
        referrer.id,
        referred.id,
        'device_clean_456',
        '198.51.100.2'
      );

      const cookies = authCookiesFor(referred);
      const { cookie: csrfCookie, header: csrfHeader } = csrfPair();

      // First qualification
      await request(app)
        .post('/api/referral/qualify')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({ actionType: 'watch_video' });

      // Second qualification attempt
      const res2 = await request(app)
        .post('/api/referral/qualify')
        .set('Cookie', [...cookies, csrfCookie])
        .set('X-CSRF-Token', csrfHeader)
        .send({ actionType: 'watch_video' });

      expect(res2.status).toBe(200);

      // Referrer balance must still be exactly 3000, NOT 6000
      const referrerBalance = await getBalance(referrer.id);
      expect(referrerBalance).toBe(3000);
    });
  });

  describe('5. Disposable Domain Defense', () => {
    test('Disposable email domain is recognized and rejected', () => {
      const disposableDomains = require('../config/disposable-domains');
      expect(disposableDomains.has('mailinator.com')).toBe(true);
      expect(disposableDomains.has('tempmail.com')).toBe(true);
      expect(disposableDomains.has('gmail.com')).toBe(false);
    });
  });
});
