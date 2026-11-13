/**
 * Referral service.
 *
 * Handles the lifecycle of a referral:
 *   signup → pending → (auto-credit | admin review) → credited | rejected
 */
const { pool, query } = require('../../db/pool');
const coinService = require('./coinService');
const auditService = require('./auditService');
const coins = require('../../config/coins');

/**
 * Record a new referral when a user signs up with a referral code.
 *
 * Checks:
 *  1. No self-referral
 *  2. Same device fingerprint or IP → flag as suspicious
 *  3. Referrer daily cap not exceeded
 *
 * @param {number} referrerId   The user who owns the referral code
 * @param {number} referredId   The newly signed-up user
 * @param {string} deviceFp     Device fingerprint of the new user
 * @param {string} ip           Registration IP
 * @returns {Promise<object>}   The created referral row
 */
async function processReferralSignup(referrerId, referredId, deviceFp, ip) {
  /* 1. Self-referral guard */
  if (referrerId === referredId) {
    throw new Error('SELF_REFERRAL');
  }

  /* 2. Check for suspicious patterns (same device/IP as referrer) */
  let flagged = false;
  let flagReason = null;

  /* Same device fingerprint? */
  const fpCheck = await query(
    `SELECT 1 FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2 LIMIT 1`,
    [referrerId, deviceFp],
  );
  if (fpCheck.rows.length > 0) {
    flagged = true;
    flagReason = 'Same device fingerprint as referrer.';
  }

  /* Same IP? */
  if (!flagged) {
    const ipCheck = await query(
      `SELECT registration_ip FROM users WHERE id = $1`,
      [referrerId],
    );
    if (ipCheck.rows.length > 0 && ipCheck.rows[0].registration_ip === ip) {
      flagged = true;
      flagReason = 'Same registration IP as referrer.';
    }
  }

  /* 3. Daily cap */
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dailyCount = await query(
    `SELECT COUNT(*)::int AS cnt FROM referrals
     WHERE referrer_id = $1 AND created_at >= $2`,
    [referrerId, today.toISOString()],
  );
  if (dailyCount.rows[0].cnt >= coins.maxReferralsPerDay) {
    flagged = true;
    flagReason = flagReason
      ? `${flagReason} Daily referral cap exceeded.`
      : 'Daily referral cap exceeded.';
  }

  /* Insert referral row */
  const result = await query(
    `INSERT INTO referrals (referrer_id, referred_id, device_fingerprint, ip_address, flagged, flag_reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [referrerId, referredId, deviceFp, ip || null, flagged, flagReason],
  );

  return result.rows[0];
}

/**
 * Credit a pending referral — awards coins to both referrer and referred user.
 * Runs inside a transaction with idempotency via ref_id.
 *
 * @param {number}      referralId
 * @param {number|null} adminUserId  Admin performing the action (null for auto)
 */
async function creditReferral(referralId, adminUserId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Lock the referral row */
    const refResult = await client.query(
      `SELECT * FROM referrals WHERE id = $1 FOR UPDATE`,
      [referralId],
    );
    if (refResult.rows.length === 0) {
      throw new Error('REFERRAL_NOT_FOUND');
    }

    const referral = refResult.rows[0];

    /* Idempotency — already credited */
    if (referral.status === 'credited') {
      await client.query('COMMIT');
      return referral;
    }

    if (referral.status === 'rejected') {
      throw new Error('REFERRAL_ALREADY_REJECTED');
    }

    /* Credit referrer */
    await coinService.creditCoins(
      referral.referrer_id,
      coins.referralBonus,
      'referral_bonus',
      `referral_referrer_${referralId}`,
      `Referral bonus for user #${referral.referred_id}`,
      client,
    );

    /* Credit referred user */
    await coinService.creditCoins(
      referral.referred_id,
      coins.referredUserBonus,
      'referral_referred_bonus',
      `referral_referred_${referralId}`,
      'Bonus for completing referral qualification',
      client,
    );

    /* Update referral status */
    const totalCoins = coins.referralBonus + coins.referredUserBonus;
    await client.query(
      `UPDATE referrals
       SET status = 'credited',
           coins_credited = $1,
           reviewed_by = $2,
           reviewed_at = NOW()
       WHERE id = $3`,
      [totalCoins, adminUserId, referralId],
    );

    await client.query('COMMIT');

    return { ...referral, status: 'credited', coins_credited: totalCoins };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reject a pending referral.
 *
 * @param {number}      referralId
 * @param {number|null} adminUserId
 */
async function rejectReferral(referralId, adminUserId) {
  const result = await query(
    `UPDATE referrals
     SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW()
     WHERE id = $2 AND status = 'pending'
     RETURNING *`,
    [adminUserId, referralId],
  );

  if (result.rows.length === 0) {
    throw new Error('REFERRAL_NOT_FOUND_OR_ALREADY_PROCESSED');
  }

  return result.rows[0];
}

/**
 * Fetch all pending referrals (admin review queue).
 */
async function getPendingReferrals(limit = 50, offset = 0) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const result = await query(
    `SELECT r.*, u1.email AS referrer_email, u2.email AS referred_email
     FROM referrals r
     JOIN users u1 ON u1.id = r.referrer_id
     JOIN users u2 ON u2.id = r.referred_id
     WHERE r.status = 'pending'
     ORDER BY r.flagged DESC, r.created_at ASC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM referrals WHERE status = 'pending'`,
  );

  return { referrals: result.rows, total: countResult.rows[0].total };
}

/**
 * Fetch flagged referrals (admin review).
 */
async function getFlaggedReferrals(limit = 50, offset = 0) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const result = await query(
    `SELECT r.*, u1.email AS referrer_email, u2.email AS referred_email
     FROM referrals r
     JOIN users u1 ON u1.id = r.referrer_id
     JOIN users u2 ON u2.id = r.referred_id
     WHERE r.flagged = TRUE AND r.status = 'pending'
     ORDER BY r.created_at ASC
     LIMIT $1 OFFSET $2`,
    [safeLimit, safeOffset],
  );

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM referrals WHERE flagged = TRUE AND status = 'pending'`,
  );

  return { referrals: result.rows, total: countResult.rows[0].total };
}

module.exports = {
  processReferralSignup,
  creditReferral,
  rejectReferral,
  getPendingReferrals,
  getFlaggedReferrals,
};
