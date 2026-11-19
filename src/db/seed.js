const bcrypt = require('bcryptjs');
const db = require('./database');
const config = require('../config');

function seedDatabase() {
  // Check Settings
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  const hashedAdminPin = bcrypt.hashSync(config.adminPin, 10);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_pin_hash', ?)").run(hashedAdminPin);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('turnstile_site_key', ?)").run(config.turnstileSiteKey || '0x4AAAAAAF_8PdMI9qhkYmZq');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('turnstile_secret_key', ?)").run(config.turnstileSecretKey || '0x4AAAAAAF_8PYj1uQzH7hJwMXSu-6GjWds');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recaptcha_site_key', ?)").run(config.recaptchaSiteKey || '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recaptcha_secret_key', ?)").run(config.recaptchaSecretKey || '6LeYcCAuAAAAANftpMAN79ldhJuXZOp6_tqzZ85t');
  insertSetting.run('telegram_url', 'https://t.me/darkpaki_official');
  insertSetting.run('ad_video_url', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4');
  insertSetting.run('allow_instant_skip', 'false');

  // Self-heal CDN Stream URL to ensure it never self-references dark.anizon.watch
  try {
    const currentCdn = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get();
    if (!currentCdn || !currentCdn.value || currentCdn.value.includes('dark.anizon.watch') || currentCdn.value.includes('anizon.watch')) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cdn_stream_url', ?)").run(config.cdnStreamUrl || 'https://darkpaki-stream.onrender.com');
    }
  } catch (e) {}

  // Ensure Permanent Verified Admin Accounts (Clean Zero-Fake State)
  const defaultAdminPassHash = bcrypt.hashSync('Admin@7860', 10);
  
  // 1. admin@darkpaki.com
  const existingDarkpakiAdmin = db.prepare('SELECT id FROM users WHERE gmail = ? COLLATE NOCASE').get('admin@darkpaki.com');
  if (!existingDarkpakiAdmin) {
    db.prepare(`
      INSERT INTO users (name, gmail, password, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified, account_status)
      VALUES ('DarkPAKI Admin', 'admin@darkpaki.com', ?, '', 'DPK-ADMIN-MAIN', 100.0, 10000, 0, 0, 'DPKADMIN786', 'admin', 1, 'active')
    `).run(defaultAdminPassHash);
  } else {
    db.prepare("UPDATE users SET password = ?, role = 'admin', human_verified = 1 WHERE id = ?").run(defaultAdminPassHash, existingDarkpakiAdmin.id);
  }

  // 2. naved.official@gmail.com
  const existingNaved = db.prepare('SELECT id FROM users WHERE gmail = ? COLLATE NOCASE').get('naved.official@gmail.com');
  if (!existingNaved) {
    db.prepare(`
      INSERT INTO users (name, gmail, password, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified, account_status)
      VALUES ('Naved Master', 'naved.official@gmail.com', ?, '', 'DPK-ADMIN-01', 100.0, 10000, 0, 0, 'DPKNAVED786', 'admin', 1, 'active')
    `).run(defaultAdminPassHash);
  } else {
    db.prepare("UPDATE users SET password = ?, role = 'admin', human_verified = 1 WHERE id = ?").run(defaultAdminPassHash, existingNaved.id);
  }

  console.log('[SEED] Database verification complete. Zero dummy/fake posts or items seeded.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
