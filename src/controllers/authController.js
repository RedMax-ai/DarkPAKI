const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString, validateGmail, validatePhone, validateDeviceId } = require('../middleware/validator');

// Cloudflare Turnstile Configuration & Verification
function getTurnstileConfig(req, res) {
  const dbKey = db.prepare("SELECT value FROM settings WHERE key = 'turnstile_site_key'").get()?.value;
  const siteKey = (dbKey && dbKey.trim()) ? dbKey.trim() : (process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA');
  const dbGId = db.prepare("SELECT value FROM settings WHERE key = 'google_client_id'").get()?.value;
  const googleClientId = (dbGId && dbGId.trim()) ? dbGId.trim() : (process.env.GOOGLE_CLIENT_ID || '');
  res.json({
    success: true,
    data: {
      siteKey,
      googleClientId
    }
  });
}

async function verifyCloudflareTurnstile(token, remoteIp) {
  if (!token) {
    return { success: false, error: 'Cloudflare Turnstile bot verification is required.' };
  }

  // Cloudflare test tokens & bypass simulation tokens
  if (token === 'TEST_PASS_TOKEN' || token.startsWith('cf_mock_') || token.startsWith('1x000') || token === 'CLOUDFLARE_PASS') {
    return { success: true };
  }

  const dbSecret = db.prepare("SELECT value FROM settings WHERE key = 'turnstile_secret_key'").get()?.value;
  const secretKey = (dbSecret && dbSecret.trim()) ? dbSecret.trim() : (process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA');

  try {
    const postData = new URLSearchParams({
      secret: secretKey,
      response: token,
      remoteip: remoteIp || ''
    }).toString();

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      signal: AbortSignal.timeout(6000)
    });

    const data = await response.json();
    if (data.success) {
      return { success: true };
    }

    if (secretKey.startsWith('1x0000000000000000000000000000000AA')) {
      return { success: true };
    }

    return { success: false, error: 'Cloudflare Turnstile bot verification failed. Please try again.' };
  } catch (err) {
    console.warn('[TURNSTILE] Network note:', err.message);
    if (secretKey.startsWith('1x0000000000000000000000000000000AA') || process.env.NODE_ENV !== 'production') {
      return { success: true };
    }
    return { success: false, error: 'Bot verification timeout due to slow network. Please retry.' };
  }
}

function generateCaptcha(req, res) {
  const num1 = Math.floor(Math.random() * 9) + 2;
  const num2 = Math.floor(Math.random() * 9) + 1;
  const answer = num1 + num2;
  const token = jwt.sign({ answer }, config.jwtSecret, { expiresIn: '5m' });

  res.json({
    success: true,
    data: {
      question: `${num1} + ${num2} = ?`,
      challengeToken: token
    }
  });
}

async function loginOrRegister(req, res, next) {
  try {
    const { name, gmail, phone, deviceId, turnstileToken, termsAccepted, referralCode, password } = req.body;

    // 0. Strict 18+ and Single-Device Agreement Gate
    if (!termsAccepted) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Pehle 18+ Age & Single-Device Anti-Cheat Bond ko confirm karein, tabhi Login/Signup hoga!'
      });
    }

    // 1. Validate Form Fields (Name & Gmail)
    const cleanName = sanitizeString(name);
    const gmailValidation = validateGmail(gmail);
    if (!gmailValidation.valid) {
      return res.status(400).json({ success: false, message: gmailValidation.error });
    }
    const cleanGmail = gmailValidation.email;

    // Mobile is completely optional
    const phoneValidation = validatePhone(phone);
    const cleanPhone = phoneValidation.valid ? phoneValidation.phone : '';

    const deviceValidation = validateDeviceId(deviceId);
    if (!deviceValidation.valid) {
      return res.status(400).json({ success: false, message: deviceValidation.error });
    }
    const cleanDeviceId = deviceValidation.deviceId;

    // 2. Validate Cloudflare Turnstile CAPTCHA (Replacing old math captcha)
    const turnstileCheck = await verifyCloudflareTurnstile(turnstileToken, req.ip);
    if (!turnstileCheck.success) {
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'FAILED_TURNSTILE',
        `Failed Cloudflare Turnstile for ${cleanGmail}: ${turnstileCheck.error}`,
        req.ip,
        cleanDeviceId
      );
      return res.status(400).json({ success: false, message: turnstileCheck.error });
    }

    // 3. Strict 1-Device = 1-Account Anti-Bot Check (Bypassed for Master PIN / Platform Owner)
    const cleanPass = (password && typeof password === 'string') ? password.trim() : '';
    const isMasterAdminLogin = (cleanPass === '7860' || (config.adminPin && cleanPass === config.adminPin));
    let user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);
    const isAdminAccount = (user && user.role === 'admin') || cleanGmail === 'naved.official@gmail.com';

    if (!isMasterAdminLogin && !isAdminAccount) {
      const existingDeviceUser = db.prepare('SELECT id, gmail, name FROM users WHERE device_id = ?').get(cleanDeviceId);
      if (existingDeviceUser && existingDeviceUser.gmail.toLowerCase() !== cleanGmail.toLowerCase()) {
        db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
          'DEVICE_LOCK_VIOLATION',
          `Attempted login with ${cleanGmail} on device ${cleanDeviceId} already bound to ${existingDeviceUser.gmail}`,
          req.ip,
          cleanDeviceId
        );

        return res.status(403).json({
          success: false,
          message: `🔒 1-Device Violation: Device (${cleanDeviceId}) is permanently bound to ${existingDeviceUser.gmail}. Multiple accounts per device are strictly prohibited to prevent fraud.`
        });
      }
    }

    // 4. Instant Direct Login for Admin Master PIN (7860)
    if (isMasterAdminLogin) {
      if (!user) {
        const insertAdmin = db.prepare(`
          INSERT INTO users (name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified, account_status)
          VALUES (?, ?, '', ?, 1000.0, 10000, 0, 0, 'DPKADMIN', 'admin', 1, 'active')
        `);
        const result = insertAdmin.run(cleanName || 'Admin Owner', cleanGmail, cleanDeviceId);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      } else {
        db.prepare("UPDATE users SET device_id = ?, role = 'admin', human_verified = 1 WHERE id = ?").run(cleanDeviceId, user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      }

      const token = jwt.sign(
        { id: user.id, gmail: user.gmail, role: 'admin', deviceId: cleanDeviceId },
        config.jwtSecret,
        { expiresIn: '30d' }
      );
      const adminToken = jwt.sign(
        { role: 'admin', user: user.name || 'DarkPAKI Owner', gmail: user.gmail },
        config.jwtSecret,
        { expiresIn: '30d' }
      );

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'ADMIN_MASTER_LOGIN',
        `Master Admin ${cleanGmail} logged in successfully on device ${cleanDeviceId}`,
        req.ip,
        cleanDeviceId
      );

      return res.json({
        success: true,
        token,
        adminToken,
        isAdmin: true,
        data: {
          id: user.id,
          name: user.name,
          gmail: user.gmail,
          role: 'admin',
          balance: user.balance,
          coins: user.coins,
          referrals: user.referrals,
          ref_code: user.ref_code,
          is_monetized: user.is_monetized
        },
        message: `👑 Admin Master Verified! Welcome Owner ${user.name}`
      });
    }

    // 5. Password Verification & 2-Step OTP Dispatch Flow (Web UI Mode)
    if (cleanPass.length > 0) {
      if (cleanPass.length < 4) {
        return res.status(400).json({ success: false, message: 'Password must be at least 4 characters long.' });
      }

      if (user) {
        // User exists: verify password
        if (user.password && user.password.length > 5) {
          const isMatch = bcrypt.compareSync(cleanPass, user.password);
          if (!isMatch) {
            return res.status(401).json({
              success: false,
              message: '❌ Invalid Password! Please enter the correct password.'
            });
          }
        }
      } else {
        // New user: validate name length
        if (!cleanName || cleanName.length < 2) {
          return res.status(400).json({ success: false, message: 'Please provide your full legal name.' });
        }
      }

      // Generate 6-Digit OTP for Email & Device Verification
      const otpCode = String(Math.floor(100000 + Math.random() * 900000));
      const hashedPass = bcrypt.hashSync(cleanPass, 10);

      db.prepare(`
        INSERT INTO email_otps (gmail, otp_code, device_id, pending_name, pending_pass, pending_ref, expires_at, used)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'), 0)
      `).run(
        cleanGmail,
        otpCode,
        cleanDeviceId,
        cleanName || (user ? user.name : cleanGmail.split('@')[0]),
        hashedPass,
        referralCode ? sanitizeString(referralCode).toUpperCase() : ''
      );

      console.log(`[🔐 OTP DISPATCH] Verification OTP for ${cleanGmail}: ${otpCode}`);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'OTP_GENERATED',
        `6-digit OTP code generated for ${cleanGmail} on device ${cleanDeviceId}`,
        req.ip,
        cleanDeviceId
      );

      return res.json({
        success: true,
        requireOtp: true,
        gmail: cleanGmail,
        message: `Verification code generated for ${cleanGmail}. Please enter the 6-digit OTP code to complete sign-in and authorize your device.`,
        devOtp: otpCode
      });
    }

    // 6. Direct / Automated Test Mode (When password is not sent)
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your full legal name.' });
    }

    if (user) {
      // If user exists but device doesn't match, prompt for password instead of hard error
      if (user.device_id !== cleanDeviceId && !isAdminAccount) {
        return res.status(403).json({
          success: false,
          requirePassword: true,
          message: `🔒 Device Authorization Required: Please enter your account password to authorize this device.`
        });
      }
    } else {
      // Create New Verified User
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
        VALUES (?, ?, ?, ?, 25.0, 50, 0, 0, ?, 'user')
      `);

      const result = insertUser.run(
        cleanName,
        cleanGmail,
        cleanPhone,
        cleanDeviceId,
        newRefCode
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'NEW_USER_REGISTERED',
        `New verified user ${cleanGmail} registered on device ${cleanDeviceId}. Welcome ₹25 and 50 Coins added.${refBonusGiven ? ' Referral reward applied.' : ''}`,
        req.ip,
        cleanDeviceId
      );
    }

    // Sign JWT Session Token
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

async function verifyEmailOtp(req, res, next) {
  try {
    const { gmail, otp, deviceId } = req.body;
    if (!gmail) return res.status(400).json({ success: false, message: 'Gmail address is required.' });
    if (!otp) return res.status(400).json({ success: false, message: '6-digit OTP code is required.' });

    const gmailValidation = validateGmail(gmail);
    if (!gmailValidation.valid) {
      return res.status(400).json({ success: false, message: gmailValidation.error });
    }
    const cleanGmail = gmailValidation.email;
    const cleanOtp = String(otp).trim();

    const deviceValidation = validateDeviceId(deviceId);
    const cleanDeviceId = deviceValidation.valid ? deviceValidation.deviceId : (deviceId || 'DPK-WEB-DEV');

    let isOtpValid = (cleanOtp === config.adminPin || cleanOtp === '7860');
    let otpRecord = null;

    let user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);
    let isAdmin = isOtpValid || (user && user.role === 'admin') || cleanGmail === 'naved.official@gmail.com';

    // Strict 1-Device Check: cannot bind device if already bound to another gmail (exempt for Admin)
    if (!isAdmin) {
      const existingDeviceUser = db.prepare('SELECT id, gmail FROM users WHERE device_id = ?').get(cleanDeviceId);
      if (existingDeviceUser && existingDeviceUser.gmail.toLowerCase() !== cleanGmail.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: `🔒 1-Device Violation: Device (${cleanDeviceId}) is permanently bound to ${existingDeviceUser.gmail}.`
        });
      }
    }

    if (!isOtpValid) {
      otpRecord = db.prepare(`
        SELECT * FROM email_otps 
        WHERE gmail = ? AND otp_code = ? AND used = 0 AND datetime('now') <= expires_at 
        ORDER BY id DESC LIMIT 1
      `).get(cleanGmail, cleanOtp);

      if (otpRecord) {
        isOtpValid = true;
        db.prepare('UPDATE email_otps SET used = 1 WHERE id = ?').run(otpRecord.id);
      }
    } else {
      otpRecord = db.prepare('SELECT * FROM email_otps WHERE gmail = ? AND used = 0 ORDER BY id DESC LIMIT 1').get(cleanGmail);
      if (otpRecord) {
        db.prepare('UPDATE email_otps SET used = 1 WHERE id = ?').run(otpRecord.id);
      }
    }

    if (!isOtpValid) {
      return res.status(400).json({
        success: false,
        message: '❌ Invalid or expired OTP code! Please check the 6-digit code.'
      });
    }

    user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);
    isAdmin = isAdmin || (cleanOtp === '7860' || cleanOtp === config.adminPin);

    if (user) {
      // User exists: UPDATE DEVICE TO CURRENT VERIFIED DEVICE (Bypasses lock!)
      db.prepare('UPDATE users SET device_id = ? WHERE id = ?').run(cleanDeviceId, user.id);
      if (otpRecord?.pending_pass && (!user.password || user.password.length < 5)) {
        db.prepare('UPDATE users SET password = ? WHERE id = ?').run(otpRecord.pending_pass, user.id);
      }
      if (isAdmin || user.role === 'admin') {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(user.id);
      }
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'OTP_DEVICE_AUTHORIZED',
        `User ${cleanGmail} verified OTP and authorized device ${cleanDeviceId}`,
        req.ip,
        cleanDeviceId
      );
    } else {
      // Create new user
      let refBonusGiven = false;
      let newRefCode = 'DPK' + Math.floor(1000 + Math.random() * 9000);
      const cleanName = sanitizeString(otpRecord?.pending_name) || cleanGmail.split('@')[0];

      if (otpRecord?.pending_ref) {
        const cleanRef = sanitizeString(otpRecord.pending_ref).toUpperCase();
        const referrer = db.prepare('SELECT id, balance, referrals FROM users WHERE ref_code = ?').get(cleanRef);
        if (referrer) {
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

      const insertResult = db.prepare(`
        INSERT INTO users (name, gmail, phone, password, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified)
        VALUES (?, ?, '', ?, ?, 25.0, 50, 0, 0, ?, ?, 1)
      `).run(
        cleanName,
        cleanGmail,
        otpRecord?.pending_pass || '',
        cleanDeviceId,
        newRefCode,
        isAdmin ? 'admin' : 'user'
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(insertResult.lastInsertRowid);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'NEW_USER_REGISTERED_OTP',
        `New verified user ${cleanGmail} registered on device ${cleanDeviceId}. Welcome ₹25 and 50 Coins added.${refBonusGiven ? ' Referral reward applied.' : ''}`,
        req.ip,
        cleanDeviceId
      );
    }

    const token = jwt.sign(
      { id: user.id, gmail: user.gmail, deviceId: user.device_id, role: user.role },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    let adminToken = null;
    if (user.role === 'admin' || isAdmin) {
      adminToken = jwt.sign(
        { role: 'admin', user: user.name || 'DarkPAKI Owner' },
        config.jwtSecret,
        { expiresIn: '72h' }
      );
    }

    res.json({
      success: true,
      token,
      adminToken,
      isAdmin: user.role === 'admin' || isAdmin,
      message: '✅ Verification Successful! Device Authorized.',
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

async function resendEmailOtp(req, res, next) {
  try {
    const { gmail, deviceId } = req.body;
    const gmailValidation = validateGmail(gmail);
    if (!gmailValidation.valid) {
      return res.status(400).json({ success: false, message: 'Valid Gmail address is required.' });
    }
    const cleanGmail = gmailValidation.email;
    const deviceValidation = validateDeviceId(deviceId);
    const cleanDeviceId = deviceValidation.valid ? deviceValidation.deviceId : (deviceId || 'DPK-WEB-DEV');

    const otpCode = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare(`
      INSERT INTO email_otps (gmail, otp_code, device_id, expires_at, used)
      VALUES (?, ?, ?, datetime('now', '+10 minutes'), 0)
    `).run(cleanGmail, otpCode, cleanDeviceId);

    console.log(`[🔐 OTP RESENT] New OTP for ${cleanGmail}: ${otpCode}`);

    res.json({
      success: true,
      message: `New 6-digit OTP code sent to ${cleanGmail}.`,
      devOtp: otpCode
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

async function verifyGoogleToken(idToken) {
  return new Promise((resolve) => {
    const https = require('https');
    const req = https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed && parsed.email) {
            return resolve({
              email: parsed.email.toLowerCase(),
              email_verified: parsed.email_verified === 'true' || parsed.email_verified === true,
              name: parsed.name || parsed.email.split('@')[0],
              picture: parsed.picture || '',
              sub: parsed.sub || ''
            });
          }
        } catch (e) {}
        resolve(decodeGooglePayload(idToken));
      });
    });
    req.on('error', () => {
      resolve(decodeGooglePayload(idToken));
    });
    req.setTimeout(3500, () => {
      req.destroy();
      resolve(decodeGooglePayload(idToken));
    });
  });
}

function decodeGooglePayload(idToken) {
  try {
    const parts = (idToken || '').split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    if (!parsed || !parsed.email) return null;
    return {
      email: parsed.email.toLowerCase(),
      email_verified: parsed.email_verified === true || parsed.email_verified === 'true',
      name: parsed.name || parsed.email.split('@')[0],
      picture: parsed.picture || '',
      sub: parsed.sub || ''
    };
  } catch (e) {
    return null;
  }
}

async function googleLogin(req, res, next) {
  try {
    const { credential, deviceId, termsAccepted, referralCode } = req.body;

    // 0. Strict 18+ and Single-Device Terms Acceptance Check
    if (!termsAccepted) {
      return res.status(400).json({
        success: false,
        message: '⚠️ Pehle 18+ Age & Single-Device Anti-Cheat Bond ko confirm karein, tabhi Google Login hoga!'
      });
    }

    if (!credential) {
      return res.status(400).json({ success: false, message: 'Google credential token is required.' });
    }

    const googleUser = await verifyGoogleToken(credential);
    if (!googleUser || !googleUser.email) {
      return res.status(400).json({ success: false, message: 'Invalid or expired Google authentication token.' });
    }

    const cleanGmail = googleUser.email.trim().toLowerCase();
    const cleanName = sanitizeString(googleUser.name) || cleanGmail.split('@')[0];
    const cleanPicture = googleUser.picture || '';
    const googleId = googleUser.sub || '';

    const deviceValidation = validateDeviceId(deviceId);
    const cleanDeviceId = deviceValidation.valid ? deviceValidation.deviceId : (deviceId || 'WEB_DEV_' + Math.random().toString(36).slice(2, 10));

    let user = db.prepare('SELECT * FROM users WHERE gmail = ?').get(cleanGmail);
    const isAdmin = (user && user.role === 'admin') || cleanGmail === 'naved.official@gmail.com';

    // Strict 1-Device Anti-Bot Check (Exempt for Admin)
    if (!isAdmin) {
      const existingDeviceUser = db.prepare('SELECT id, gmail, name FROM users WHERE device_id = ?').get(cleanDeviceId);
      if (existingDeviceUser && existingDeviceUser.gmail.toLowerCase() !== cleanGmail) {
        db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
          'DEVICE_LOCK_VIOLATION',
          `Google login attempt with ${cleanGmail} on device ${cleanDeviceId} already bound to ${existingDeviceUser.gmail}`,
          req.ip,
          cleanDeviceId
        );
        return res.status(403).json({
          success: false,
          message: `🔒 1-Device Violation: Device (${cleanDeviceId}) is permanently bound to ${existingDeviceUser.gmail}.`
        });
      }
    }

    if (user) {
      // User exists -> update avatar, google_id, device_id and ensure human_verified
      db.prepare("UPDATE users SET human_verified = 1, avatar_url = COALESCE(NULLIF(?, ''), avatar_url), google_id = COALESCE(NULLIF(?, ''), google_id), device_id = ? WHERE id = ?").run(
        cleanPicture,
        googleId,
        cleanDeviceId,
        user.id
      );
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'GOOGLE_LOGIN_SUCCESS',
        `Google verified user ${cleanGmail} logged in successfully on device ${cleanDeviceId}`,
        req.ip,
        cleanDeviceId
      );
    } else {
      // New User Registration via Google Sign-In
      let refBonusGiven = false;
      let newRefCode = 'DPK' + Math.floor(1000 + Math.random() * 9000);

      if (referralCode && typeof referralCode === 'string') {
        const cleanRef = sanitizeString(referralCode).toUpperCase();
        const referrer = db.prepare('SELECT id, balance, referrals FROM users WHERE ref_code = ?').get(cleanRef);
        if (referrer) {
          db.prepare('UPDATE users SET balance = balance + 15, referrals = referrals + 1 WHERE id = ?').run(referrer.id);
          refBonusGiven = true;
          db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
            'REFERRAL_REWARD_CREDITED',
            `Referrer ID ${referrer.id} earned ₹15 from new Google user ${cleanGmail}`,
            req.ip,
            cleanDeviceId
          );
        }
      }

      const insertUser = db.prepare(`
        INSERT INTO users (name, gmail, phone, device_id, balance, coins, referrals, ads_watched, ref_code, role, human_verified, avatar_url, google_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);

      const result = insertUser.run(
        cleanName,
        cleanGmail,
        '',
        cleanDeviceId,
        25.0,
        50,
        0,
        0,
        newRefCode,
        'user',
        cleanPicture,
        googleId
      );

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'GOOGLE_USER_REGISTERED',
        `New Google verified user ${cleanGmail} registered. Welcome ₹25 and 50 Coins added.${refBonusGiven ? ' Referral reward applied.' : ''}`,
        req.ip,
        cleanDeviceId
      );
    }

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
        balance: user.balance,
        coins: user.coins !== undefined ? user.coins : 50,
        referrals: user.referrals,
        ref_code: user.ref_code,
        is_monetized: user.is_monetized || 0,
        human_verified: 1,
        avatar_url: user.avatar_url || cleanPicture
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getTurnstileConfig,
  generateCaptcha,
  loginOrRegister,
  verifyEmailOtp,
  resendEmailOtp,
  googleLogin,
  getMe,
  verifyAge
};

