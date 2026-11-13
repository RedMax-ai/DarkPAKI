/**
 * Central config — reads .env and exports typed values.
 * Every module imports from here; nothing reads process.env directly.
 */
require('dotenv').config();

function required(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

module.exports = {
  nodeEnv:        process.env.NODE_ENV || 'development',
  port:           parseInt(process.env.PORT, 10) || 4000,
  apiUrl:         process.env.API_URL || 'http://localhost:4000',
  webUrl:         process.env.WEB_URL || 'http://localhost:3000',

  // Database
  databaseUrl:    required('DATABASE_URL'),
  dbPoolMin:      parseInt(process.env.DB_POOL_MIN, 10) || 2,
  dbPoolMax:      parseInt(process.env.DB_POOL_MAX, 10) || 10,

  // Redis
  redisUrl:       required('REDIS_URL'),

  // Google OAuth
  googleClientId:     required('GOOGLE_CLIENT_ID'),
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',

  // Cloudflare Turnstile
  turnstileSiteKey:   required('TURNSTILE_SITE_KEY'),
  turnstileSecretKey: required('TURNSTILE_SECRET_KEY'),

  // JWT
  jwtAccessSecret:  required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessExpiry:  process.env.JWT_ACCESS_EXPIRY  || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',

  // CSRF
  csrfSecret: required('CSRF_SECRET'),

  // Encryption
  encryptionKey:      required('ENCRYPTION_KEY'),
  encryptionIvLength: parseInt(process.env.ENCRYPTION_IV_LENGTH, 10) || 16,

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim()),

  // Admin bootstrap
  initialAdminGoogleId: process.env.INITIAL_ADMIN_GOOGLE_ID || '',
};
