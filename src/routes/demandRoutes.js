const express = require('express');
const router = express.Router();
const demandController = require('../controllers/demandController');

router.get('/poll', demandController.getDemands);
router.post('/poll/:id/vote', demandController.voteDemand);
router.get('/comments', demandController.getComments);
router.post('/comments', demandController.createCommentAndDemand);
router.post('/comments/:id/like', demandController.likeComment);

module.exports = router;

