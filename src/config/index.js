const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const rawCdnUrl = (process.env.CDN_STREAM_URL || '').trim();
const safeCdnUrl = (rawCdnUrl && !rawCdnUrl.includes('anizon.watch')) 
  ? rawCdnUrl 
  : 'https://darkpaki-stream.onrender.com';

module.exports = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'production',
  jwtSecret: process.env.JWT_SECRET || 'darkpaki_default_secure_secret_key_9823412',
  adminPin: process.env.ADMIN_PIN || '7860',
  dbPath: path.resolve(__dirname, '../../', process.env.DB_PATH || 'data/darkpaki.db'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cdnStreamUrl: safeCdnUrl,
  cdnApiKey: process.env.CDN_API_KEY || 'DarkPakiAdminSecret2026',
  adminAccessKey: process.env.ADMIN_ACCESS_KEY || 'naved_master_786',
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '0x4AAAAAAF_8PdMI9qhkYmZq',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || '0x4AAAAAAF_8PYj1uQzH7hJwMXSu-6GjWds',
  recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK',
  recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY || '6LeYcCAuAAAAANftpMAN79ldhJuXZOp6_tqzZ85t'
};

