/**
 * Withdrawal controller — info, create, history.
 */
const { pool, query } = require('../../db/pool');
const config = require('../../config');
const coins = require('../../config/coins');
const { getRulesForCountry } = require('../../config/countries');
const coinService = require('../services/coinService');
const auditService = require('../services/auditService');
const { encrypt } = require('../utils/crypto');

/* ── Get Withdrawal Info ─────────────────────────────────── */

async function getWithdrawalInfo(req, res) {
  try {
    const userResult = await query(
      'SELECT country_code FROM users WHERE id = $1',
      [req.user.id],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const countryCode = userResult.rows[0].country_code;
    const rules = getRulesForCountry(countryCode);
    const balance = await coinService.getBalance(req.user.id);

    const pendingResult = await query(
      `SELECT id, amount_coins, status, created_at
       FROM withdrawals
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY created_at DESC`,
      [req.user.id],
    );

    return res.json({
      countryCode,
      rules: {
        country: rules.country,
        currency: rules.currency,
        minAmount: rules.minAmount,
        minCoins: rules.minCoins,
        methods: rules.methods,
        coinsPerRupee: coins.coinsPerRupee,
      },
      balance,
      pendingWithdrawals: pendingResult.rows,
    });
  } catch (err) {
    console.error('[withdrawal] getWithdrawalInfo error:', err.message);
    return res.status(500).json({ error: 'Failed to load withdrawal info.' });
  }
}

/* ── Create Withdrawal ───────────────────────────────────── */

async function createWithdrawal(req, res) {
  const { amountCoins, method, paymentDetails, idempotencyKey } = req.body;
  const userId = req.user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* 1. Lock user row + get info */
    const userResult = await client.query(
      'SELECT id, country_code, is_banned FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userResult.rows[0];

    if (user.is_banned) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Account is suspended.' });
    }

    /* 2. Country rules */
    const rules = getRulesForCountry(user.country_code);

    if (!rules.methods.includes(method)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Payment method '${method}' is not available for your country.`,
      });
    }

    if (amountCoins < rules.minCoins) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Minimum withdrawal is ${rules.minCoins} coins (${rules.minAmount} ${rules.currency}).`,
      });
    }

    /* 3. Check balance server-side */
    const balResult = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS balance
       FROM coin_ledger WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const balance = balResult.rows[0].balance;

    if (balance < amountCoins) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance.' });
    }

    /* 4. No pending withdrawal */
    const pendingCheck = await client.query(
      `SELECT 1 FROM withdrawals WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
      [userId],
    );
    if (pendingCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already have a pending withdrawal.' });
    }

    /* 5. Cooldown */
    const lastWithdrawal = await client.query(
      `SELECT created_at FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (lastWithdrawal.rows.length > 0) {
      const lastTime = new Date(lastWithdrawal.rows[0].created_at).getTime();
      if (Date.now() - lastTime < coins.withdrawalCooldownMs) {
        await client.query('ROLLBACK');
        return res
          .status(429)
          .json({ error: 'Please wait before requesting another withdrawal.' });
      }
    }

    /* 6. Idempotency — check if withdrawal with this key already exists */
    const idempCheck = await client.query(
      `SELECT id, status FROM withdrawals WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (idempCheck.rows.length > 0) {
      await client.query('COMMIT');
      return res.status(200).json({
        message: 'Withdrawal already submitted.',
        withdrawalId: idempCheck.rows[0].id,
        status: idempCheck.rows[0].status,
      });
    }

    /* 7. Debit (lock) coins */
    await coinService.debitCoins(
      userId,
      amountCoins,
      'withdrawal_lock',
      `withdrawal_lock_${idempotencyKey}`,
      `Withdrawal lock: ${amountCoins} coins`,
      client,
    );

    /* 8. Calculate currency amount */
    const amountCurrency = (amountCoins / coins.coinsPerRupee).toFixed(2);

    /* 9. Encrypt payment details */
    const encryptedDetails = encrypt(JSON.stringify(paymentDetails));

    /* 10. Insert withdrawal */
    const wdResult = await client.query(
      `INSERT INTO withdrawals
         (user_id, amount_coins, amount_currency, currency, method, payment_details, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status, created_at`,
      [userId, amountCoins, amountCurrency, rules.currency, method, encryptedDetails, idempotencyKey],
    );

    await client.query('COMMIT');

    const withdrawal = wdResult.rows[0];

    /* 11. Audit log */
    await auditService.logAudit(
      userId,
      'withdrawal_created',
      'withdrawal',
      withdrawal.id,
      { amountCoins, method, currency: rules.currency },
      req.ip,
    );

    return res.status(201).json({
      message: 'Withdrawal request submitted.',
      withdrawalId: withdrawal.id,
      status: withdrawal.status,
      createdAt: withdrawal.created_at,
    });
  } catch (err) {
    await client.query('ROLLBACK');

    if (err.message === 'INSUFFICIENT_BALANCE') {
      return res.status(400).json({ error: 'Insufficient balance.' });
    }

    console.error('[withdrawal] createWithdrawal error:', err.message);
    return res.status(500).json({ error: 'Failed to create withdrawal.' });
  } finally {
    client.release();
  }
}

/* ── My Withdrawals ──────────────────────────────────────── */

async function getMyWithdrawals(req, res) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await query(
      `SELECT id, amount_coins, amount_currency, currency, method, status,
              admin_note, created_at, updated_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset],
    );

    const countResult = await query(
      'SELECT COUNT(*)::int AS total FROM withdrawals WHERE user_id = $1',
      [req.user.id],
    );

    return res.json({
      withdrawals: result.rows,
      total: countResult.rows[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error('[withdrawal] getMyWithdrawals error:', err.message);
    return res.status(500).json({ error: 'Failed to load withdrawal history.' });
  }
}

module.exports = { getWithdrawalInfo, createWithdrawal, getMyWithdrawals };
