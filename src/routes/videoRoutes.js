const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');

router.get('/', videoController.getVideos);
router.get('/config', videoController.getAdConfig);
router.get('/:id', videoController.getVideoById);
router.post('/:id/view', videoController.incrementView);
router.post('/user-upload', videoController.submitUserVideo);

module.exports = router;

