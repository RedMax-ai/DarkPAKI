/**
 * Referral controller — info, qualification.
 */
const config = require('../../config');
const { query } = require('../../db/pool');
const referralService = require('../services/referralService');
const auditService = require('../services/auditService');

/* ── Get Referral Info ───────────────────────────────────── */

async function getReferralInfo(req, res) {
  try {
    const userResult = await query(
      'SELECT referral_code FROM users WHERE id = $1',
      [req.user.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const referralCode = userResult.rows[0].referral_code;

    const statsResult = await query(
      `SELECT
         COUNT(*)::int                                       AS total,
         COUNT(*) FILTER (WHERE status = 'pending')::int     AS pending,
         COUNT(*) FILTER (WHERE status = 'credited')::int    AS credited,
         COUNT(*) FILTER (WHERE status = 'rejected')::int    AS rejected
       FROM referrals WHERE referrer_id = $1`,
      [req.user.id],
    );

    return res.json({
      referralCode,
      referralLink: `${config.webUrl}/ref/${referralCode}`,
      stats: statsResult.rows[0],
    });
  } catch (err) {
    console.error('[referral] getReferralInfo error:', err.message);
    return res.status(500).json({ error: 'Failed to load referral info.' });
  }
}

/* ── Qualify Referral ────────────────────────────────────── */

async function qualifyReferral(req, res) {
  try {
    const userId = req.user.id;

    /* Check if user has already completed a qualifying action */
    const userResult = await query(
      `SELECT first_qualifying_action_at, referred_by FROM users WHERE id = $1`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userResult.rows[0];

    if (user.first_qualifying_action_at) {
      return res.json({ message: 'Already qualified.', alreadyQualified: true });
    }

    /* Mark qualifying action */
    await query(
      `UPDATE users SET first_qualifying_action_at = NOW() WHERE id = $1`,
      [userId],
    );

    /* If this user was referred, try to credit the referral */
    if (user.referred_by) {
      const refResult = await query(
        `SELECT id, flagged FROM referrals WHERE referred_id = $1 AND status = 'pending'`,
        [userId],
      );

      if (refResult.rows.length > 0) {
        const referral = refResult.rows[0];

        if (referral.flagged) {
          /* Leave for admin review */
          await auditService.logAudit(
            userId,
            'referral_qualified_flagged',
            'referral',
            referral.id,
            { actionType: req.body.actionType },
            req.ip,
          );
        } else {
          /* Auto-credit */
          await referralService.creditReferral(referral.id, null);
          await auditService.logAudit(
            userId,
            'referral_auto_credited',
            'referral',
            referral.id,
            { actionType: req.body.actionType },
            req.ip,
          );
        }
      }
    }

    return res.json({ message: 'Qualification recorded.', alreadyQualified: false });
  } catch (err) {
    console.error('[referral] qualifyReferral error:', err.message);
    return res.status(500).json({ error: 'Failed to process qualification.' });
  }
}

module.exports = { getReferralInfo, qualifyReferral };
