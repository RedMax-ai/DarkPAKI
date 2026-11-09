const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString, validateGmail, validatePhone, validateDeviceId } = require('../middleware/validator');

function generateCaptcha(req, res) {
  const num1 = Math.floor(Math.random() * 9) + 2;
  const num2 = Math.floor(Math.random() * 9) + 1;
  const answer = num1 + num2;
  // Sign captcha answer into a short-lived token (5 mins) so client can't tamper
  const token = jwt.sign({ answer }, config.jwtSecret, { expiresIn: '5m' });

  res.json({
    success: true,
    data: {
      question: `${num1} + ${num2} = ?`,
      challengeToken: token
    }
  });
}

function loginOrRegister(req, res, next) {
  try {
    const { name, gmail, phone, deviceId, captchaToken, captchaAnswer, referralCode } = req.body;

    // 1. Validate Form Fields
    const cleanName = sanitizeString(name);
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your full legal name.' });
    }

    const gmailValidation = validateGmail(gmail);
    if (!gmailValidation.valid) {
      return res.status(400).json({ success: false, message: gmailValidation.error });
    }
    const cleanGmail = gmailValidation.email;

    const phoneValidation = validatePhone(phone);
    if (!phoneValidation.valid) {
      return res.status(400).json({ success: false, message: phoneValidation.error });
    }
    const cleanPhone = phoneValidation.phone;

    const deviceValidation = validateDeviceId(deviceId);
    if (!deviceValidation.valid) {
      return res.status(400).json({ success: false, message: deviceValidation.error });
    }
    const cleanDeviceId = deviceValidation.deviceId;

    // 2. Validate Human Math Verification
    if (!captchaToken || captchaAnswer === undefined) {
      return res.status(400).json({ success: false, message: 'Human verification required.' });
    }

    try {
      const decodedCaptcha = jwt.verify(captchaToken, config.jwtSecret);
      if (parseInt(captchaAnswer, 10) !== decodedCaptcha.answer) {
        // Log failed captcha
        db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
          'FAILED_CAPTCHA',
          `Failed math challenge for ${cleanGmail}`,
          req.ip,
          cleanDeviceId
        );
        return res.status(400).json({ success: false, message: 'Human verification failed! Incorrect answer.' });
      }
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Human verification challenge expired. Please refresh and try again.' });
    }

    // 3. Strict 1-Device = 1-Account Anti-Bot Check
    const existingDeviceUser = db.prepare('SELECT id, gmail, name FROM users WHERE device_id = ?').get(cleanDeviceId);
    if (existingDeviceUser && existingDeviceUser.gmail.toLowerCase() !== cleanGmail.toLowerCase()) {
      // Log blocked multi-accounting attempt
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'DEVICE_LOCK_VIOLATION',
        `Attempted login with ${cleanGmail} on device ${cleanDeviceId} already bound to ${existingDeviceUser.gmail}`,
        req.ip,
        cleanDeviceId
      );

      return res.status(403).json({
        success: false,
        message: `🔒 1-Device-1-Login Violation: This device (${cleanDeviceId}) is permanently bound to ${existingDeviceUser.gmail}. Multiple accounts per device are strictly prohibited to prevent fraud.`
      });
    }

    // 4. Check if User Already Exists by Gmail
    let user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);

    if (user) {
      // Verify device match
      if (user.device_id !== cleanDeviceId) {
        db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
          'DEVICE_MISMATCH',
          `User ${cleanGmail} attempted login from new device ${cleanDeviceId} (registered: ${user.device_id})`,
          req.ip,
          cleanDeviceId
        );
        return res.status(403).json({
          success: false,
          message: `🔒 Account ${cleanGmail} is locked to its original registered device (${user.device_id}). Unauthorized secondary device detected.`
        });
      }
    } else {
      // 5. Create New Verified User
      let refBonusGiven = false;
      let newRefCode = 'DPK' + Math.floor(1000 + Math.random() * 9000);

      // Verify referral code if provided
      if (referralCode && typeof referralCode === 'string') {
        const cleanRef = sanitizeString(referralCode).toUpperCase();
        const referrer = db.prepare('SELECT id, balance, referrals FROM users WHERE ref_code = ?').get(cleanRef);
        if (referrer) {
          // Credit referrer +₹15
          db.prepare('UPDATE users SET balance = balance + 15, referrals = referrals + 1 WHERE id = ?').run(referrer.id);
          refBonusGiven = true;
          db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
            'REFERRAL_REWARD_CREDITED',
            `Referrer ID ${referrer.id} earned ₹15 from new user ${cleanGmail}`,
            req.ip,
            cleanDeviceId
          );
        }
      }

      // Welcome bonus: ₹25.0 and 50 Welcome Coins
      const insertUser = db.prepare(`
        INSERT INTO users (name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insertUser.run(
        cleanName,
        cleanGmail,
        cleanPhone,
        cleanDeviceId,
        25.0,
        50,
        0,
        0,
        newRefCode,
        'user'
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'NEW_USER_REGISTERED',
        `New verified user ${cleanGmail} registered on device ${cleanDeviceId}. Welcome ₹25 and 50 Coins added.${refBonusGiven ? ' Referral reward applied.' : ''}`,
        req.ip,
        cleanDeviceId
      );
    }

    // 6. Sign JWT Session Token
    const token = jwt.sign(
      { id: user.id, gmail: user.gmail, deviceId: user.device_id, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      data: {
        id: user.id,
        name: user.name,
        gmail: user.gmail,
        phone: user.phone,
        deviceId: user.device_id,
        balance: user.balance,
        coins: user.coins !== undefined ? user.coins : 50,
        referrals: user.referrals,
        adsWatched: user.ads_watched,
        refCode: user.ref_code,
        role: user.role
      }
    });
  } catch (err) {
    next(err);
  }
}

function getMe(req, res, next) {
  try {
    const user = db.prepare('SELECT id, name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    res.json({
      success: true,
      data: {
        ...user,
        coins: user.coins !== undefined ? user.coins : 50
      }
    });
  } catch (err) {
    next(err);
  }
}

function verifyAge(req, res, next) {
  try {
    const { deviceId, confirmed } = req.body;
    if (!confirmed) {
      return res.status(400).json({ success: false, message: 'Age confirmation is required.' });
    }

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'AGE_VERIFIED',
      'User confirmed 18+ legal age compliance',
      req.ip,
      deviceId || 'UNKNOWN'
    );

    res.json({
      success: true,
      message: 'Age verification confirmed and logged.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateCaptcha,
  loginOrRegister,
  getMe,
  verifyAge
};

