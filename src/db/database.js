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
      balance REAL NOT NULL DEFAULT 0.275,
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

    CREATE TABLE IF NOT EXISTS usernames (
      normalized_username TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS video_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      reviewer_id INTEGER,
      decision TEXT NOT NULL,
      reason_code TEXT,
      notes TEXT,
      ai_signals TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_video_reviews_video ON video_reviews(video_id);

    CREATE TABLE IF NOT EXISTS wallet_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      coin_amount INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      source_id TEXT,
      idempotency_key TEXT UNIQUE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user ON wallet_ledger(user_id);

    CREATE TABLE IF NOT EXISTS ad_reward_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      provider_event_id TEXT UNIQUE NOT NULL,
      reward_amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'VERIFIED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_links_user ON user_links(user_id);

    CREATE TABLE IF NOT EXISTS saved_videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      video_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, video_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_saved_videos_user ON saved_videos(user_id);

    CREATE TABLE IF NOT EXISTS user_follows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      following_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, following_id),
      FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id);
    CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#7C3AED',
      icon TEXT DEFAULT 'fa-folder',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_folders_slug ON folders(slug);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      usage_count INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

    CREATE TABLE IF NOT EXISTS video_views_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      creator_name TEXT,
      user_id INTEGER,
      source TEXT NOT NULL DEFAULT 'direct',
      ip TEXT,
      user_agent TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_views_log_video ON video_views_log(video_id);
    CREATE INDEX IF NOT EXISTS idx_views_log_creator ON video_views_log(creator_name);
    CREATE INDEX IF NOT EXISTS idx_views_log_user ON video_views_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_views_log_created ON video_views_log(created_at);
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
  runMigration('ALTER TABLE users ADD COLUMN username TEXT;');
  runMigration("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';");
  runMigration('ALTER TABLE users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;');
  runMigration("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active';");
  runMigration("ALTER TABLE users ADD COLUMN pronouns TEXT DEFAULT '';");
  runMigration("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'Prefer not to say';");
  runMigration("ALTER TABLE users ADD COLUMN banner_style TEXT DEFAULT '';");
  runMigration("ALTER TABLE users ADD COLUMN banner_url TEXT DEFAULT '';");
  runMigration('ALTER TABLE email_otps ADD COLUMN pending_name TEXT;');
  runMigration('ALTER TABLE email_otps ADD COLUMN pending_pass TEXT;');
  runMigration('ALTER TABLE email_otps ADD COLUMN pending_ref TEXT;');

  runMigration("ALTER TABLE videos ADD COLUMN status TEXT NOT NULL DEFAULT 'APPROVED';");
  runMigration('ALTER TABLE videos ADD COLUMN owner_name TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN owner_email TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN user_id INTEGER;');
  runMigration('ALTER TABLE videos ADD COLUMN is_pinned INTEGER DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN grid_order INTEGER DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN views_count INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN dislikes_count INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN is_short INTEGER NOT NULL DEFAULT 0;');
  runMigration('ALTER TABLE videos ADD COLUMN rejection_reason TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN storage_key TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN thumbnail_key TEXT;');
  runMigration('ALTER TABLE videos ADD COLUMN duration_seconds INTEGER DEFAULT 0;');
  runMigration('ALTER TABLE user_follows ADD COLUMN follower_id INTEGER;');
  runMigration('ALTER TABLE user_follows ADD COLUMN following_id INTEGER;');
  runMigration('ALTER TABLE user_follows ADD COLUMN follower_user_id INTEGER;');
  runMigration('ALTER TABLE user_follows ADD COLUMN following_user_id INTEGER;');
  try {
    db.prepare('UPDATE user_follows SET follower_id = follower_user_id WHERE follower_id IS NULL AND follower_user_id IS NOT NULL').run();
    db.prepare('UPDATE user_follows SET following_id = following_user_id WHERE following_id IS NULL AND following_user_id IS NOT NULL').run();
    db.prepare('UPDATE user_follows SET follower_user_id = follower_id WHERE follower_user_id IS NULL AND follower_id IS NOT NULL').run();
    db.prepare('UPDATE user_follows SET following_user_id = following_id WHERE following_user_id IS NULL AND following_id IS NOT NULL').run();
  } catch (err) {}
  runMigration("ALTER TABLE videos ADD COLUMN mime_type TEXT DEFAULT 'video/mp4';");
  runMigration("ALTER TABLE videos ADD COLUMN moderation_status TEXT DEFAULT 'clear';");
  runMigration('ALTER TABLE videos ADD COLUMN ai_risk_score REAL DEFAULT 0.0;');
  runMigration("ALTER TABLE videos ADD COLUMN ai_details TEXT DEFAULT '';");
  runMigration('ALTER TABLE videos ADD COLUMN qualified_views INTEGER DEFAULT 0;');
  runMigration("ALTER TABLE videos ADD COLUMN description TEXT DEFAULT '';");
  runMigration("ALTER TABLE videos ADD COLUMN tags TEXT DEFAULT '';");
  runMigration("ALTER TABLE videos ADD COLUMN folder_id INTEGER;");
  runMigration("ALTER TABLE videos ADD COLUMN folder_name TEXT DEFAULT '';");
  runMigration("CREATE INDEX IF NOT EXISTS idx_videos_folder_id ON videos(folder_id);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_videos_folder_name ON videos(folder_name);");

  // Default folders seed if empty
  try {
    const fCount = db.prepare('SELECT COUNT(*) as count FROM folders').get()?.count || 0;
    if (fCount === 0) {
      const initFolders = [
        ['Trending Videos', 'trending-videos', '#F43F5E', 'fa-fire', 'High-heat trending streams and viral releases'],
        ['VIP Exclusive', 'vip-exclusive', '#7C3AED', 'fa-gem', 'Exclusive premium uncut content for VIP viewers'],
        ['Desi Special', 'desi-special', '#F59E0B', 'fa-star', 'Desi culture and regional special releases'],
        ['Viral Hits', 'viral-hits', '#10B981', 'fa-bolt', 'Internet sensation viral videos']
      ];
      const ins = db.prepare('INSERT OR IGNORE INTO folders (name, slug, color, icon, description) VALUES (?, ?, ?, ?, ?)');
      for (const [fn, fs, fc, fi, fd] of initFolders) {
        ins.run(fn, fs, fc, fi, fd);
      }
    }
  } catch (err) {
    // ignore
  }

  // Default tags seed if empty
  try {
    const tCount = db.prepare('SELECT COUNT(*) as count FROM tags').get()?.count || 0;
    if (tCount === 0) {
      const initTags = [
        '#trending', '#viral', '#desi', '#4k', '#uncut', '#exclusive',
        '#hd', '#webseries', '#vip', '#hot', '#movies', '#pakistani'
      ];
      const insTag = db.prepare('INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 1)');
      for (const t of initTags) {
        insTag.run(t);
      }
    }
  } catch (err) {
    // ignore
  }

  runMigration("ALTER TABLE withdrawals ADD COLUMN tx_hash TEXT DEFAULT '';");
  runMigration("ALTER TABLE withdrawals ADD COLUMN admin_notes TEXT DEFAULT '';");
  runMigration('ALTER TABLE withdrawals ADD COLUMN processed_at DATETIME;');

  // Creator Settings Migrations (Payout wallet & channel preferences)
  runMigration("ALTER TABLE users ADD COLUMN default_payout_type TEXT DEFAULT 'BINANCE_PAY';");
  runMigration("ALTER TABLE users ADD COLUMN default_payout_address TEXT DEFAULT '';");
  runMigration("ALTER TABLE users ADD COLUMN allow_comments INTEGER NOT NULL DEFAULT 1;");
  runMigration("ALTER TABLE users ADD COLUMN show_watermark INTEGER NOT NULL DEFAULT 1;");
  runMigration("ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;");

  // Video Views Log Table Migration
  runMigration(`
    CREATE TABLE IF NOT EXISTS video_views_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      creator_name TEXT,
      user_id INTEGER,
      source TEXT NOT NULL DEFAULT 'direct',
      ip TEXT,
      user_agent TEXT,
      device_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
  `);
  runMigration("ALTER TABLE video_views_log ADD COLUMN device_id TEXT;");
  runMigration("CREATE INDEX IF NOT EXISTS idx_views_log_video ON video_views_log(video_id);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_views_log_creator ON video_views_log(creator_name);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_views_log_user ON video_views_log(user_id);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_views_log_created ON video_views_log(created_at);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_views_log_dedup ON video_views_log(video_id, device_id, created_at);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_views_log_ip_dedup ON video_views_log(video_id, ip, created_at);");

  // Video Likes & Dislikes Reactions Table Migration
  runMigration(`
    CREATE TABLE IF NOT EXISTS video_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      device_id TEXT NOT NULL,
      reaction TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(video_id, device_id),
      FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
    );
  `);
  runMigration("CREATE INDEX IF NOT EXISTS idx_video_reactions_vid ON video_reactions(video_id);");
  runMigration("CREATE INDEX IF NOT EXISTS idx_video_reactions_device ON video_reactions(device_id);");

  // Sync existing videos' views_count from views string if missing
  try {
    const existingVideos = db.prepare('SELECT id, views, views_count FROM videos').all();
    for (const v of existingVideos) {
      if (v.views_count === null || v.views_count === undefined) {
        const match = (v.views || '').match(/([\d.]+)\s*([KkMm]?)/);
        let count = 0;
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

  // Ensure all users have a valid unique username synced in usernames table
  try {
    const usersWithoutUsername = db.prepare("SELECT id, name, ref_code, username FROM users WHERE username IS NULL OR trim(username) = ''").all();
    for (const u of usersWithoutUsername) {
      let base = (u.name || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '');
      if (base.length < 3) base = 'user_' + (u.ref_code || Math.floor(1000 + Math.random() * 9000)).toLowerCase();
      let candidate = base;
      let counter = 1;
      while (db.prepare('SELECT user_id FROM usernames WHERE normalized_username = ?').get(candidate)) {
        candidate = `${base}_${counter++}`;
      }
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(candidate, u.id);
      db.prepare('INSERT OR IGNORE INTO usernames (normalized_username, user_id) VALUES (?, ?)').run(candidate, u.id);
    }
  } catch (err) {
    // ignore
  }
}

initializeSchema();

module.exports = db;

