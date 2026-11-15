const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');

router.get('/captcha', authController.generateCaptcha);
router.get('/config', authController.getRecaptchaConfig);
router.get('/recaptcha-config', authController.getRecaptchaConfig);
router.get('/turnstile-config', authController.getRecaptchaConfig);
router.post('/login', authLimiter, authController.loginOrRegister);
router.post('/verify-otp', authLimiter, authController.verifyEmailOtp);
router.post('/resend-otp', authLimiter, authController.resendEmailOtp);
router.post('/google', authLimiter, authController.googleLogin);
router.post('/verify-age', authController.verifyAge);
router.get('/me', requireAuth, authController.getMe);

module.exports = router;

