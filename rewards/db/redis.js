/**
 * Redis client (ioredis).
 * Used for rate-limiting stores and ephemeral caches.
 */
const Redis = require('ioredis');
const config = require('../config');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[redis] Connected');
});

module.exports = redis;
