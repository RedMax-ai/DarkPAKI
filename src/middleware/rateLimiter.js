const { rateLimit } = require('express-rate-limit');

// General API Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 500, // Limit each IP to 500 requests per 15 minutes
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.'
  }
});

// Strict Auth / Login Limiter (Anti-Bot Brute Force)
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 15, // Limit each IP to 15 login attempts per minute
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts! Anti-bot shield active. Please wait 60 seconds.'
  }
});

// Withdrawal Limiter
const withdrawalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many withdrawal requests! Please wait before submitting another.'
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  withdrawalLimiter
};

