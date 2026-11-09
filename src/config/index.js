const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'production',
  jwtSecret: process.env.JWT_SECRET || 'darkpaki_default_secure_secret_key_9823412',
  adminPin: process.env.ADMIN_PIN || '7860',
  dbPath: path.resolve(__dirname, '../../', process.env.DB_PATH || 'data/darkpaki.db'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cdnStreamUrl: process.env.CDN_STREAM_URL || 'https://darkpaki-stream.onrender.com',
  cdnApiKey: process.env.CDN_API_KEY || 'DarkPakiAdminSecret2026'
};

