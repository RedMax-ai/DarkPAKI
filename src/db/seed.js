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
  insertSetting.run('ad_video_url', 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
  insertSetting.run('allow_instant_skip', 'false');

  // Ensure Adsterra Ad Unit Codes (dark.anizon.watch - Zone 6215251: 300x250 Banner & Native Banner 4:1)
  const defaultAdsterraBanner = `<div class="adsterra-banner-wrapper flex flex-col items-center justify-center gap-4 w-full my-2">
  <div class="adsterra-300x250 flex justify-center items-center w-full max-w-[300px] min-h-[250px] overflow-hidden rounded-xl bg-black/40 border border-white/5">
    <script type="text/javascript">
      atOptions = {
        'key' : '43f9e09cd4ef7cb118ca50792e70a158',
        'format' : 'iframe',
        'height' : 250,
        'width' : 300,
        'params' : {}
      };
    </script>
    <script type="text/javascript" src="https://biomanos.org/22/43f9e09cd4ef7cb118ca50792e70a158"></script>
  </div>
  <div class="adsterra-native-widget w-full flex justify-center items-center">
    <script async="async" data-cfasync="false" src="https://biomanos.org/21/8ae2cfde322dd962f3ee3497927c63f2"></script>
    <div id="container-8ae2cfde322dd962f3ee3497927c63f2" class="w-full"></div>
  </div>
</div>`;

  try {
    const existingBanner = db.prepare("SELECT value FROM settings WHERE key = 'banner_ad_html'").get();
    if (!existingBanner || !existingBanner.value || existingBanner.value.includes('alwingulla.com')) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('banner_ad_html', ?)").run(defaultAdsterraBanner);
    }
  } catch (e) {}

  // Replace dead Google sample ad URLs with working fallback stream
  try {
    const adRow = db.prepare("SELECT value FROM settings WHERE key = 'ad_video_url'").get();
    if (!adRow || !adRow.value || adRow.value.includes('commondatastorage.googleapis.com')) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_video_url', ?)").run('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');
    }
  } catch (e) {}

  // In-Stream Video VAST Tag (WYNQ & ExoClick Waterfall)
  try {
    const vastRow = db.prepare("SELECT value FROM settings WHERE key = 'vast_tag_url'").get();
    if (!vastRow || !vastRow.value || vastRow.value.includes('magsrv')) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('vast_tag_url', ?)").run('https://rodexchange.com/adt/vd.php?pid=0SA1QS7GFZZ4D');
    }
  } catch (e) {}

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

  // Ensure zero dummy/fake showcase videos remain - only user's real uploaded videos
  try {
    db.prepare("DELETE FROM videos WHERE creator IN ('DarkPAKI Cinema', 'AnimeVerse HD', 'VIP Stream Club', 'Apex Speed', 'SciFi Studio')").run();
  } catch (err) {}

  console.log('[SEED] Database verification complete. Zero dummy/fake posts or items seeded.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
