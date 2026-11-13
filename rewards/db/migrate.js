/**
 * Migration runner — reads every *.sql file in db/migrations/ (sorted)
 * and executes them against the database.
 *
 * Usage:  npm run db:migrate
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function migrate() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] No SQL files found in', migrationsDir);
    process.exit(0);
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`[migrate] Running ${file} …`);
    try {
      await pool.query(sql);
      console.log(`[migrate] ✔ ${file}`);
    } catch (err) {
      console.error(`[migrate] ✘ ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log('[migrate] All migrations applied.');
  await pool.end();
  process.exit(0);
}

migrate();
