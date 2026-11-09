const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');

router.get('/', videoController.getVideos);
router.get('/config', videoController.getAdConfig);
router.get('/:id', videoController.getVideoById);

module.exports = router;

