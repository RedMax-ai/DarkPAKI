const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contactController');

router.post('/submit', contactController.submitContact);
router.get('/my-requests', contactController.getRecentContacts);

module.exports = router;
