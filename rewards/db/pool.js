/**
 * PostgreSQL connection pool.
 * Every module that needs the database imports { pool, query } from here.
 */
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  min: config.dbPoolMin,
  max: config.dbPoolMax,
  /* Return Date columns as ISO strings to avoid timezone surprises */
  types: undefined,
});

/* Log pool errors so they don't crash the process silently */
pool.on('error', (err) => {
  console.error('[pg-pool] Unexpected client error:', err.message);
});

/**
 * Convenience wrapper — use for simple one-off queries.
 * For transactions, call pool.connect() and use the client directly.
 *
 * @param {string} text  SQL with $1, $2 … placeholders
 * @param {any[]}  params  Bind values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
