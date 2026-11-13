/**
 * Withdrawal routes — Rules per country, Create withdrawal with Turnstile & DB lock, History
 */
const express = require('express');
const router = express.Router();

const withdrawalController = require('../controllers/withdrawalController');
const { requireAuth } = require('../middleware/auth');
const { withdrawalLimiter } = require('../middleware/rateLimiter');
const { verifyTurnstile } = require('../middleware/turnstile');
const { validate } = require('../middleware/validate');
const { createWithdrawalSchema } = require('../schemas/withdrawal');

// GET /api/withdrawal/info — Country-specific minimums, supported methods, active pending request
router.get('/info', requireAuth, withdrawalController.getWithdrawalInfo);

// POST /api/withdrawal/create — Validate balance, lock coins in append-only ledger inside DB transaction
router.post(
  '/create',
  requireAuth,
  withdrawalLimiter,
  verifyTurnstile,
  validate(createWithdrawalSchema),
  withdrawalController.createWithdrawal
);

// GET /api/withdrawal/history — Authenticated user's past withdrawal records
router.get('/history', requireAuth, withdrawalController.getMyWithdrawals);

module.exports = router;
