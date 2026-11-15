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
  insertSetting.run('telegram_url', 'https://t.me/darkpaki_official');
  insertSetting.run('ad_video_url', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4');
  insertSetting.run('allow_instant_skip', 'false');

  // Check Initial Verified User (Clean Zero-State, Zero Fake Data)
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified, account_status)
      VALUES (?, ?, '', ?, 0.0, 50, 0, 0, 'DPK786', 'admin', 1, 'active')
    `);
    insertUser.run(
      "Naved Master",
      "naved.official@gmail.com",
      "DPK-ADMIN-01"
    );
    console.log('[SEED] Inserted clean default admin user (0 balance, 0 refs, 0 ads).');
  }

  console.log('[SEED] Database verification complete. Zero dummy/fake posts or items seeded.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
