const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

// Admin Auth
router.post('/login', authLimiter, adminController.loginAdmin);
router.get('/verify', requireAdmin, adminController.verifyAuth);

// Analytics & Overview
router.get('/stats', requireAdmin, adminController.getStats);

// Content Management & Review Queue
router.get('/videos', requireAdmin, adminController.getAdminVideos);
router.post('/videos', requireAdmin, adminController.createVideo);
router.put('/videos/:id', requireAdmin, adminController.updateVideo);
router.delete('/videos/:id', requireAdmin, adminController.deleteVideo);
router.post('/videos/:id/feature', requireAdmin, adminController.toggleFeatured);

// Community Submissions Moderation Queue
router.get('/pending-videos', requireAdmin, adminController.getPendingVideos);
router.post('/videos/:id/approve', requireAdmin, adminController.approveVideo);
router.post('/videos/:id/reject', requireAdmin, adminController.rejectVideo);

// Creator Monetization Review & Audit
router.get('/monetization-applications', requireAdmin, adminController.getMonetizationApplications);
router.post('/monetization-applications/:id/review', requireAdmin, adminController.reviewMonetizationApplication);
router.post('/creator-monetization/toggle', requireAdmin, adminController.toggleCreatorMonetization);

// CDN Stream Integration
router.post('/cdn-convert', requireAdmin, adminController.cdnConvertTelegramLink);
router.post('/upload-direct', requireAdmin, adminController.cdnDirectUpload);
router.post('/upload', requireAdmin, adminController.cdnDirectUpload);

// Platform Settings & Control
router.get('/settings', requireAdmin, adminController.getSettings);
router.put('/settings', requireAdmin, adminController.updateSettings);
router.post('/reset-device', requireAdmin, adminController.resetDeviceLock);

// Secure Master-Key Cloud Sync (For Local Admin pushing videos directly to Live Server)
const config = require('../config');
router.post('/sync-video', (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey || apiKey !== config.cdnApiKey) {
    return res.status(403).json({ success: false, error: 'Access Denied: Invalid Master Sync Key' });
  }
  return adminController.createVideo(req, res, next);
});

module.exports = router;
