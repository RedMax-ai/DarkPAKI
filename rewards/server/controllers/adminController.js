/**
 * Admin controller — dashboard, withdrawal/referral management, users, audit log.
 */
const { pool, query } = require('../../db/pool');
const coinService = require('../services/coinService');
const referralService = require('../services/referralService');
const auditService = require('../services/auditService');
const { decrypt } = require('../utils/crypto');

/* ── Dashboard Stats ─────────────────────────────────────── */

async function getDashboardStats(req, res) {
  try {
    const usersResult = await query('SELECT COUNT(*)::int AS total FROM users');

    const coinsResult = await query(
      'SELECT COALESCE(SUM(amount), 0)::int AS total_in_circulation FROM coin_ledger',
    );

    const pendingWdResult = await query(
      `SELECT COUNT(*)::int AS total FROM withdrawals WHERE status = 'pending'`,
    );

    const flaggedRefResult = await query(
      `SELECT COUNT(*)::int AS total FROM referrals WHERE flagged = TRUE AND status = 'pending'`,
    );

    return res.json({
      totalUsers: usersResult.rows[0].total,
      totalCoinsInCirculation: coinsResult.rows[0].total_in_circulation,
      pendingWithdrawals: pendingWdResult.rows[0].total,
      flaggedReferrals: flaggedRefResult.rows[0].total,
    });
  } catch (err) {
    console.error('[admin] getDashboardStats error:', err.message);
    return res.status(500).json({ error: 'Failed to load admin stats.' });
  }
}

/* ── Pending Withdrawals ─────────────────────────────────── */

async function getPendingWithdrawals(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await query(
      `SELECT w.id, w.user_id, w.amount_coins, w.amount_currency, w.currency,
              w.method, w.status, w.admin_note, w.created_at, w.updated_at,
              u.email, u.name
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = 'pending'
       ORDER BY w.created_at ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM withdrawals WHERE status = 'pending'`,
    );

    return res.json({
      withdrawals: result.rows,
      total: countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[admin] getPendingWithdrawals error:', err.message);
    return res.status(500).json({ error: 'Failed to load pending withdrawals.' });
  }
}

/* ── Review Withdrawal ───────────────────────────────────── */

async function reviewWithdrawal(req, res) {
  const { status, adminNote } = req.body;
  const withdrawalId = parseInt(req.params.id, 10);

  if (isNaN(withdrawalId)) {
    return res.status(400).json({ error: 'Invalid withdrawal ID.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* Lock withdrawal row */
    const wdResult = await client.query(
      `SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId],
    );

    if (wdResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Withdrawal not found.' });
    }

    const withdrawal = wdResult.rows[0];

    if (withdrawal.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Withdrawal has already been processed.' });
    }

    if (status === 'approved') {
      await client.query(
        `UPDATE withdrawals
         SET status = 'approved', admin_note = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [adminNote || null, req.user.id, withdrawalId],
      );
    } else if (status === 'rejected') {
      /* Release locked coins back to user */
      await coinService.creditCoins(
        withdrawal.user_id,
        withdrawal.amount_coins,
        'withdrawal_release',
        `withdrawal_release_${withdrawal.idempotency_key}`,
        `Withdrawal #${withdrawalId} rejected — coins released`,
        client,
      );

      await client.query(
        `UPDATE withdrawals
         SET status = 'rejected', admin_note = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [adminNote || null, req.user.id, withdrawalId],
      );
    }

    await client.query('COMMIT');

    await auditService.logAudit(
      req.user.id,
      `withdrawal_${status}`,
      'withdrawal',
      withdrawalId,
      { adminNote, userId: withdrawal.user_id, amountCoins: withdrawal.amount_coins },
      req.ip,
    );

    return res.json({ message: `Withdrawal ${status}.`, withdrawalId, status });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[admin] reviewWithdrawal error:', err.message);
    return res.status(500).json({ error: 'Failed to review withdrawal.' });
  } finally {
    client.release();
  }
}

/* ── Mark Withdrawal Paid ────────────────────────────────── */

async function markWithdrawalPaid(req, res) {
  const withdrawalId = parseInt(req.params.id, 10);
  if (isNaN(withdrawalId)) {
    return res.status(400).json({ error: 'Invalid withdrawal ID.' });
  }

  try {
    const result = await query(
      `UPDATE withdrawals
       SET status = 'paid', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND status = 'approved'
       RETURNING id`,
      [req.user.id, withdrawalId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found or not approved.' });
    }

    await auditService.logAudit(
      req.user.id,
      'withdrawal_paid',
      'withdrawal',
      withdrawalId,
      null,
      req.ip,
    );

    return res.json({ message: 'Withdrawal marked as paid.', withdrawalId });
  } catch (err) {
    console.error('[admin] markWithdrawalPaid error:', err.message);
    return res.status(500).json({ error: 'Failed to update withdrawal.' });
  }
}

/* ── Flagged Referrals ───────────────────────────────────── */

async function getFlaggedReferrals(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    const result = await referralService.getFlaggedReferrals(limit, offset);
    return res.json(result);
  } catch (err) {
    console.error('[admin] getFlaggedReferrals error:', err.message);
    return res.status(500).json({ error: 'Failed to load flagged referrals.' });
  }
}

/* ── Review Referral ─────────────────────────────────────── */

async function reviewReferral(req, res) {
  const referralId = parseInt(req.params.id, 10);
  if (isNaN(referralId)) {
    return res.status(400).json({ error: 'Invalid referral ID.' });
  }

  const { status, adminNote } = req.body;

  try {
    let referral;

    if (status === 'approved') {
      referral = await referralService.creditReferral(referralId, req.user.id);
      await auditService.logAudit(
        req.user.id,
        'referral_approved',
        'referral',
        referralId,
        { adminNote },
        req.ip,
      );
    } else if (status === 'rejected') {
      referral = await referralService.rejectReferral(referralId, req.user.id);
      await auditService.logAudit(
        req.user.id,
        'referral_rejected',
        'referral',
        referralId,
        { adminNote },
        req.ip,
      );
    } else {
      return res.status(400).json({ error: 'Status must be approved or rejected.' });
    }

    return res.json({ message: `Referral ${status}.`, referral });
  } catch (err) {
    if (err.message === 'REFERRAL_NOT_FOUND' || err.message === 'REFERRAL_NOT_FOUND_OR_ALREADY_PROCESSED') {
      return res.status(404).json({ error: 'Referral not found or already processed.' });
    }
    console.error('[admin] reviewReferral error:', err.message);
    return res.status(500).json({ error: 'Failed to review referral.' });
  }
}

/* ── Audit Log ───────────────────────────────────────────── */

async function getAuditLog(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await query(
      `SELECT a.*, u.email AS user_email
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await query(
      'SELECT COUNT(*)::int AS total FROM audit_log',
    );

    return res.json({
      entries: result.rows,
      total: countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[admin] getAuditLog error:', err.message);
    return res.status(500).json({ error: 'Failed to load audit log.' });
  }
}

/* ── Users List ──────────────────────────────────────────── */

async function getUsers(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.role, u.country_code,
              u.referral_code, u.is_banned, u.created_at,
              COALESCE(bal.balance, 0)::int AS balance
       FROM users u
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS balance FROM coin_ledger WHERE user_id = u.id
       ) bal ON TRUE
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const countResult = await query('SELECT COUNT(*)::int AS total FROM users');

    return res.json({
      users: result.rows,
      total: countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[admin] getUsers error:', err.message);
    return res.status(500).json({ error: 'Failed to load users.' });
  }
}

/* ── Ban User ────────────────────────────────────────────── */

async function banUser(req, res) {
  const targetUserId = parseInt(req.params.id, 10);
  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  /* Prevent self-ban */
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'You cannot ban yourself.' });
  }

  try {
    const result = await query(
      `UPDATE users SET is_banned = TRUE WHERE id = $1 AND role != 'admin' RETURNING id`,
      [targetUserId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or cannot be banned.' });
    }

    /* Revoke all sessions */
    await query(
      'UPDATE sessions SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE',
      [targetUserId],
    );

    await auditService.logAudit(
      req.user.id,
      'user_banned',
      'user',
      targetUserId,
      null,
      req.ip,
    );

    return res.json({ message: 'User banned.', userId: targetUserId });
  } catch (err) {
    console.error('[admin] banUser error:', err.message);
    return res.status(500).json({ error: 'Failed to ban user.' });
  }
}

module.exports = {
  getDashboardStats,
  getPendingWithdrawals,
  reviewWithdrawal,
  markWithdrawalPaid,
  getFlaggedReferrals,
  reviewReferral,
  getAuditLog,
  getUsers,
  banUser,
};
