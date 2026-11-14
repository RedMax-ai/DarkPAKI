const db = require('../db/database');
const { sanitizeString } = require('../middleware/validator');

// Credit Watch Bonus
// Sponsor Video Ad Watch: 20, 25, or 30 Coins randomly (with proportional USD cash)
// Conversion Rate: 100 Coins = $0.011 USD
function creditWatchBonus(req, res, next) {
  try {
    const userId = req.user.id;
    const type = req.body?.type || 'video_watch';

    // 20 - 25 - 30 Random Coins per sponsor ad
    const coinOptions = [20, 25, 30];
    const coinsEarned = coinOptions[Math.floor(Math.random() * coinOptions.length)];
    // 20 coins = $0.022, 25 coins = $0.0275, 30 coins = $0.033
    const cashEarned = +(coinsEarned * 0.0011).toFixed(4);
    const msg = `+${coinsEarned} Coins ($${cashEarned.toFixed(3)}) Watch to Earn Bonus credited!`;

    // Atomic update
    db.prepare('UPDATE users SET balance = balance + ?, coins = coins + ?, ads_watched = ads_watched + 1 WHERE id = ?')
      .run(cashEarned, coinsEarned, userId);

    const updatedUser = db.prepare('SELECT balance, coins, ads_watched FROM users WHERE id = ?').get(userId);

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'WATCH_BONUS_CREDITED',
      `User ID ${userId} credited +${coinsEarned} Coins and $${cashEarned} (${type})`,
      req.ip,
      req.user.device_id
    );

    res.json({
      success: true,
      message: msg,
      data: {
        coinsEarned,
        cashEarned,
        balance: updatedUser.balance,
        coins: updatedUser.coins,
        adsWatched: updatedUser.ads_watched
      }
    });
  } catch (err) {
    next(err);
  }
}

function simulateReferral(req, res, next) {
  try {
    const userId = req.user.id;

    // +$0.165 USD to balance, +100 coins (100 coins = $0.011 USD), +1 to referrals
    db.prepare('UPDATE users SET balance = balance + 0.165, coins = coins + 100, referrals = referrals + 1 WHERE id = ?').run(userId);

    const updatedUser = db.prepare('SELECT balance, coins, referrals FROM users WHERE id = ?').get(userId);

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'TEST_REFERRAL_CREDITED',
      `User ID ${userId} tested referral: +100 Coins & +$0.165 credited`,
      req.ip,
      req.user.device_id
    );

    res.json({
      success: true,
      message: '+100 Coins & +$0.165 Referral Bonus credited for 1 verified friend!',
      data: {
        balance: updatedUser.balance,
        coins: updatedUser.coins,
        referrals: updatedUser.referrals
      }
    });
  } catch (err) {
    next(err);
  }
}

// Convert Coins: Minimum 1,000 Coins (1,000 Coins = $0.11 USD)
function convertCoins(req, res, next) {
  try {
    const userId = req.user.id;
    const { coins } = req.body;

    const user = db.prepare('SELECT balance, coins, device_id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const availableCoins = user.coins || 0;
    let coinsToConvert = (coins === 'all') ? availableCoins : parseInt(coins, 10);

    if (isNaN(coinsToConvert) || coinsToConvert < 1000) {
      return res.status(400).json({
        success: false,
        message: 'Minimum 1,000 coins required for conversion (1,000 Coins = $0.11 USD Cash).'
      });
    }

    if (availableCoins < coinsToConvert) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins! You currently have ${availableCoins} coins (Minimum 1,000 required).`
      });
    }

    // Convert in multiples of 100: 100 coins = $0.011 USD (1 coin = $0.00011 USD)
    const coinsDeducted = Math.floor(coinsToConvert / 100) * 100;
    const cashGained = +(coinsDeducted * 0.00011).toFixed(4);

    // Atomic SQLite transaction
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('UPDATE users SET coins = coins - ?, balance = balance + ? WHERE id = ?').run(coinsDeducted, cashGained, userId);
      db.exec('COMMIT;');

      const updatedUser = db.prepare('SELECT balance, coins FROM users WHERE id = ?').get(userId);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'COINS_CONVERTED_TO_CASH',
        `User ID ${userId} converted ${coinsDeducted} coins to $${cashGained.toFixed(4)} cash (1,000 Coins = $0.11 USD)`,
        req.ip,
        user.device_id
      );

      res.json({
        success: true,
        message: `Successfully converted ${coinsDeducted} Coins to $${cashGained.toFixed(4)} USD Cash!`,
        data: {
          coinsDeducted,
          cashGained,
          coins: updatedUser.coins,
          balance: updatedUser.balance
        }
      });
    } catch (txnErr) {
      db.exec('ROLLBACK;');
      throw txnErr;
    }
  } catch (err) {
    next(err);
  }
}

function submitWithdrawal(req, res, next) {
  try {
    const userId = req.user.id;
    const { upiId, walletAddress, amount } = req.body;

    const cleanWallet = sanitizeString(walletAddress || upiId);
    if (!cleanWallet || cleanWallet.length < 10) {
      return res.status(400).json({ success: false, message: 'Invalid Crypto USDT (TRC20 / BEP20) wallet address format.' });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount < 10) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $10 USDT.' });
    }

    // Check balance in database
    const user = db.prepare('SELECT balance, device_id FROM users WHERE id = ?').get(userId);
    if (!user || user.balance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance! Your current balance is $${user ? user.balance.toFixed(user.balance < 1 ? 3 : 2) : '0.00'}.`
      });
    }

    // Atomic withdrawal transaction
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(withdrawAmount, userId);
      const insertWithdrawal = db.prepare(`
        INSERT INTO withdrawals (user_id, upi_id, amount, device_id, status)
        VALUES (?, ?, ?, ?, 'QUEUED')
      `);
      const result = insertWithdrawal.run(userId, cleanWallet, withdrawAmount, user.device_id);
      db.exec('COMMIT;');

      const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'WITHDRAWAL_REQUESTED',
        `User ID ${userId} requested withdrawal of $${withdrawAmount.toFixed(2)} USDT to ${cleanWallet}`,
        req.ip,
        user.device_id
      );

      res.json({
        success: true,
        message: `Withdrawal request of $${withdrawAmount.toFixed(2)} USDT to "${cleanWallet}" submitted successfully!`,
        data: {
          withdrawalId: result.lastInsertRowid,
          newBalance: updatedUser.balance,
          upiId: cleanWallet,
          walletAddress: cleanWallet,
          amount: withdrawAmount,
          status: 'QUEUED'
        }
      });
    } catch (txnErr) {
      db.exec('ROLLBACK;');
      throw txnErr;
    }
  } catch (err) {
    next(err);
  }
}

function getWithdrawals(req, res, next) {
  try {
    const userId = req.user.id;
    const history = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC').all(userId);

    res.json({
      success: true,
      data: history
    });
  } catch (err) {
    next(err);
  }
}

// Follow / Unfollow Creator with Unique Device ID Anti-Spam
function followCreator(req, res, next) {
  try {
    const { creatorName, deviceId } = req.body;
    const cleanCreator = sanitizeString(creatorName);
    const cleanDevice = sanitizeString(deviceId) || req.user?.device_id || req.ip;

    if (!cleanCreator) {
      return res.status(400).json({ success: false, message: 'Creator name is required.' });
    }

    const existing = db.prepare('SELECT id FROM follows WHERE creator_name = ? COLLATE NOCASE AND follower_device_id = ?').get(cleanCreator, cleanDevice);
    let isFollowing = false;

    if (existing) {
      db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
      isFollowing = false;
    } else {
      db.prepare('INSERT INTO follows (creator_name, follower_device_id) VALUES (?, ?)').run(cleanCreator, cleanDevice);
      isFollowing = true;
    }

    const countRow = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(cleanCreator);
    const followersCount = countRow ? countRow.count : 0;

    // Sync user followers_count
    db.prepare('UPDATE users SET followers_count = ? WHERE name = ? COLLATE NOCASE').run(followersCount, cleanCreator);

    res.json({
      success: true,
      isFollowing,
      followersCount,
      message: isFollowing ? `You followed ${cleanCreator}!` : `Unfollowed ${cleanCreator}`
    });
  } catch (err) {
    next(err);
  }
}

// Check Creator Monetization Status & Eligibility
// Criteria: At least 1 video >= 1,000 views AND >= 10 followers
function getMonetizationStatus(req, res, next) {
  try {
    const user = req.user;
    const userName = user.name;

    // Fetch Creator's Approved Videos
    const videos = db.prepare('SELECT * FROM videos WHERE (creator = ? COLLATE NOCASE OR owner_name = ? COLLATE NOCASE OR owner_email = ? COLLATE NOCASE) AND status = ?')
      .all(userName, userName, user.gmail, 'APPROVED');

    let totalViews = 0;
    let maxViews = 0;
    for (const v of videos) {
      const vCount = v.views_count || 0;
      totalViews += vCount;
      if (vCount > maxViews) maxViews = vCount;
    }

    // Followers count
    const followRow = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(userName);
    const followersCount = Math.max(user.followers_count || 0, followRow ? followRow.count : 0);

    const meetsViewsRequirement = maxViews >= 1000;
    const meetsFollowersRequirement = followersCount >= 10;
    const isEligible = meetsViewsRequirement && meetsFollowersRequirement;

    const app = db.prepare('SELECT * FROM monetization_applications WHERE user_id = ? OR email = ? ORDER BY id DESC LIMIT 1')
      .get(user.id, user.gmail);

    res.json({
      success: true,
      data: {
        isMonetized: Boolean(user.is_monetized),
        isEligible,
        maxViews,
        requiredViews: 1000,
        meetsViewsRequirement,
        followersCount,
        requiredFollowers: 10,
        meetsFollowersRequirement,
        totalVideos: videos.length,
        totalViews,
        applicationStatus: app ? app.status : 'NONE',
        application: app || null
      }
    });
  } catch (err) {
    next(err);
  }
}

// Apply for Creator Monetization
function applyMonetization(req, res, next) {
  try {
    const user = req.user;
    const { channelName, realName, email, phone, notes } = req.body;

    const cleanChannel = sanitizeString(channelName) || user.name;
    const cleanRealName = sanitizeString(realName) || user.name;
    const cleanEmail = sanitizeString(email) || user.gmail;
    const cleanPhone = sanitizeString(phone) || user.phone;

    // Verify Eligibility
    const videos = db.prepare('SELECT * FROM videos WHERE (creator = ? COLLATE NOCASE OR owner_name = ? COLLATE NOCASE OR owner_email = ? COLLATE NOCASE) AND status = ?')
      .all(cleanChannel, cleanChannel, cleanEmail, 'APPROVED');

    let totalViews = 0;
    let maxViews = 0;
    for (const v of videos) {
      const vCount = v.views_count || 0;
      totalViews += vCount;
      if (vCount > maxViews) maxViews = vCount;
    }

    const followRow = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(cleanChannel);
    const followersCount = Math.max(user.followers_count || 0, followRow ? followRow.count : 0);

    if (maxViews < 1000 || followersCount < 10) {
      return res.status(400).json({
        success: false,
        message: `Eligibility requirements not met: At least 1 video with 1,000+ views (Your highest: ${maxViews}) and 10+ followers (Your followers: ${followersCount}).`
      });
    }

    // Check existing pending application
    const existing = db.prepare("SELECT id, status FROM monetization_applications WHERE (user_id = ? OR email = ?) AND status = 'PENDING'")
      .get(user.id, cleanEmail);
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending monetization application in review with DarkPAKI Admin.'
      });
    }

    const insertApp = db.prepare(`
      INSERT INTO monetization_applications (user_id, creator_name, email, phone, channel_name, total_views, followers_count, max_single_views, is_human_verified, status, admin_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'PENDING', ?)
    `);
    insertApp.run(user.id, cleanChannel, cleanEmail, cleanPhone, cleanChannel, totalViews, followersCount, maxViews, notes || 'Applied via Creator Portal');

    db.prepare("UPDATE users SET monetization_status = 'APPLIED', real_name = ? WHERE id = ?").run(cleanRealName, user.id);

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'CREATOR_MONETIZATION_APPLIED',
      `User ${user.id} (${cleanEmail}) applied for Creator Monetization. Channel: "${cleanChannel}", Best views: ${maxViews}, Followers: ${followersCount}`,
      req.ip,
      user.device_id
    );

    res.json({
      success: true,
      message: '🎉 Monetization application submitted successfully! DarkPAKI Admin will review your channel and verify original content.'
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  creditWatchBonus,
  simulateReferral,
  convertCoins,
  submitWithdrawal,
  getWithdrawals,
  followCreator,
  getMonetizationStatus,
  applyMonetization
};
