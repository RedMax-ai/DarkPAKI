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

// Content Management
router.get('/videos', requireAdmin, adminController.getAdminVideos);
router.post('/videos', requireAdmin, adminController.createVideo);
router.put('/videos/:id', requireAdmin, adminController.updateVideo);
router.delete('/videos/:id', requireAdmin, adminController.deleteVideo);
router.post('/videos/:id/feature', requireAdmin, adminController.toggleFeatured);

// CDN Stream Integration
router.post('/cdn-convert', requireAdmin, adminController.cdnConvertTelegramLink);

// Platform Settings & Control
router.get('/settings', requireAdmin, adminController.getSettings);
router.put('/settings', requireAdmin, adminController.updateSettings);
router.post('/reset-device', requireAdmin, adminController.resetDeviceLock);

module.exports = router;
