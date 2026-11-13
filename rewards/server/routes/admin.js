/**
 * Admin routes — Complete back-office management with RBAC & Audit Trail
 * Every route is protected with `requireAdmin` middleware.
 */
const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { reviewWithdrawalSchema } = require('../schemas/withdrawal');

// Apply admin RBAC check to ALL routes in this router
router.use(requireAdmin);

// GET /api/admin/stats — Total users, coins in circulation, pending withdrawals, flagged referrals
router.get('/stats', adminController.getDashboardStats);

// GET /api/admin/withdrawals — Paginated pending / all withdrawal requests
router.get('/withdrawals', adminController.getPendingWithdrawals);

// PUT /api/admin/withdrawals/:id/review — Approve or reject (releases locked coins on rejection)
router.put(
  '/withdrawals/:id/review',
  validate(reviewWithdrawalSchema),
  adminController.reviewWithdrawal
);

// PUT /api/admin/withdrawals/:id/paid — Mark approved withdrawal as paid
router.put('/withdrawals/:id/paid', adminController.markWithdrawalPaid);

// GET /api/admin/referrals/flagged — Referrals flagged by anti-cheat heuristics
router.get('/referrals/flagged', adminController.getFlaggedReferrals);

// PUT /api/admin/referrals/:id/review — Admin manual approve (credits coins) or reject
router.put('/referrals/:id/review', adminController.reviewReferral);

// GET /api/admin/audit-log — Paginated immutable audit trail
router.get('/audit-log', adminController.getAuditLog);

// GET /api/admin/users — Paginated user directory with balances and statuses
router.get('/users', adminController.getUsers);

// PUT /api/admin/users/:id/ban — Ban / unban user and revoke all active sessions
router.put('/users/:id/ban', adminController.banUser);

module.exports = router;
