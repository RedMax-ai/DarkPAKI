/**
 * Referral routes — Info, Link, Stats, Qualifying Action
 */
const express = require('express');
const router = express.Router();

const referralController = require('../controllers/referralController');
const { requireAuth } = require('../middleware/auth');
const { referralLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { qualifyReferralSchema } = require('../schemas/referral');

// GET /api/referral/info — User's referral code, link, and conversion stats
router.get('/info', requireAuth, referralController.getReferralInfo);

// POST /api/referral/qualify — Trigger qualification action (credits pending bonus inside DB tx)
router.post(
  '/qualify',
  requireAuth,
  referralLimiter,
  validate(qualifyReferralSchema),
  referralController.qualifyReferral
);

module.exports = router;
