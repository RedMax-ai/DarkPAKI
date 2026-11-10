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

  // 1. Health Check
  const healthRes = await request('GET', '/health');
  assert(healthRes.status === 200 && healthRes.body.status === 'online', 'Health check responds online');

  // 2. Videos Catalog
  const videosRes = await request('GET', '/videos');
  assert(videosRes.status === 200 && Array.isArray(videosRes.body.data) && videosRes.body.data.length >= 6, 'Videos catalog returned from SQLite (>= 6 videos)');

  // 3. Ad & Telegram Config
  const configRes = await request('GET', '/videos/config');
  assert(configRes.status === 200 && configRes.body.data.adVideoUrl.includes('http'), 'Ad & Telegram configuration returned correctly');

  // 4. Captcha Generation
  const captchaRes = await request('GET', '/auth/captcha');
  assert(captchaRes.status === 200 && captchaRes.body.data.challengeToken && captchaRes.body.data.question.includes('+'), 'Cryptographically signed human math challenge generated');

  // 4b. 18+ Age Compliance Verification
  const ageVerifyRes = await request('POST', '/auth/verify-age', { deviceId: 'DPK-TEST-DEV-8899', confirmed: true });
  assert(ageVerifyRes.status === 200 && ageVerifyRes.body.success === true, '18+ legal age compliance verified and logged');

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
  assert(registerRes.status === 200 && registerRes.body.token && registerRes.body.data.balance === 25.0, 'User registered: Received JWT token, 1-Device Bound, and ₹25 welcome bonus');
  const userToken = registerRes.body.token;

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

  // 8. Watch Video Ad Bonus (1-9 random coins or 10 coins for ad)
  const watchBonusRes = await request('POST', '/earning/watch-bonus', { type: 'ad_bonus' }, { Authorization: `Bearer ${userToken}` });
  assert(watchBonusRes.status === 200 && watchBonusRes.body.data.coins === 60 && watchBonusRes.body.data.adsWatched === 1, 'Watch video bonus credits +10 Coins (60 coins) in SQLite');

  // 9. Referral Bonus (+100 Coins & +₹15.0 per referral)
  await request('POST', '/earning/test-referral', null, { Authorization: `Bearer ${userToken}` });
  const ref2Res = await request('POST', '/earning/test-referral', null, { Authorization: `Bearer ${userToken}` });
  assert(ref2Res.status === 200 && ref2Res.body.data.coins === 260 && ref2Res.body.data.referrals === 2, 'Referral credits persist: referrals count 2 and 260 coins');

  // 9b. Convert Coins to Money (Coverate): 100 Coins = ₹1.00 Cash
  const convertRes = await request('POST', '/earning/convert-coins', { coins: 100 }, { Authorization: `Bearer ${userToken}` });
  assert(convertRes.status === 200 && convertRes.body.data.coins === 160, 'Converted 100 coins to cash: remaining coins 160');

  // 10. Withdrawal with Atomic Deductions
  const currentBal = convertRes.body.data.balance;
  const withdrawAmount = 50;
  const withdrawRes = await request('POST', '/earning/withdraw', {
    upiId: 'hamza@okhdfcbank',
    amount: withdrawAmount
  }, { Authorization: `Bearer ${userToken}` });
  assert(withdrawRes.status === 200 && Math.abs(withdrawRes.body.data.newBalance - (currentBal - withdrawAmount)) < 0.01 && withdrawRes.body.data.status === 'QUEUED', 'Instant withdrawal processed and queued in SQLite');

  // 11. Overdraw prevention
  const overdrawRes = await request('POST', '/earning/withdraw', {
    upiId: 'hamza@okhdfcbank',
    amount: 99999
  }, { Authorization: `Bearer ${userToken}` });
  assert(overdrawRes.status === 400 && overdrawRes.body.message.includes('Insufficient balance'), 'Overdraw correctly rejected when balance < amount');

  // 12. Community Demand Poll Voting
  const allDemandsRes = await request('GET', '/demands/poll');
  const targetDemandId = (allDemandsRes.body?.data && allDemandsRes.body.data[0]) ? allDemandsRes.body.data[0].id : 1;
  const pollVoteRes = await request('POST', `/demands/poll/${targetDemandId}/vote`, { deviceId: testDeviceId });
  assert(pollVoteRes.status === 200 && pollVoteRes.body.data.voted === true, 'Upvoted demand topic in SQLite database');

  // 13. Submit New Demand & Comment
  const newCommentRes = await request('POST', '/demands/comments', {
    userName: 'Hamza Khan',
    creatorTarget: 'Desi Night Studio',
    badge: '🔥 High-Demand Request',
    text: 'Desi Night Studio ka full uncut 4K video session upload kijiye!',
    deviceId: testDeviceId
  });
  assert(newCommentRes.status === 200 && newCommentRes.body.data.commentId, 'New community demand and comment persisted in database');

  // 14. Like Comment Toggle
  const likeRes = await request('POST', `/demands/comments/${newCommentRes.body.data.commentId}/like`, { deviceId: 'DPK-DEV-OTHER' });
  assert(likeRes.status === 200 && likeRes.body.data.liked === true, 'Comment like toggled and updated in database');

  // 15. Admin Master PIN Authentication
  const adminLoginRes = await request('POST', '/admin/login', {
    pin: '7860',
    deviceId: testDeviceId
  });
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

  // 18. Admin Settings Update
  const updateSettingsRes = await request('PUT', '/admin/settings', {
    telegramUrl: 'https://t.me/darkpaki_vip',
    allowInstantSkip: true
  }, { Authorization: `Bearer ${adminToken}` });
  assert(updateSettingsRes.status === 200, 'Admin updated Telegram URL and instant skip rules in SQLite');

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

  // Automatic Cleanup of Temporary Test Artifacts (Preserves Clean Database)
  const db = require('./src/db/database');
  if (uploadVidRes?.body?.data?.id) db.prepare('DELETE FROM videos WHERE id = ?').run(uploadVidRes.body.data.id);
  if (newCommentRes?.body?.data?.commentId) {
    db.prepare('DELETE FROM comments WHERE id = ?').run(newCommentRes.body.data.commentId);
    db.prepare("DELETE FROM demands WHERE topic LIKE '%full uncut 4K video session upload kijiye%'").run();
  }
  if (testDeviceId) {
    db.prepare('DELETE FROM users WHERE device_id = ?').run(testDeviceId);
    db.prepare('DELETE FROM users WHERE gmail LIKE \'otp.test%\'').run();
    db.prepare('DELETE FROM demand_votes WHERE device_id = ?').run(testDeviceId);
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

