/**
 * Rate-limiter presets backed by Redis.
 */
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const redis = require('../../db/redis');

/**
 * Factory — creates a limiter with a Redis-backed store.
 *
 * @param {{ windowMs: number, max: number, prefix: string, message?: string }} opts
 */
function createLimiter({ windowMs, max, prefix, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message || 'Too many requests, please try again later.' },
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: `rl:${prefix}:`,
    }),
  });
}

/** 100 requests per 15 minutes — applied globally */
const globalLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  prefix: 'global',
  message: 'Too many requests, please try again later.',
});

/** 10 requests per 15 minutes — auth endpoints (login / register) */
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  prefix: 'auth',
  message: 'Too many authentication attempts, please try again later.',
});

/** 5 requests per hour — referral qualification */
const referralLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  prefix: 'referral',
  message: 'Referral rate limit reached, please try again later.',
});

/** 3 requests per hour — withdrawal creation */
const withdrawalLimiter = createLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  prefix: 'withdrawal',
  message: 'Withdrawal rate limit reached, please try again later.',
});

module.exports = {
  globalLimiter,
  authLimiter,
  referralLimiter,
  withdrawalLimiter,
};
