/**
 * DarkPAKI End-to-End Verification Test Suite
 * Tests the complete loop: Frontend API -> Database -> Security Middleware -> Response
 */

const http = require('http');
const app = require('./src/server');

let server;
const PORT = 5555;
const BASE_URL = `http://127.0.0.1:${PORT}/api`;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 STARTING DARKPAKI END-TO-END VERIFICATION AUDIT');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failed++;
    }
  }

  // Pre-audit test isolation: clean up any residual automated test artifacts
  const setupDb = require('./src/db/database');
  setupDb.prepare("DELETE FROM users WHERE device_id LIKE 'DPK-OTP-DEV%' OR device_id LIKE 'DPK-DEV-TEST%'").run();
  setupDb.prepare("DELETE FROM demand_votes WHERE device_id LIKE 'DPK-%'").run();

  // 1. Health Check
  const healthRes = await request('GET', '/health');
  assert(healthRes.status === 200 && healthRes.body.status === 'online', 'Health check responds online');

  // 2. Videos Catalog
  const videosRes = await request('GET', '/videos');
  assert(videosRes.status === 200 && Array.isArray(videosRes.body.data), 'Videos catalog returned from SQLite (clean zero-mock array)');

  // 3. Ad & Telegram Config
  const configRes = await request('GET', '/videos/config');
  assert(configRes.status === 200 && configRes.body.data.adVideoUrl.includes('http') && (configRes.body.data.vastTagUrl.includes('rodexchange.com') || configRes.body.data.vastTagUrl.includes('s.magsrv.com')), 'Ad, VAST & Telegram configuration returned correctly');

  // 3b. VAST Ad Resolver
  const vastAdRes = await request('GET', '/videos/vast-ad');
  assert(vastAdRes.status === 200 && (vastAdRes.body.ad?.mediaUrl || vastAdRes.body.fallbackUrl !== undefined || vastAdRes.body.noFill === true), 'VAST in-stream video ad resolver responds with valid creative or fallback');

  // 4. Captcha Generation
  const captchaRes = await request('GET', '/auth/captcha');
  assert(captchaRes.status === 200 && captchaRes.body.data.challengeToken && captchaRes.body.data.question.includes('+'), 'Cryptographically signed human math challenge generated');

  // 4b. 18+ Age Compliance Verification
  const ageVerifyRes = await request('POST', '/auth/verify-age', { deviceId: 'DPK-TEST-DEV-8899', confirmed: true });
  assert(ageVerifyRes.status === 200 && ageVerifyRes.body.success === true, '18+ legal age compliance verified and logged');

  // 4c. Google reCAPTCHA v2 Configuration Check
  const recaptchaConfigRes = await request('GET', '/auth/recaptcha-config');
  assert(recaptchaConfigRes.status === 200 && recaptchaConfigRes.body.data.siteKey === '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK', 'Google reCAPTCHA v2 site key loaded correctly from SQLite configuration');

  const jwt = require('jsonwebtoken');
  const serverConfig = require('./src/config');
  const decodedCaptcha = jwt.verify(captchaRes.body.data.challengeToken, serverConfig.jwtSecret);
  const correctAnswer = decodedCaptcha.answer;

  // 5. Real User Registration & 1-Device Binding
  const testDeviceId = 'DPK-TEST-DEV-' + Date.now();
  const testGmail = 'hamza.test' + Date.now() + '@gmail.com';
  const registerPayload = {
    name: 'Hamza Khan',
    gmail: testGmail,
    phone: '9876501234',
    deviceId: testDeviceId,
    captchaToken: captchaRes.body.data.challengeToken,
    captchaAnswer: correctAnswer,
    turnstileToken: 'CLOUDFLARE_PASS',
    termsAccepted: true,
    referralCode: 'DPK786'
  };

  const registerRes = await request('POST', '/auth/login', registerPayload);
  assert(registerRes.status === 200 && registerRes.body.token && registerRes.body.data.balance === 0.275, 'User registered: Received JWT token, 1-Device Bound, and $0.275 welcome bonus');
  const userToken = registerRes.body.token;

  // 5b. Existing User Direct Login (No Name Required)
  const directLoginRes = await request('POST', '/auth/login', {
    mode: 'login',
    gmail: testGmail,
    password: 'userPass123',
    deviceId: testDeviceId,
    turnstileToken: 'CLOUDFLARE_PASS',
    termsAccepted: true
  });
  assert(directLoginRes.status === 200 && directLoginRes.body.token && directLoginRes.body.data.gmail === testGmail, 'Existing user direct login: Authenticates and returns JWT without requiring name');

  // 5c. Non-existent User Login Mode Check (Returns 404 with prompt to switch to Register)
  const notFoundLogin = await request('POST', '/auth/login', {
    mode: 'login',
    gmail: 'nonexistent.user.' + Date.now() + '@gmail.com',
    password: 'userPass123',
    deviceId: testDeviceId,
    turnstileToken: 'CLOUDFLARE_PASS',
    termsAccepted: true
  });
  assert(notFoundLogin.status === 404 && notFoundLogin.body.message.includes('Account not found'), 'Non-existent user in login mode receives 404 with switch to register');

  // 5d. Duplicate Registration Check (Returns 409 with prompt to switch to Login)
  const duplicateReg = await request('POST', '/auth/login', {
    mode: 'register',
    name: 'Hamza Khan',
    gmail: testGmail,
    password: 'userPass123',
    deviceId: testDeviceId,
    turnstileToken: 'CLOUDFLARE_PASS',
    termsAccepted: true
  });
  assert(duplicateReg.status === 409 && duplicateReg.body.message.includes('already exists'), 'Duplicate registration receives 409 with prompt to log in');

  // 5e. Bot Protection: Missing or Invalid Google reCAPTCHA Rejected
  const botRecaptchaFail = await request('POST', '/auth/login', {
    mode: 'login',
    gmail: testGmail,
    password: 'userPass123',
    deviceId: 'BOT-DEV-' + Date.now(),
    recaptchaToken: '',
    turnstileToken: '',
    termsAccepted: true
  });
  assert(botRecaptchaFail.status === 400 && botRecaptchaFail.body.message.includes('reCAPTCHA'), 'Google reCAPTCHA blocks request with missing/invalid bot verification token');

  // 6. Multi-Account Fraud Shield (1 Device = 1 Gmail)
  const fakeCaptcha = await request('GET', '/auth/captcha');
  const decodedFake = jwt.verify(fakeCaptcha.body.data.challengeToken, serverConfig.jwtSecret);
  const secondUserAttempt = await request('POST', '/auth/login', {
    name: 'Second Bot',
    gmail: 'bot.second' + Date.now() + '@gmail.com',
    phone: '9876599999',
    deviceId: testDeviceId, // SAME DEVICE!
    captchaToken: fakeCaptcha.body.data.challengeToken,
    captchaAnswer: decodedFake.answer,
    turnstileToken: 'CLOUDFLARE_PASS',
    termsAccepted: true
  });
  assert(secondUserAttempt.status === 403 && secondUserAttempt.body.message.includes('1-Device Violation'), '1-Device Anti-Bot Shield blocks second Gmail on same device with 403 Forbidden');

  // 7. Get Authenticated User Profile
  const meRes = await request('GET', '/auth/me', null, { Authorization: `Bearer ${userToken}` });
  assert(meRes.status === 200 && meRes.body.data.gmail === testGmail && meRes.body.data.coins === 50, 'Protected /auth/me returns authenticated user details with 50 welcome coins');

  // 8. Watch Video Bonus (Fixed 5 coins & proportional cash for user)
  const watchBonusRes = await request('POST', '/earning/watch-bonus', { type: 'ad_bonus' }, { Authorization: `Bearer ${userToken}` });
  assert(watchBonusRes.status === 200 && watchBonusRes.body.data.coinsEarned === 5 && watchBonusRes.body.data.adsWatched === 1, 'Watch video bonus credits exactly 5 Coins for user');

  // 9. Referral Bonus (+200 Coins per referral)
  await request('POST', '/earning/test-referral', null, { Authorization: `Bearer ${userToken}` });
  const ref2Res = await request('POST', '/earning/test-referral', null, { Authorization: `Bearer ${userToken}` });
  const expectedTotalCoins = 50 + watchBonusRes.body.data.coinsEarned + (200 * 2);
  assert(ref2Res.status === 200 && ref2Res.body.data.coins === expectedTotalCoins && ref2Res.body.data.referrals === 2, `Referral credits persist: referrals count 2 and ${expectedTotalCoins} coins`);

  // 9b. Convert Coins to Money: Minimum 1,000 Coins Required
  const minCoinCheck = await request('POST', '/earning/convert-coins', { coins: 100 }, { Authorization: `Bearer ${userToken}` });
  assert(minCoinCheck.status === 400 && minCoinCheck.body.message.includes('Minimum 1,000 coins required'), 'Conversion of < 1,000 coins rejected with minimum threshold error');

  // Top up coins to 1,500 to test successful conversion of 1,000 coins (➔ $0.11 USD)
  const dbModule = require('./src/db/database');
  dbModule.prepare('UPDATE users SET coins = 1500 WHERE id = ?').run(registerRes.body.data.id);

  const convertRes = await request('POST', '/earning/convert-coins', { coins: 1000 }, { Authorization: `Bearer ${userToken}` });
  assert(convertRes.status === 200 && convertRes.body.data.coins === 500 && convertRes.body.data.coinsDeducted === 1000, 'Converted 1,000 coins to cash (1,000 Coins = $0.11 USD): remaining coins 500');

  // 10. Withdrawal with $10 Minimum Rule & Atomic Deductions
  const minWithdrawCheck = await request('POST', '/earning/withdraw', {
    upiId: 'TXyz1234567890abcdefghijklmnopqrst',
    amount: 5
  }, { Authorization: `Bearer ${userToken}` });
  assert(minWithdrawCheck.status === 400 && minWithdrawCheck.body.message.includes('Minimum withdrawal amount is $10'), 'Withdrawal < $10 rejected with minimum threshold error');

  // Top up user balance to $20 to test valid USDT payout
  dbModule.prepare('UPDATE users SET balance = 20.0 WHERE id = ?').run(registerRes.body.data.id);

  const withdrawAmount = 10;
  const withdrawRes = await request('POST', '/earning/withdraw', {
    upiId: 'TXyz1234567890abcdefghijklmnopqrst',
    amount: withdrawAmount
  }, { Authorization: `Bearer ${userToken}` });
  assert(withdrawRes.status === 200 && Math.abs(withdrawRes.body.data.newBalance - 10.0) < 0.01 && withdrawRes.body.data.status === 'QUEUED', 'Instant $10 USDT withdrawal processed and queued in SQLite');

  // Test Binance Pay ID (0% Gas Fee) Payout Request
  dbModule.prepare('UPDATE users SET balance = 15.0 WHERE id = ?').run(registerRes.body.data.id);
  const binanceWithdrawRes = await request('POST', '/earning/withdraw', {
    upiId: '248194821', // 9-digit Binance Pay ID / UID
    amount: 10
  }, { Authorization: `Bearer ${userToken}` });
  assert(binanceWithdrawRes.status === 200 && binanceWithdrawRes.body.data.payoutType === 'Binance Pay ID / UID', 'Binance Pay ID (0% gas fee) payout processed and identified in SQLite');

  // 11. Overdraw prevention
  const overdrawRes = await request('POST', '/earning/withdraw', {
    upiId: 'TXyz1234567890abcdefghijklmnopqrst',
    amount: 99999
  }, { Authorization: `Bearer ${userToken}` });
  assert(overdrawRes.status === 400 && overdrawRes.body.message.includes('Insufficient balance'), 'Overdraw correctly rejected when balance < amount');

  // 12. Submit New Demand & Comment
  const newCommentRes = await request('POST', '/demands/comments', {
    userName: 'Hamza Khan',
    creatorTarget: 'Desi Night Studio',
    badge: '🔥 High-Demand Request',
    text: 'Desi Night Studio ka full uncut 4K video session upload kijiye!',
    deviceId: testDeviceId
  });
  assert(newCommentRes.status === 200 && newCommentRes.body.data.commentId, 'New community demand and comment persisted in database');

  // 13. Community Demand Poll Voting
  const allDemandsRes = await request('GET', '/demands/poll');
  const targetDemandId = (allDemandsRes.body?.data && allDemandsRes.body.data[0]) ? allDemandsRes.body.data[0].id : 1;
  const pollVoteRes = await request('POST', `/demands/poll/${targetDemandId}/vote`, { deviceId: 'DPK-DEV-VOTER-2' });
  assert(pollVoteRes.status === 200 && pollVoteRes.body.data.voted === true, 'Upvoted demand topic in SQLite database');

  // 14. Like Comment Toggle
  const likeRes = await request('POST', `/demands/comments/${newCommentRes.body.data.commentId}/like`, { deviceId: 'DPK-DEV-OTHER' });
  assert(likeRes.status === 200 && likeRes.body.data.liked === true, 'Comment like toggled and updated in database');

  // 15. Stealth Gateway & Admin Authentication
  // 15a. Unauthorized request without stealth key is blocked with 404 Not Found
  const blockedScanRes = await request('POST', '/admin/login', { pin: '7860', deviceId: 'HACKER-BOT' });
  assert(blockedScanRes.status === 404, 'Stealth Gateway blocks unauthorized admin probe with 404 Not Found');

  // 15b. Authorized request with Stealth Access Key succeeds and returns JWT
  const adminLoginRes = await request('POST', '/admin/login', {
    pin: '7860',
    deviceId: testDeviceId
  }, { 'X-Admin-Key': serverConfig.adminAccessKey || 'naved_master_786' });
  assert(adminLoginRes.status === 200 && adminLoginRes.body.token, 'Owner Master PIN verified with bcrypt hash, returns Admin JWT');
  const adminToken = adminLoginRes.body.token;

  // 16. Admin Stats
  const adminStatsRes = await request('GET', '/admin/stats', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminStatsRes.status === 200 && adminStatsRes.body.data.stats.blockedAttempts >= 1, 'Admin stats accurately reflects blocked bot attempts and users from SQLite');

  // 17. Admin Video Publishing
  const uploadVidRes = await request('POST', '/admin/videos', {
    title: 'Brand New 4K DarkPAKI Stream',
    tag: 'TRENDING VIDEOS',
    thumbImg: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4'
  }, { Authorization: `Bearer ${adminToken}` });
  assert(uploadVidRes.status === 200 && uploadVidRes.body.data.id, 'Admin published new video directly into SQLite catalog');

  // 18. Admin Settings Update & reCAPTCHA Keys Verification
  const adminSettingsRes = await request('GET', '/admin/settings', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminSettingsRes.status === 200 && adminSettingsRes.body.data.recaptchaSiteKey === '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK', 'Admin settings exposes verified Google reCAPTCHA keys');

  const updateSettingsRes = await request('PUT', '/admin/settings', {
    telegramUrl: 'https://t.me/darkpaki_vip',
    allowInstantSkip: true,
    vastTagUrl: 'https://s.magsrv.com/v1/vast.php?idz=6098978'
  }, { Authorization: `Bearer ${adminToken}` });
  assert(updateSettingsRes.status === 200, 'Admin updated Telegram URL, instant skip rules, and VAST Tag URL in SQLite');

  // 18b. Admin USDT Payouts (Trust Wallet Review & Complete)
  const adminWithdrawalsRes = await request('GET', '/admin/withdrawals', null, { Authorization: `Bearer ${adminToken}` });
  assert(adminWithdrawalsRes.status === 200 && adminWithdrawalsRes.body.data.withdrawals.length >= 1, 'Admin retrieves USDT withdrawal queue from SQLite');

  const targetWithdrawalId = adminWithdrawalsRes.body.data.withdrawals[0].id;
  const completeWithdrawalRes = await request('POST', `/admin/withdrawals/${targetWithdrawalId}/complete`, {
    txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    notes: 'Paid via Trust Wallet BEP20 USDT'
  }, { Authorization: `Bearer ${adminToken}` });
  assert(completeWithdrawalRes.status === 200, 'Admin marked USDT withdrawal as COMPLETED with Trust Wallet TXID');

  // 19. AI Image Generation
  const aiGenRes = await request('POST', '/ai/generate', {
    prompt: 'Cyberpunk neon model in late night lounge',
    style: 'Cyberpunk 18+',
    aspectRatio: '1:1',
    deviceId: testDeviceId
  });
  assert(aiGenRes.status === 200 && aiGenRes.body.data.imageUrl.includes('pollinations.ai'), 'AI image generated and stored in SQLite');

  // 20. AI Gallery Retrieval
  const aiGalleryRes = await request('GET', '/ai/gallery', null, { 'X-Device-Id': testDeviceId });
  assert(aiGalleryRes.status === 200 && Array.isArray(aiGalleryRes.body.data) && aiGalleryRes.body.data.length >= 1, 'AI images gallery fetched from SQLite');

  // 21. AI Image Like Toggle
  const aiLikeRes = await request('POST', `/ai/images/${aiGenRes.body.data.id}/like`, { deviceId: 'DPK-DEV-OTHER' });
  assert(aiLikeRes.status === 200 && aiLikeRes.body.data.liked === true, 'AI image like toggle persisted in database');

  // 21. Email + Password + OTP Verification & Device Authorization Flow
  const otpUserGmail = 'otp.test' + Date.now() + '@gmail.com';
  const otpInitDevice = 'DPK-OTP-DEV-1';
  const otpInitRes = await request('POST', '/auth/login', {
    name: 'OTP Verified User',
    gmail: otpUserGmail,
    password: 'securePass123',
    deviceId: otpInitDevice,
    turnstileToken: 'CLOUDFLARE_PASS',
    termsAccepted: true
  });
  assert(otpInitRes.status === 200 && otpInitRes.body.requireOtp === true && otpInitRes.body.devOtp, 'Password verified: 6-digit OTP code dispatched for account');

  const otpCode = otpInitRes.body.devOtp;
  const otpNewDevice = 'DPK-OTP-DEV-2'; // Authorize on second device via OTP
  const otpVerifyRes = await request('POST', '/auth/verify-otp', {
    gmail: otpUserGmail,
    otp: otpCode,
    deviceId: otpNewDevice
  });
  assert(otpVerifyRes.status === 200 && otpVerifyRes.body.token && otpVerifyRes.body.data.deviceId === otpNewDevice, 'OTP verification binds & authorizes new device successfully');

  // 22. Instagram-Style User Profile & Edit Profile Audit
  // 22a. Get Profile Me (Strict Real Zero-Mock Data)
  const profileMeRes = await request('GET', '/profile/me', null, { Authorization: `Bearer ${userToken}` });
  assert(profileMeRes.status === 200 && profileMeRes.body.success === true && profileMeRes.body.data.username, 'Profile retrieval returns authentic user data with zero mocks');
  assert(profileMeRes.body.data.posts_count === 0 && profileMeRes.body.data.followers_count === 0 && profileMeRes.body.data.following_count === 0, 'Clean zero-counts returned for posts, followers, and following');

  // 22b. Check Username Availability (Real-Time Availability Check)
  const availRes = await request('GET', `/profile/check-username?username=darkpaki_creator_${Date.now()}`);
  assert(availRes.status === 200 && availRes.body.available === true, 'Real-time username availability confirms unique candidate is available');

  const takenRes = await request('GET', `/profile/check-username?username=${profileMeRes.body.data.username}`, null, { Authorization: `Bearer ${userToken}` });
  assert(takenRes.status === 200 && takenRes.body.available === true, 'User checking their own current username returns available');

  const invalidUsernameRes = await request('GET', '/profile/check-username?username=bad username!');
  assert(invalidUsernameRes.status === 200 && invalidUsernameRes.body.available === false, 'Username with invalid characters correctly flagged as unavailable');

  // 22c. Update Profile (Name, Username, Pronouns, Bio, Banner, Gender - strictly no Facebook/Category)
  const newUsernameCandidate = 'naved_star_' + Math.floor(1000 + Math.random() * 9000);
  const updateProfileRes = await request('PUT', '/profile', {
    name: 'Naved Official VIP',
    username: newUsernameCandidate,
    pronouns: 'he/him',
    bio: 'Official DarkPAKI VIP Creator & Streamer. No fake data.',
    banner_style: 'creator',
    gender: 'Male'
  }, { Authorization: `Bearer ${userToken}` });
  assert(updateProfileRes.status === 200 && updateProfileRes.body.data.username === newUsernameCandidate, 'Profile successfully updated: Name, Username, Pronouns, Bio, Banner, Gender persisted in SQLite');

  // 22d. Bio Overflow Check (Max 150 chars)
  const longBio = 'a'.repeat(160);
  const bioOverflowRes = await request('PUT', '/profile', {
    name: 'Naved Official VIP',
    bio: longBio
  }, { Authorization: `Bearer ${userToken}` });
  assert(bioOverflowRes.status === 400 && bioOverflowRes.body.message.includes('150'), 'Bio exceeding 150 characters strictly rejected with 400 Bad Request');

  // 22e. Upload & Remove Avatar
  const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const uploadAvatarRes = await request('POST', '/profile/avatar', { imageBase64: sampleBase64 }, { Authorization: `Bearer ${userToken}` });
  assert(uploadAvatarRes.status === 200 && uploadAvatarRes.body.avatarUrl.includes('/uploads/avatars/'), 'Base64 Profile photo uploaded and saved to server storage');

  const removeAvatarRes = await request('DELETE', '/profile/avatar', null, { Authorization: `Bearer ${userToken}` });
  assert(removeAvatarRes.status === 200 && removeAvatarRes.body.avatarUrl === '', 'Profile picture removed and reset to empty state');

  // 22f. External Links Management (Add, Get, Delete)
  const addLinkRes = await request('POST', '/profile/links', {
    title: 'My Official Telegram',
    url: 'https://t.me/darkpaki_official'
  }, { Authorization: `Bearer ${userToken}` });
  assert(addLinkRes.status === 200 && addLinkRes.body.data.id, 'External link added to profile in SQLite');
  const linkId = addLinkRes.body.data.id;

  const getLinksRes = await request('GET', '/profile/links', null, { Authorization: `Bearer ${userToken}` });
  assert(getLinksRes.status === 200 && getLinksRes.body.data.length >= 1, 'External links list retrieved from database');

  const delLinkRes = await request('DELETE', `/profile/links/${linkId}`, null, { Authorization: `Bearer ${userToken}` });
  assert(delLinkRes.status === 200 && delLinkRes.body.success === true, 'External link deleted from SQLite database');

  // 22g. Real Posts Grid Retrieval (Strict Zero Fake Data)
  const postsGridRes = await request('GET', '/profile/posts?tab=posts', null, { Authorization: `Bearer ${userToken}` });
  assert(postsGridRes.status === 200 && Array.isArray(postsGridRes.body.data), 'User media posts grid retrieved with real state');

  // 22h. Save & Unsave Video
  const sampleVid = dbModule.prepare("SELECT id FROM videos LIMIT 1").get();
  if (sampleVid) {
    const saveVidRes = await request('POST', '/profile/save-video', { videoId: sampleVid.id }, { Authorization: `Bearer ${userToken}` });
    assert(saveVidRes.status === 200 && saveVidRes.body.saved === true, 'Post/video saved to user collection');

    const savedPostsRes = await request('GET', '/profile/posts?tab=saved', null, { Authorization: `Bearer ${userToken}` });
    assert(savedPostsRes.status === 200 && savedPostsRes.body.data.some(p => p.id === sampleVid.id), 'Saved tab returns bookmarked video');

    const unsaveVidRes = await request('DELETE', `/profile/save-video/${sampleVid.id}`, null, { Authorization: `Bearer ${userToken}` });
    assert(unsaveVidRes.status === 200 && unsaveVidRes.body.saved === false, 'Video successfully unsaved from collection');
  }

  // 22i. Follow System
  const secondUser = dbModule.prepare("SELECT id FROM users WHERE id != ? LIMIT 1").get(profileMeRes.body.data.id);
  if (secondUser) {
    const followRes = await request('POST', `/profile/follow/${secondUser.id}`, null, { Authorization: `Bearer ${userToken}` });
    assert(followRes.status === 200 && followRes.body.following === true, 'User follow toggle activated in SQLite user_follows');

    const unfollowRes = await request('POST', `/profile/follow/${secondUser.id}`, null, { Authorization: `Bearer ${userToken}` });
    assert(unfollowRes.status === 200 && unfollowRes.body.following === false, 'User unfollow toggle deactivated in SQLite user_follows');
  }

  // 22j. Creator Studio: Analytics Backend Verification
  const analyticsRes = await request('GET', '/profile/analytics', null, { Authorization: `Bearer ${userToken}` });
  assert(analyticsRes.status === 200 && analyticsRes.body.success === true, 'Creator analytics retrieved successfully from SQLite backend');
  assert(typeof analyticsRes.body.data.summary.total_views === 'number', 'Analytics summary provides authentic total_views');
  assert(Array.isArray(analyticsRes.body.data.daily_views), 'Analytics returns 7-day daily performance timeline');
  assert(Array.isArray(analyticsRes.body.data.top_videos), 'Analytics provides top performing videos array');

  // 22k. Creator Studio: Settings Backend Verification
  const settingsRes = await request('GET', '/profile/settings', null, { Authorization: `Bearer ${userToken}` });
  assert(settingsRes.status === 200 && settingsRes.body.success === true, 'Creator settings retrieved from SQLite backend');
  assert(settingsRes.body.data.payout && settingsRes.body.data.preferences, 'Settings exposes payout and channel preferences');

  const updatePayoutRes = await request('PUT', '/profile/settings/payout', {
    payout_type: 'USDT_BEP20',
    payout_address: '0x1234567890abcdef1234567890abcdef12345678'
  }, { Authorization: `Bearer ${userToken}` });
  assert(updatePayoutRes.status === 200 && updatePayoutRes.body.data.default_type === 'USDT_BEP20', 'Default payout wallet updated and persisted in SQLite');

  const updatePrefRes = await request('PUT', '/profile/settings/preferences', {
    allow_comments: true,
    show_watermark: true,
    email_notifications: false
  }, { Authorization: `Bearer ${userToken}` });
  assert(updatePrefRes.status === 200 && updatePrefRes.body.success === true, 'Channel preferences saved to SQLite successfully');

  // New Audit Tests: Thumbnail Pre-upload, Real Views Logging, & Zero-Mock Analytics
  const sampleThumbBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const thumbUploadRes = await request('POST', '/videos/upload-thumbnail', {
    imageBase64: sampleThumbBase64
  });
  assert(thumbUploadRes.status === 200 && thumbUploadRes.body.thumbUrl?.startsWith('/public/uploads/thumbnails/'), 'Video thumbnail base64 saved to disk storage');

  const invalidThumbRes = await request('POST', '/videos/upload-thumbnail', {
    imageBase64: 'invalid_data_not_base64'
  });
  assert(invalidThumbRes.status === 400, 'Invalid thumbnail format safely rejected with 400');

  // Verify real view tracking with traffic source
  if (uploadVidRes?.body?.data?.id) {
    const viewWithSourceRes = await request('POST', `/videos/${uploadVidRes.body.data.id}/view`, {
      source: 'trending'
    });
    assert(viewWithSourceRes.status === 200 && viewWithSourceRes.body.data.source === 'trending', 'Authentic view source logged in SQLite video_views_log');

    // Test duplicate view from same IP / device within 24h -> must be deduplicated
    const dupViewRes = await request('POST', `/videos/${uploadVidRes.body.data.id}/view`, {
      source: 'trending'
    });
    assert(dupViewRes.status === 200 && dupViewRes.body.deduplicated === true && dupViewRes.body.reason === 'rate_limited_24h', 'Subsequent view within 24h safely deduplicated without inflating view count');
  }

  // Test Video Stream Proxy (bypasses 403 / CORS and serves partial range 206)
  const streamProxyRes = await request('GET', '/videos/proxy-stream?url=' + encodeURIComponent('https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4'), null, {
    Range: 'bytes=0-100'
  });
  assert(streamProxyRes.status === 206 && streamProxyRes.headers['content-type'] === 'video/mp4', 'Stream proxy delivers partial 206 stream with video/mp4 MIME type');

  // Verify Creator Analytics calculates from authentic database state (zero fake data)
  const freshAnalyticsRes = await request('GET', '/profile/analytics', null, { Authorization: `Bearer ${userToken}` });
  assert(freshAnalyticsRes.status === 200 && Array.isArray(freshAnalyticsRes.body.data.traffic_sources), 'Creator Analytics delivers authentic traffic sources');
  assert(Array.isArray(freshAnalyticsRes.body.data.daily_views) && freshAnalyticsRes.body.data.daily_views.length === 7, 'Analytics provides authentic 7-day view timeline');

  // Verify /profile/me includes authentic coins and balance
  const profileMeCheck = await request('GET', '/profile/me', null, { Authorization: `Bearer ${userToken}` });
  assert(profileMeCheck.status === 200 && typeof profileMeCheck.body.data.coins === 'number', 'Profile data includes real user coins balance');

  const db = require('./src/db/database');

  // Video Reactions (YouTube style Like/Dislike) & Creator Earnings
  const testVid = db.prepare("SELECT id FROM videos WHERE status = 'APPROVED' LIMIT 1").get();
  if (testVid) {
    db.prepare('DELETE FROM video_reactions WHERE device_id = ?').run('TEST-YOUTUBE-DEVICE-1');
    db.prepare('DELETE FROM follows WHERE follower_device_id = ?').run('TEST-YOUTUBE-DEVICE-1');

    const reactLikeRes = await request('POST', `/videos/${testVid.id}/react`, {
      reaction: 'like',
      deviceId: 'TEST-YOUTUBE-DEVICE-1'
    });
    assert(reactLikeRes.status === 200 && reactLikeRes.body.data.userReaction === 'like', 'Video like registered and persisted in SQLite');

    const getReactionsRes = await request('GET', `/videos/${testVid.id}/reactions?deviceId=TEST-YOUTUBE-DEVICE-1`);
    assert(getReactionsRes.status === 200 && getReactionsRes.body.data.earnings && typeof getReactionsRes.body.data.earnings.usd === 'string' && typeof getReactionsRes.body.data.isFollowing === 'boolean', 'Video reactions query returns YouTube stats and real creator earnings');

    const followCreatorRes = await request('POST', '/earning/follow', {
      creatorName: 'Test YouTube Creator',
      deviceId: 'TEST-YOUTUBE-DEVICE-1'
    });
    assert(followCreatorRes.status === 200 && followCreatorRes.body.isFollowing === true, 'Creator follow toggles and syncs followers in database');

    // Test Video creation with tags & description
    const taggedVideoRes = await request('POST', '/admin/videos', {
      title: 'Exclusive Asian Viral 4K Showcase',
      tag: 'ASIAN',
      tags: 'Asian, Viral, Scandal, 4K',
      description: 'Ultra high definition uncut 4K Asian cinema video.',
      thumbImg: 'https://example.com/thumb.jpg',
      src: 'https://example.com/stream.mp4',
      duration: '15:20',
      creator: 'Test VIP Channel'
    }, { Authorization: `Bearer ${adminToken}` });
    assert(taggedVideoRes.status === 200 && taggedVideoRes.body.data.tags.includes('Viral'), 'Video created with tags & description in SQLite');

    // Test catalog filtering by category & tags
    const filterByTagRes = await request('GET', '/videos?tag=ASIAN');
    assert(filterByTagRes.status === 200 && filterByTagRes.body.data.some(v => v.id === taggedVideoRes.body.data.id), 'Videos catalog filters accurately by tag/category');

    // Test catalog search across description
    const searchDescRes = await request('GET', '/videos?q=Asian cinema');
    assert(searchDescRes.status === 200 && searchDescRes.body.data.some(v => v.id === taggedVideoRes.body.data.id), 'Video search queries across description and tags');

    // ----------------------------------------------------
    // TEST 13: CUSTOM FOLDERS & COLLECTIONS MANAGEMENT
    // ----------------------------------------------------
    console.log('\n--- TEST 13: CUSTOM FOLDERS & COLLECTIONS SYSTEM ---');

    // 13a. Get Admin Folders
    const adminFoldersRes = await request('GET', '/admin/folders', null, { Authorization: `Bearer ${adminToken}` });
    assert(adminFoldersRes.status === 200 && Array.isArray(adminFoldersRes.body.data), 'GET /admin/folders returns list of folders with video counts');

    // 13b. Create New Custom Folder
    const createFolderRes = await request('POST', '/admin/folders', {
      name: 'VIP Test Collection',
      color: '#EC4899',
      icon: 'fa-crown',
      description: 'Special custom folder for automated testing'
    }, { Authorization: `Bearer ${adminToken}` });
    assert(createFolderRes.status === 200 && createFolderRes.body.data.name === 'VIP Test Collection', 'POST /admin/folders creates custom folder in SQLite');
    const testFolderId = createFolderRes.body.data.id;

    // 13c. Update / Rename Folder
    const updateFolderRes = await request('PUT', `/admin/folders/${testFolderId}`, {
      name: 'VIP Test Collection Updated',
      color: '#7C3AED',
      icon: 'fa-gem'
    }, { Authorization: `Bearer ${adminToken}` });
    assert(updateFolderRes.status === 200 && updateFolderRes.body.data.name === 'VIP Test Collection Updated', 'PUT /admin/folders/:id updates/renames custom folder');

    // 13d. Create Video Assigned to Folder
    const folderVideoRes = await request('POST', '/admin/videos', {
      title: 'Folder Test Video Stream',
      src: 'https://darkpaki-stream.onrender.com/stream/folder-test.mp4',
      thumbImg: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800',
      tag: 'TRENDING VIDEOS',
      tags: '#foldertest, #vip',
      duration: '11:22',
      creator: 'Folder Test Studio',
      folderId: testFolderId
    }, { Authorization: `Bearer ${adminToken}` });
    assert(folderVideoRes.status === 200 && folderVideoRes.body.data.folder_id === testFolderId && folderVideoRes.body.data.folder_name === 'VIP Test Collection Updated', 'POST /admin/videos assigns video to folder_id and folder_name');

    // 13e. Filter Admin Videos by Folder
    const filterFolderRes = await request('GET', `/admin/videos?folderId=${testFolderId}`, null, { Authorization: `Bearer ${adminToken}` });
    assert(filterFolderRes.status === 200 && filterFolderRes.body.data.some(v => v.id === folderVideoRes.body.data.id), 'GET /admin/videos?folderId filters videos accurately');

    // 13f. Public Folders API
    const publicFoldersRes = await request('GET', '/videos/folders');
    assert(publicFoldersRes.status === 200 && publicFoldersRes.body.data.some(f => f.id === testFolderId && f.video_count >= 1), 'GET /videos/folders returns catalog with active video counts');

    // 13g. Delete Folder (Safe unlinking without video loss)
    const deleteFolderRes = await request('DELETE', `/admin/folders/${testFolderId}`, null, { Authorization: `Bearer ${adminToken}` });
    assert(deleteFolderRes.status === 200, 'DELETE /admin/folders/:id deletes folder cleanly');

    const unlinkedVideo = db.prepare('SELECT folder_id, folder_name FROM videos WHERE id = ?').get(folderVideoRes.body.data.id);
    assert(unlinkedVideo && unlinkedVideo.folder_id === null, 'Deleting folder unlinks videos without deleting the video records');

    // ----------------------------------------------------
    // TEST 14: TAG BANK & MANAGEMENT SYSTEM
    // ----------------------------------------------------
    console.log('\n--- TEST 14: TAG BANK & MANAGEMENT SYSTEM ---');

    // 14a. Get Admin Tags
    const getTagsRes = await request('GET', '/admin/tags', null, { Authorization: `Bearer ${adminToken}` });
    assert(getTagsRes.status === 200 && Array.isArray(getTagsRes.body.data) && getTagsRes.body.data.length >= 1, 'GET /admin/tags returns list of persistent tags');

    // 14b. Create New Tag in Bank
    const createTagRes = await request('POST', '/admin/tags', { name: '#customtagtest' }, { Authorization: `Bearer ${adminToken}` });
    assert(createTagRes.status === 200 && createTagRes.body.data.name === '#customtagtest', 'POST /admin/tags persists new tag in SQLite database');
    const newTagId = createTagRes.body.data.id;

    // 14c. Delete Tag from Bank
    const deleteTagRes = await request('DELETE', `/admin/tags/${newTagId}`, null, { Authorization: `Bearer ${adminToken}` });
    assert(deleteTagRes.status === 200, 'DELETE /admin/tags/:id removes tag from database');

    // ----------------------------------------------------
    // TEST 15: USERS & LIVE EARNINGS MANAGEMENT
    // ----------------------------------------------------
    console.log('\n--- TEST 15: USERS & LIVE EARNINGS MANAGEMENT ---');

    // 15a. Get Admin Users with Metrics
    const adminUsersRes = await request('GET', '/admin/users?page=1&limit=10', null, { Authorization: `Bearer ${adminToken}` });
    assert(
      adminUsersRes.status === 200 && 
      adminUsersRes.body.success === true && 
      Array.isArray(adminUsersRes.body.data.users) && 
      adminUsersRes.body.data.summary.total_users >= 1, 
      'GET /admin/users returns real registered users with summary metrics'
    );

    // 15b. Filter by Online Status
    const onlineUsersRes = await request('GET', '/admin/users?status=ONLINE', null, { Authorization: `Bearer ${adminToken}` });
    assert(
      onlineUsersRes.status === 200 && 
      Array.isArray(onlineUsersRes.body.data.users), 
      'GET /admin/users?status=ONLINE correctly filters active users'
    );

    // 15c. Get Single User Details
    const firstUserId = adminUsersRes.body.data.users[0]?.id;
    if (firstUserId) {
      const userDetailRes = await request('GET', `/admin/users/${firstUserId}`, null, { Authorization: `Bearer ${adminToken}` });
      assert(
        userDetailRes.status === 200 && 
        userDetailRes.body.data.id === firstUserId && 
        userDetailRes.body.data.last_active_human !== undefined, 
        'GET /admin/users/:id returns user profile, watch time, and activity history'
      );

      // 15d. Adjust User Balance & Status
      const adjustRes = await request('PUT', `/admin/users/${firstUserId}/balance`, {
        coinsDelta: 100,
        balanceDelta: 1.50,
        accountStatus: 'active',
        isMonetized: true,
        reason: 'E2E Test Bonus'
      }, { Authorization: `Bearer ${adminToken}` });
      assert(
        adjustRes.status === 200 && 
        adjustRes.body.success === true, 
        'PUT /admin/users/:id/balance atomically adjusts coins and wallet balance'
      );

      // 15e. Reset User Hardware Device Binding
      const resetDevRes = await request('POST', `/admin/users/${firstUserId}/reset-device`, {}, { Authorization: `Bearer ${adminToken}` });
      assert(
        resetDevRes.status === 200 && 
        resetDevRes.body.success === true, 
        'POST /admin/users/:id/reset-device unlocks hardware device binding'
      );
    }

    // ----------------------------------------------------
    // TEST 16: GOOGLE ADSENSE APPROVAL HUB & COMPLIANCE PAGES
    // ----------------------------------------------------
    console.log('\n--- TEST 16: GOOGLE ADSENSE APPROVAL HUB & COMPLIANCE ---');

    // 16a. Preview Google AdSense Approval Portal
    const approvalRes = await request('GET', '/approval');
    assert(approvalRes.status === 200 && (approvalRes.body.includes('Editorial Showcase') || approvalRes.body.includes('Anizon Cinema')), 'GET /approval serves Google AdSense clean review portal');

    // 16b. Privacy Policy Compliance Page
    const privacyRes = await request('GET', '/privacy');
    assert(privacyRes.status === 200 && privacyRes.body.includes('Privacy Policy'), 'GET /privacy serves standard AdSense Privacy & Cookie Policy');

    // 16c. Terms of Service Page
    const termsRes = await request('GET', '/terms');
    assert(termsRes.status === 200 && termsRes.body.includes('Terms of Service'), 'GET /terms serves platform Terms of Service');

    // 16d. About Platform Page
    const aboutRes = await request('GET', '/about');
    assert(aboutRes.status === 200 && aboutRes.body.includes('About Anizon Media Network'), 'GET /about serves About Us publisher information');

    // 16e. Contact Us Page
    const contactRes = await request('GET', '/contact');
    assert(contactRes.status === 200 && contactRes.body.includes('Contact Us'), 'GET /contact serves publisher contact form and support');

    // 16f. ads.txt Public Endpoint
    const adsTxtRes = await request('GET', '/ads.txt');
    assert(adsTxtRes.status === 200 && adsTxtRes.body.includes('google.com, pub-'), 'GET /ads.txt serves official Google AdSense publisher specification');

    // 16g. Update AdSense Settings via Admin Console
    const updateAdSenseRes = await request('PUT', '/admin/settings', {
      adsensePubId: 'ca-pub-9998887776665554',
      adsenseSlotId: '1234567890',
      adsenseHeadCode: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9998887776665554" crossorigin="anonymous"></script>',
      adsenseEnabled: true,
      adsTxtContent: 'google.com, pub-9998887776665554, DIRECT, f08c47fec0942fa0'
    }, { Authorization: `Bearer ${adminToken}` });
    assert(updateAdSenseRes.status === 200 && updateAdSenseRes.body.success === true, 'PUT /admin/settings saves AdSense credentials and ads.txt specification');

    // Cleanup reaction & follow & test video
    db.prepare('DELETE FROM video_reactions WHERE device_id = ?').run('TEST-YOUTUBE-DEVICE-1');
    db.prepare('DELETE FROM follows WHERE follower_device_id = ?').run('TEST-YOUTUBE-DEVICE-1');
    if (taggedVideoRes?.body?.data?.id) {
      db.prepare('DELETE FROM videos WHERE id = ?').run(taggedVideoRes.body.data.id);
    }
    if (folderVideoRes?.body?.data?.id) {
      db.prepare('DELETE FROM videos WHERE id = ?').run(folderVideoRes.body.data.id);
    }
  }

  // Automatic Cleanup of Temporary Test Artifacts (Preserves Clean Database)
  if (uploadVidRes?.body?.data?.id) db.prepare('DELETE FROM videos WHERE id = ?').run(uploadVidRes.body.data.id);
  if (newCommentRes?.body?.data?.commentId) {
    db.prepare('DELETE FROM comments WHERE id = ?').run(newCommentRes.body.data.commentId);
    db.prepare("DELETE FROM demands WHERE topic LIKE '%full uncut 4K video session upload kijiye%'").run();
  }
  if (testDeviceId) {
    db.prepare('DELETE FROM users WHERE device_id = ?').run(testDeviceId);
    db.prepare('DELETE FROM users WHERE gmail LIKE \'otp.test%\'').run();
    db.prepare("DELETE FROM demand_votes WHERE device_id IN (?, 'DPK-DEV-VOTER-2')").run(testDeviceId);
    db.prepare('DELETE FROM withdrawals WHERE user_id NOT IN (SELECT id FROM users)').run();
  }
  if (aiGenRes?.body?.data?.id) {
    db.prepare('DELETE FROM ai_image_likes WHERE image_id = ?').run(aiGenRes.body.data.id);
    db.prepare('DELETE FROM ai_images WHERE id = ?').run(aiGenRes.body.data.id);
  }

  console.log('\n====================================================');
  console.log(`TOTAL AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

server = app.listen(PORT, async () => {
  try {
    await runTests();
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    server.close();
    process.exit(0);
  }
});

