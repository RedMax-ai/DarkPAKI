/**
 * User controller — profile, coin history, dashboard stats.
 */
const { query } = require('../../db/pool');
const coinService = require('../services/coinService');

/* ── Get Profile ─────────────────────────────────────────── */

async function getProfile(req, res) {
  try {
    const userResult = await query(
      `SELECT id, email, name, avatar_url, role, referral_code, country_code,
              referred_by, referral_status, first_qualifying_action_at, created_at
       FROM users WHERE id = $1`,
      [req.user.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userResult.rows[0];
    const balance = await coinService.getBalance(req.user.id);

    /* Referral stats */
    const refStatsResult = await query(
      `SELECT
         COUNT(*)::int                                       AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'pending')::int     AS pending_referrals,
         COUNT(*) FILTER (WHERE status = 'credited')::int    AS credited_referrals
       FROM referrals WHERE referrer_id = $1`,
      [req.user.id],
    );

    const refStats = refStatsResult.rows[0];

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
      balance,
      referralStats: {
        total: refStats.total_referrals,
        pending: refStats.pending_referrals,
        credited: refStats.credited_referrals,
      },
    });
  } catch (err) {
    console.error('[user] getProfile error:', err.message);
    return res.status(500).json({ error: 'Failed to load profile.' });
  }
}

/* ── Coin History ────────────────────────────────────────── */

async function getCoinHistory(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = parseInt(req.query.offset, 10) || 0;

    const result = await coinService.getHistory(req.user.id, limit, offset);
    return res.json(result);
  } catch (err) {
    console.error('[user] getCoinHistory error:', err.message);
    return res.status(500).json({ error: 'Failed to load coin history.' });
  }
}

/* ── Dashboard Stats ─────────────────────────────────────── */

async function getDashboardStats(req, res) {
  try {
    const balance = await coinService.getBalance(req.user.id);

    const refStatsResult = await query(
      `SELECT
         COUNT(*)::int                                       AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'pending')::int     AS pending_referrals,
         COUNT(*) FILTER (WHERE status = 'credited')::int    AS credited_referrals
       FROM referrals WHERE referrer_id = $1`,
      [req.user.id],
    );

    const totalEarnedResult = await query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total_earned
       FROM coin_ledger
       WHERE user_id = $1 AND amount > 0`,
      [req.user.id],
    );

    const withdrawalStatsResult = await query(
      `SELECT
         COUNT(*)::int                                       AS total_withdrawals,
         COUNT(*) FILTER (WHERE status = 'pending')::int     AS pending_withdrawals,
         COALESCE(SUM(amount_coins) FILTER (WHERE status = 'paid'), 0)::int AS paid_coins
       FROM withdrawals WHERE user_id = $1`,
      [req.user.id],
    );

    return res.json({
      balance,
      totalEarned: totalEarnedResult.rows[0].total_earned,
      referrals: refStatsResult.rows[0],
      withdrawals: withdrawalStatsResult.rows[0],
    });
  } catch (err) {
    console.error('[user] getDashboardStats error:', err.message);
    return res.status(500).json({ error: 'Failed to load dashboard.' });
  }
}

module.exports = { getProfile, getCoinHistory, getDashboardStats };
