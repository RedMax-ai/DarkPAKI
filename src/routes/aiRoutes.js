const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const { apiLimiter } = require('../middleware/rateLimiter');

router.post('/generate', apiLimiter, aiController.generateImage);
router.get('/gallery', aiController.getGallery);
router.post('/images/:id/like', aiController.likeImage);

module.exports = router;

