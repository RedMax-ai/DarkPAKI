const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireAuth } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// Profile Read & Check
router.get('/me', requireAuth, profileController.getProfileMe);
router.get('/check-username', profileController.checkUsernameAvailability);

// Profile Updates
router.put('/', requireAuth, profileController.updateProfile);
router.post('/avatar', requireAuth, profileController.uploadAvatar);
router.delete('/avatar', requireAuth, profileController.removeAvatar);

// Posts Grid & Reordering
router.get('/posts', requireAuth, profileController.getUserPosts);
router.put('/grid-order', requireAuth, profileController.updateGridOrder);

// External Links Sub-Panel
router.get('/links', requireAuth, profileController.getLinks);
router.post('/links', requireAuth, profileController.addLink);
router.put('/links', requireAuth, profileController.updateLinksOrder);
router.delete('/links/:id', requireAuth, profileController.deleteLink);

// Saved Videos
router.post('/save-video', requireAuth, profileController.saveVideo);
router.delete('/save-video/:videoId', requireAuth, profileController.unsaveVideo);

// Follow / Followers
router.get('/followers', requireAuth, profileController.getFollowers);
router.get('/following', requireAuth, profileController.getFollowing);
router.post('/follow/:targetUserId', requireAuth, profileController.toggleFollow);

module.exports = router;
