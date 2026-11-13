/**
 * User routes — Profile, Coin History, Dashboard Stats
 * All routes require valid authentication.
 */
const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const { requireAuth } = require('../middleware/auth');

// GET /api/user/profile — Return authenticated user's profile and live balance
router.get('/profile', requireAuth, userController.getProfile);

// GET /api/user/coins — Paginated ledger entries (idempotent, append-only)
router.get('/coins', requireAuth, userController.getCoinHistory);

// GET /api/user/dashboard — Aggregate stats (balance, total earned, referrals, ads)
router.get('/dashboard', requireAuth, userController.getDashboardStats);

module.exports = router;
