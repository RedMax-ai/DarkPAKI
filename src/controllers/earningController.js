const db = require('../db/database');
const { sanitizeString } = require('../middleware/validator');

function creditWatchBonus(req, res, next) {
  try {
    const userId = req.user.id;

    // Atomic update: +₹2 to balance, +20 coins, +1 to ads_watched
    db.prepare('UPDATE users SET balance = balance + 2.0, coins = coins + 20, ads_watched = ads_watched + 1 WHERE id = ?').run(userId);

    const updatedUser = db.prepare('SELECT balance, coins, ads_watched FROM users WHERE id = ?').get(userId);

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'WATCH_BONUS_CREDITED',
      `User ID ${userId} credited +20 Coins and ₹2.0 for watching video ad`,
      req.ip,
      req.user.device_id
    );

    res.json({
      success: true,
      message: '+20 Coins & +₹2 Watch Bonus credited successfully!',
      data: {
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

    // +₹15 to balance, +100 coins, +1 to referrals
    db.prepare('UPDATE users SET balance = balance + 15.0, coins = coins + 100, referrals = referrals + 1 WHERE id = ?').run(userId);

    const updatedUser = db.prepare('SELECT balance, coins, referrals FROM users WHERE id = ?').get(userId);

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'TEST_REFERRAL_CREDITED',
      `User ID ${userId} tested referral: +100 Coins & +₹15 credited`,
      req.ip,
      req.user.device_id
    );

    res.json({
      success: true,
      message: '+100 Coins & +₹15 Referral Bonus credited for 1 verified friend!',
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

    if (isNaN(coinsToConvert) || coinsToConvert < 10) {
      return res.status(400).json({
        success: false,
        message: 'Minimum 10 coins required for conversion (10 Coins = ₹1.00).'
      });
    }

    if (availableCoins < coinsToConvert) {
      return res.status(400).json({
        success: false,
        message: `Insufficient coins! You currently have ${availableCoins} coins.`
      });
    }

    // Convert in multiples of 10
    const coinsDeducted = Math.floor(coinsToConvert / 10) * 10;
    const cashGained = coinsDeducted / 10.0;

    // Atomic SQLite transaction
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('UPDATE users SET coins = coins - ?, balance = balance + ? WHERE id = ?').run(coinsDeducted, cashGained, userId);
      db.exec('COMMIT;');

      const updatedUser = db.prepare('SELECT balance, coins FROM users WHERE id = ?').get(userId);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'COINS_CONVERTED_TO_CASH',
        `User ID ${userId} converted ${coinsDeducted} coins to ₹${cashGained.toFixed(2)} cash`,
        req.ip,
        user.device_id
      );

      res.json({
        success: true,
        message: `Successfully converted ${coinsDeducted} Coins to ₹${cashGained.toFixed(2)} Cash!`,
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
    const { upiId, amount } = req.body;

    const cleanUpi = sanitizeString(upiId);
    if (!cleanUpi || !cleanUpi.includes('@')) {
      return res.status(400).json({ success: false, message: 'Invalid UPI ID format (e.g. name@ybl or mobile@paytm).' });
    }

    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount < 50) {
      return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is ₹50.' });
    }

    // Check balance in database
    const user = db.prepare('SELECT balance, device_id FROM users WHERE id = ?').get(userId);
    if (!user || user.balance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance! Your current balance is ₹${user ? user.balance.toFixed(2) : 0}.`
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
      const result = insertWithdrawal.run(userId, cleanUpi, withdrawAmount, user.device_id);
      db.exec('COMMIT;');

      const updatedUser = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);

      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'WITHDRAWAL_REQUESTED',
        `User ID ${userId} requested withdrawal of ₹${withdrawAmount} to ${cleanUpi}`,
        req.ip,
        user.device_id
      );

      res.json({
        success: true,
        message: `Withdrawal request of ₹${withdrawAmount} to "${cleanUpi}" submitted successfully!`,
        data: {
          withdrawalId: result.lastInsertRowid,
          newBalance: updatedUser.balance,
          upiId: cleanUpi,
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

module.exports = {
  creditWatchBonus,
  simulateReferral,
  convertCoins,
  submitWithdrawal,
  getWithdrawals
};

