/**
 * Coin ledger service.
 *
 * Every coin operation is append-only. The user's balance is always
 * derived as  SELECT SUM(amount) FROM coin_ledger WHERE user_id = $1.
 *
 * All credit / debit helpers MUST receive a transaction client (from
 * pool.connect()) so the caller controls the transaction boundary.
 */
const { query, pool } = require('../../db/pool');

/**
 * Return the current balance (sum of all ledger entries) for a user.
 *
 * @param {number} userId
 * @returns {Promise<number>}
 */
async function getBalance(userId) {
  const result = await query(
    'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM coin_ledger WHERE user_id = $1',
    [userId],
  );
  return result.rows[0].balance;
}

/**
 * Credit (add) coins to a user's ledger.
 *
 * Uses `ref_id` as an idempotency key: if a row with the same ref_id
 * already exists, the INSERT is silently skipped (ON CONFLICT DO NOTHING).
 *
 * @param {number}          userId
 * @param {number}          amount      Positive integer
 * @param {string}          type        One of the CHECK-constrained types
 * @param {string}          refId       Idempotency key
 * @param {string}          description Human-readable reason
 * @param {import('pg').PoolClient} client  Transaction client
 * @returns {Promise<boolean>} true if row was inserted, false if idempotent skip
 */
async function creditCoins(userId, amount, type, refId, description, client) {
  const result = await client.query(
    `INSERT INTO coin_ledger (user_id, amount, type, ref_id, description)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
    [userId, Math.abs(amount), type, refId, description],
  );
  return result.rowCount > 0;
}

/**
 * Debit (subtract) coins from a user's ledger.
 *
 * Acquires a row-level advisory lock by selecting the user's ledger rows
 * with FOR UPDATE, verifies the balance is sufficient, then inserts a
 * negative entry.
 *
 * @param {number}          userId
 * @param {number}          amount      Positive integer (will be stored as negative)
 * @param {string}          type
 * @param {string}          refId       Idempotency key
 * @param {string}          description
 * @param {import('pg').PoolClient} client  Transaction client
 * @throws {Error} If balance is insufficient
 * @returns {Promise<boolean>} true if row was inserted, false if idempotent skip
 */
async function debitCoins(userId, amount, type, refId, description, client) {
  /* Lock all ledger rows for this user to prevent concurrent balance changes */
  const balResult = await client.query(
    `SELECT COALESCE(SUM(amount), 0)::int AS balance
     FROM coin_ledger
     WHERE user_id = $1
     FOR UPDATE`,
    [userId],
  );

  const balance = balResult.rows[0].balance;
  if (balance < Math.abs(amount)) {
    throw new Error('INSUFFICIENT_BALANCE');
  }

  const result = await client.query(
    `INSERT INTO coin_ledger (user_id, amount, type, ref_id, description)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
    [userId, -Math.abs(amount), type, refId, description],
  );
  return result.rowCount > 0;
}

/**
 * Paginated coin history for a user.
 *
 * @param {number} userId
 * @param {number} limit
 * @param {number} offset
 */
async function getHistory(userId, limit = 20, offset = 0) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const result = await query(
    `SELECT id, amount, type, description, created_at
     FROM coin_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, safeLimit, safeOffset],
  );

  const countResult = await query(
    'SELECT COUNT(*)::int AS total FROM coin_ledger WHERE user_id = $1',
    [userId],
  );

  return {
    entries: result.rows,
    total: countResult.rows[0].total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

module.exports = { getBalance, creditCoins, debitCoins, getHistory };
