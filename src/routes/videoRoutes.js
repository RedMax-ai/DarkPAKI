const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');

router.get('/', videoController.getVideos);
router.get('/config', videoController.getAdConfig);
router.get('/vast-ad', videoController.getVastAd);
router.get('/proxy-stream', videoController.proxyVideoStream);
router.get('/:id', videoController.getVideoById);
router.get('/:id/reactions', videoController.getVideoReactions);
router.post('/:id/react', videoController.reactToVideo);
router.post('/:id/view', videoController.incrementView);
router.post('/upload-thumbnail', videoController.uploadThumbnail);
router.post('/user-upload', videoController.submitUserVideo);

module.exports = router;

