/**
 * Auth routes — Google Sign-In, Token Refresh, Logout, Current User
 */
const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { verifyTurnstile } = require('../middleware/turnstile');
const { validate } = require('../middleware/validate');
const { googleLoginSchema } = require('../schemas/auth');

// POST /api/auth/google — Verify ID token, check Turnstile, rate limit, issue session
router.post(
  '/google',
  authLimiter,
  verifyTurnstile,
  validate(googleLoginSchema),
  authController.googleLogin
);

// POST /api/auth/refresh — Rotate refresh token, issue new access token
router.post('/refresh', authController.refreshToken);

// POST /api/auth/logout — Invalidate server-side session, clear cookies
router.post('/logout', requireAuth, authController.logout);

// GET /api/auth/me — Return current authenticated user
router.get('/me', requireAuth, authController.getMe);

module.exports = router;
