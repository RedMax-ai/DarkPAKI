const express = require('express');
const router = express.Router();
const earningController = require('../controllers/earningController');
const { requireAuth } = require('../middleware/auth');
const { withdrawalLimiter } = require('../middleware/rateLimiter');

router.post('/watch-bonus', requireAuth, earningController.creditWatchBonus);
router.post('/test-referral', requireAuth, earningController.simulateReferral);
router.post('/convert-coins', requireAuth, earningController.convertCoins);
router.post('/withdraw', requireAuth, withdrawalLimiter, earningController.submitWithdrawal);
router.get('/withdrawals', requireAuth, earningController.getWithdrawals);

// Creator Follow & Monetization
router.post('/follow', earningController.followCreator);
router.get('/monetization-status', requireAuth, earningController.getMonetizationStatus);
router.post('/apply-monetization', requireAuth, earningController.applyMonetization);

module.exports = router;

