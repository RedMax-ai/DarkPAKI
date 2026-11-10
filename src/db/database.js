const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

// Ensure database directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite Database
const db = new DatabaseSync(config.dbPath);

// Performance & Concurrency Pragmas
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA synchronous = NORMAL;');

// Create Database Schema
function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      creator TEXT NOT NULL,
      views TEXT NOT NULL DEFAULT '0 views',
      duration TEXT NOT NULL DEFAULT '10:00',
      src TEXT NOT NULL,
      thumb_img TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT 'TRENDING VIDEOS',
      requested_by TEXT NOT NULL DEFAULT 'Demanded by users',
      is_featured INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      gmail TEXT UNIQUE NOT NULL COLLATE NOCASE,
      phone TEXT NOT NULL,
      device_id TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 25.0,
      coins INTEGER NOT NULL DEFAULT 50,
      referrals INTEGER NOT NULL DEFAULT 0,
      ads_watched INTEGER NOT NULL DEFAULT 0,
      ref_code TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_device ON users(device_id);
    CREATE INDEX IF NOT EXISTS idx_users_gmail ON users(gmail);
    CREATE INDEX IF NOT EXISTS idx_users_ref_code ON users(ref_code);

    CREATE TABLE IF NOT EXISTS demands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      creator_target TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Community Request',
      votes INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS demand_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      demand_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(demand_id, device_id),
      FOREIGN KEY (demand_id) REFERENCES demands(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      avatar_bg TEXT NOT NULL DEFAULT 'from-indigo-500 to-violet-600',
      target_creator TEXT NOT NULL,
      badge TEXT NOT NULL DEFAULT '🔥 High-Demand Request',
      is_demand INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      likes INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comment_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, device_id),
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      upi_id TEXT NOT NULL,
      amount REAL NOT NULL,
      device_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL,
      ip TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'Cyberpunk 18+',
      image_url TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL DEFAULT '1:1',
      likes INTEGER NOT NULL DEFAULT 0,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_image_likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(image_id, device_id),
      FOREIGN KEY (image_id) REFERENCES ai_images(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      contact_method TEXT NOT NULL,
      contact_value TEXT NOT NULL,
      video_title TEXT,
      file_url TEXT,
      message TEXT NOT NULL,
      device_id TEXT,
      status TEXT NOT NULL DEFAULT 'NEW',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_user_contacts_device ON user_contacts(device_id);

    CREATE TABLE IF NOT EXISTS follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_name TEXT NOT NULL COLLATE NOCASE,
      follower_device_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(creator_name, follower_device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_follows_creator ON follows(creator_name);

    CREATE TABLE IF NOT EXISTS monetization_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      creator_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      channel_name TEXT,
      total_views INTEGER DEFAULT 0,
      followers_count INTEGER DEFAULT 0,
      max_single_views INTEGER DEFAULT 0,
      is_human_verified INTEGER DEFAULT 1,
      status TEXT DEFAULT 'PENDING',
      admin_notes TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_monetization_status ON monetization_applications(status);

    CREATE TABLE IF NOT EXISTS email_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail TEXT NOT NULL,
      otp_code TEXT NOT NULL,
      device_id TEXT,
      pending_name TEXT,
      pending_pass TEXT,
      pending_ref TEXT,
      expires_at DATETIME NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_email_otps_gmail ON email_otps(gmail);
  `);

  // Safe runtime migrations for existing databases
  const runMigration = (sql) => {
    try {
      db.exec(sql);
    } catch (e) {
      // Column or table already exists or migrated
    }
  };

  runMigration('ALTER TABLE users ADD COLUMN coins INTEGER NOT NULL DEFAULT 50;');
  runMigration('ALTER TABLE users ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE users ADD COLUMN is_monetized INTEGER NOT NULL DEFAULT 0;');
  runMigration("ALTER TABLE users ADD COLUMN monetization_status TEXT NOT NULL DEFAULT 'NONE';");
  runMigration('ALTER TABLE users ADD COLUMN real_name TEXT;');
  runMigration('ALTER TABLE users ADD COLUMN human_verified INTEGER NOT NULL DEFAULT 1;');
  runMigration("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT '';");
  runMigration("ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT '';");
  runMigration("ALTER TABLE users ADD COLUMN password TEXT DEFAULT '';");
  runMigration('ALTER TABLE email_otps ADD COLUMN pending_name TEXT;');
  runMigration('ALTER TABLE email_otps ADD COLUMN pending_pass TEXT;');
  runMigration('ALTER TABLE email_otps ADD COLUMN pending_ref TEXT;');

  runMigration("ALTER TABLE videos ADD COLUMN status TEXT NOT NULL DEFAULT 'APPROVED';");
  runMigration('ALTER TABLE videos ADD COLUMN owner_name TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN owner_email TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN views_count INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN rejection_reason TEXT;');

  // Sync existing videos' views_count from views string if 0
  try {
    const existingVideos = db.prepare('SELECT id, views, views_count FROM videos').all();
    for (const v of existingVideos) {
      if (!v.views_count || v.views_count === 0) {
        const match = (v.views || '').match(/([\d.]+)\s*([KkMm]?)/);
        let count = 1200;
        if (match) {
          const num = parseFloat(match[1]);
          const unit = (match[2] || '').toUpperCase();
          if (unit === 'K') count = Math.round(num * 1000);
          else if (unit === 'M') count = Math.round(num * 1000000);
          else count = Math.round(num);
        }
        db.prepare('UPDATE videos SET views_count = ? WHERE id = ?').run(count, v.id);
      }
    }
  } catch (err) {
    // ignore
  }
}

initializeSchema();

module.exports = db;

