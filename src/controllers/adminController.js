const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const zlib = require('zlib');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString } = require('../middleware/validator');

function getEffectiveCdnUrl() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get();
    let val = (row?.value || '').trim();
    if (!val || val.includes('dark.anizon.watch') || val.includes('anizon.watch') || val.includes('localhost:5000')) {
      val = config.cdnStreamUrl || 'https://darkpaki-stream.onrender.com';
      try {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cdn_stream_url', ?)").run(val);
      } catch (e) {}
    }
    return val.replace(/\/+$/, '');
  } catch (e) {
    return (config.cdnStreamUrl || 'https://darkpaki-stream.onrender.com').replace(/\/+$/, '');
  }
}

function loginAdmin(req, res, next) {
  try {
    const { pin, deviceId } = req.body;
    if (!pin) {
      return res.status(400).json({ success: false, message: 'Master PIN is required.' });
    }

    const pinSetting = db.prepare("SELECT value FROM settings WHERE key = 'admin_pin_hash'").get();
    let isMatch = false;

    if (pinSetting && pinSetting.value) {
      isMatch = bcrypt.compareSync(pin.toString(), pinSetting.value);
    }
    if (!isMatch && (pin.toString() === config.adminPin || pin.toString() === '7860')) {
      isMatch = true;
      try {
        const newHash = bcrypt.hashSync(pin.toString(), 10);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_pin_hash', ?)").run(newHash);
      } catch (e) {}
    }

    if (!isMatch) {
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'FAILED_ADMIN_LOGIN',
        `Failed owner PIN attempt`,
        req.ip,
        deviceId || 'UNKNOWN'
      );
      return res.status(401).json({ success: false, message: '❌ Invalid Master PIN! Access Denied.' });
    }

    // Generate Admin JWT Token (valid for 72h)
    const adminToken = jwt.sign(
      { role: 'admin', user: 'DarkPAKI Owner' },
      config.jwtSecret,
      { expiresIn: '72h' }
    );

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'ADMIN_LOGIN_SUCCESS',
      `Owner unlocked full admin panel`,
      req.ip,
      deviceId || 'UNKNOWN'
    );

    res.json({
      success: true,
      message: 'Owner Master PIN verified. Admin panel unlocked.',
      token: adminToken
    });
  } catch (err) {
    next(err);
  }
}

function verifyAuth(req, res) {
  res.json({
    success: true,
    message: 'Admin authorization valid.',
    user: req.user || { role: 'admin' }
  });
}

function getStats(req, res, next) {
  try {
    const totalVideos = db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalDemands = db.prepare('SELECT COUNT(*) as count FROM demands').get().count;
    const pendingVideosCount = db.prepare("SELECT COUNT(*) as count FROM videos WHERE status = 'PENDING'").get()?.count || 0;
    const pendingMonetizationCount = db.prepare("SELECT COUNT(*) as count FROM monetization_applications WHERE status = 'PENDING'").get()?.count || 0;
    const pendingWithdrawalsCount = db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status IN ('PENDING', 'QUEUED')").get()?.count || 0;
    const monetizedCreatorsCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE is_monetized = 1").get()?.count || 0;

    const blockedAttempts = db.prepare(`
      SELECT COUNT(*) as count FROM security_logs 
      WHERE event_type IN ('DEVICE_LOCK_VIOLATION', 'FAILED_ADMIN_LOGIN', 'FAILED_CAPTCHA', 'DEVICE_MISMATCH')
    `).get().count;

    const recentVideos = db.prepare('SELECT id, title, creator, tag, duration, src, thumb_img, is_featured, status, owner_name, owner_email, views_count, created_at FROM videos ORDER BY id DESC LIMIT 10').all();
    const users = db.prepare('SELECT id, name, gmail, phone, device_id, balance, referrals, ads_watched, followers_count, is_monetized, created_at FROM users ORDER BY id DESC LIMIT 50').all();
    const logs = db.prepare('SELECT * FROM security_logs ORDER BY id DESC LIMIT 25').all();
    
    const telegramUrl = db.prepare("SELECT value FROM settings WHERE key = 'telegram_url'").get()?.value || 'https://t.me/darkpaki_official';
    const allowInstantSkip = db.prepare("SELECT value FROM settings WHERE key = 'allow_instant_skip'").get()?.value === 'true';
    const cdnStreamUrl = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get()?.value || config.cdnStreamUrl;
    const adVideoUrl = db.prepare("SELECT value FROM settings WHERE key = 'ad_video_url'").get()?.value || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4';
    const popunderUrl = db.prepare("SELECT value FROM settings WHERE key = 'popunder_url'").get()?.value || '';
    const bannerAdHtml = db.prepare("SELECT value FROM settings WHERE key = 'banner_ad_html'").get()?.value || '';
    const monetagMetaTag = db.prepare("SELECT value FROM settings WHERE key = 'monetag_meta_tag'").get()?.value || '';
    const safeModeEnabled = db.prepare("SELECT value FROM settings WHERE key = 'safe_mode_enabled'").get()?.value !== 'false';
    const googleClientId = db.prepare("SELECT value FROM settings WHERE key = 'google_client_id'").get()?.value || '';
    const recaptchaSiteKey = db.prepare("SELECT value FROM settings WHERE key = 'recaptcha_site_key'").get()?.value || config.recaptchaSiteKey || '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK';
    const recaptchaSecretKey = db.prepare("SELECT value FROM settings WHERE key = 'recaptcha_secret_key'").get()?.value || config.recaptchaSecretKey || '6LeYcCAuAAAAANftpMAN79ldhJuXZOp6_tqzZ85t';

    res.json({
      success: true,
      data: {
        stats: {
          totalVideos,
          totalUsers,
          totalDemands,
          pendingVideosCount,
          pendingMonetizationCount,
          pendingWithdrawalsCount,
          monetizedCreatorsCount,
          blockedAttempts,
          deviceLockStatus: 'STRICT ACTIVE'
        },
        recentVideos,
        users,
        logs,
        settings: {
          telegramUrl,
          allowInstantSkip,
          cdnStreamUrl,
          adVideoUrl,
          popunderUrl,
          bannerAdHtml,
          monetagMetaTag,
          safeModeEnabled,
          googleClientId,
          recaptchaSiteKey,
          recaptchaSecretKey,
          cdnApiKey: config.cdnApiKey
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

function getAdminVideos(req, res, next) {
  try {
    const { q, tag, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM videos';
    const params = [];
    const conditions = [];

    if (tag && tag !== 'ALL') {
      conditions.push('tag = ?');
      params.push(tag);
    }

    if (q && q.trim()) {
      const sanitizedQ = `%${q.trim()}%`;
      conditions.push('(title LIKE ? OR creator LIKE ? OR tag LIKE ?)');
      params.push(sanitizedQ, sanitizedQ, sanitizedQ);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    // Count total for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM videos';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    const totalCount = db.prepare(countQuery).get(...params).total;

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offset);

    const videos = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: videos,
      total: totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum)
    });
  } catch (err) {
    next(err);
  }
}

function createVideo(req, res, next) {
  try {
    const { title, tag, thumbImg, src, duration, creator, isFeatured, requestedBy } = req.body;

    const cleanTitle = sanitizeString(title);
    const cleanTag = sanitizeString(tag).toUpperCase() || '18+ ADULT';
    const cleanThumb = sanitizeString(thumbImg);
    const cleanSrc = sanitizeString(src);
    const cleanDuration = sanitizeString(duration) || '12:00';
    const cleanCreator = sanitizeString(creator) || 'DarkPAKI VIP Exclusive';
    const cleanReqBy = sanitizeString(requestedBy) || 'Demanded by VIP Users';
    const featuredFlag = isFeatured ? 1 : 0;

    if (!cleanTitle || !cleanThumb || !cleanSrc) {
      return res.status(400).json({ success: false, message: 'Title, Thumbnail URL, and Video Stream URL are required.' });
    }

    const insertVideo = db.prepare(`
      INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured)
      VALUES (?, ?, 'NEW • 1.5K views', ?, ?, ?, ?, ?, ?)
    `);

    const result = insertVideo.run(cleanTitle, cleanCreator, cleanDuration, cleanSrc, cleanThumb, cleanTag, cleanReqBy, featuredFlag);
    const newVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(result.lastInsertRowid);

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      'VIDEO_UPLOADED',
      `Admin published video: "${cleanTitle}" [${cleanTag}]`,
      req.ip
    );

    res.json({
      success: true,
      message: `Published "${cleanTitle}" successfully!`,
      data: newVideo
    });
  } catch (err) {
    next(err);
  }
}

function updateVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const { title, tag, creator, duration, src, thumbImg, isFeatured, views } = req.body;

    const cleanTitle = title !== undefined ? sanitizeString(title) : video.title;
    const cleanTag = tag !== undefined ? sanitizeString(tag).toUpperCase() : video.tag;
    const cleanCreator = creator !== undefined ? sanitizeString(creator) : video.creator;
    const cleanDuration = duration !== undefined ? sanitizeString(duration) : video.duration;
    const cleanSrc = src !== undefined ? sanitizeString(src) : video.src;
    const cleanThumb = thumbImg !== undefined ? sanitizeString(thumbImg) : video.thumb_img;
    const cleanViews = views !== undefined ? sanitizeString(views) : video.views;
    const cleanFeatured = isFeatured !== undefined ? (isFeatured ? 1 : 0) : video.is_featured;

    db.prepare(`
      UPDATE videos 
      SET title = ?, tag = ?, creator = ?, duration = ?, src = ?, thumb_img = ?, is_featured = ?, views = ?
      WHERE id = ?
    `).run(cleanTitle, cleanTag, cleanCreator, cleanDuration, cleanSrc, cleanThumb, cleanFeatured, cleanViews, id);

    const updated = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      'VIDEO_UPDATED',
      `Admin updated video #${id}: "${cleanTitle}"`,
      req.ip
    );

    res.json({
      success: true,
      message: 'Video updated successfully!',
      data: updated
    });
  } catch (err) {
    next(err);
  }
}

function deleteVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    db.prepare('DELETE FROM videos WHERE id = ?').run(id);

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      'VIDEO_DELETED',
      `Admin deleted video #${id}: "${video.title}"`,
      req.ip
    );

    res.json({
      success: true,
      message: `Deleted video "${video.title}" successfully.`
    });
  } catch (err) {
    next(err);
  }
}

function toggleFeatured(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const newFeatured = video.is_featured ? 0 : 1;
    db.prepare('UPDATE videos SET is_featured = ? WHERE id = ?').run(newFeatured, id);

    res.json({
      success: true,
      message: newFeatured ? 'Video pinned to Featured Spotlight!' : 'Video unpinned from Featured.',
      isFeatured: Boolean(newFeatured)
    });
  } catch (err) {
    next(err);
  }
}

async function cdnConvertTelegramLink(req, res, next) {
  try {
    const { tgLink, title, category, creator, duration, thumbImg } = req.body;
    if (!tgLink || !tgLink.trim()) {
      return res.status(400).json({ success: false, message: 'Telegram post link is required.' });
    }

    const cdnUrl = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get()?.value || config.cdnStreamUrl;
    const cleanTitle = sanitizeString(title) || 'Telegram CDN Stream Video';
    const cleanTag = (sanitizeString(category) || '18+ ADULT').toUpperCase();
    const cleanCreator = sanitizeString(creator) || 'DarkPAKI VIP Exclusive';
    const cleanDuration = sanitizeString(duration) || '14:20';

    let finalStreamUrl = '';
    let finalThumb = thumbImg ? sanitizeString(thumbImg) : '';

    // Call CDN /api/generate-link
    try {
      const cdnRes = await fetch(`${cdnUrl.replace(/\/+$/, '')}/api/generate-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.cdnApiKey}`,
          'X-API-Key': config.cdnApiKey
        },
        body: JSON.stringify({
          tg_link: tgLink.trim(),
          file_name: cleanTitle + '.mp4'
        })
      });
      const cdnResult = await cdnRes.json();
      if (cdnResult && cdnResult.success && cdnResult.stream_url) {
        finalStreamUrl = cdnResult.stream_url;
        if (!finalThumb && cdnResult.thumb_url) {
          finalThumb = cdnResult.thumb_url;
        } else if (!finalThumb && cdnResult.chat_id && cdnResult.msg_id) {
          finalThumb = `${cdnUrl.replace(/\/+$/, '')}/api/thumb/${cdnResult.chat_id}?id=${cdnResult.msg_id}`;
        }
      }
    } catch (err) {
      console.warn('CDN link generation request failed, using direct parser:', err.message);
    }

    // Direct Telegram link fallback
    if (!finalStreamUrl) {
      const matchC = tgLink.match(/t\.me\/c\/(\d+)\/(\d+)/);
      if (matchC) {
        const cid = matchC[1];
        const mid = matchC[2];
        finalStreamUrl = `${cdnUrl.replace(/\/+$/, '')}/${cid}/${encodeURIComponent(cleanTitle + '.mp4')}?id=${mid}`;
        if (!finalThumb) {
          finalThumb = `${cdnUrl.replace(/\/+$/, '')}/api/thumb/${cid}?id=${mid}`;
        }
      } else {
        const matchPub = tgLink.match(/t\.me\/([^\/]+)\/(\d+)/);
        if (matchPub) {
          const cname = matchPub[1];
          const mid = matchPub[2];
          finalStreamUrl = `${cdnUrl.replace(/\/+$/, '')}/${cname}/${encodeURIComponent(cleanTitle + '.mp4')}?id=${mid}`;
          if (!finalThumb) {
            finalThumb = `${cdnUrl.replace(/\/+$/, '')}/api/thumb/${cname}?id=${mid}`;
          }
        }
      }
    }

    if (!finalStreamUrl) {
      return res.status(400).json({
        success: false,
        message: 'Could not extract streaming endpoint from Telegram link. Format should be: https://t.me/c/3904027623/42'
      });
    }

    if (!finalThumb) {
      finalThumb = 'https://placehold.co/600x400/121218/f43f5e?text=DarkPAKI+VIP';
    }

    // Persist into DarkPAKI database
    const insertVideo = db.prepare(`
      INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured)
      VALUES (?, ?, 'NEW • 2.8K views', ?, ?, ?, ?, 'Posted via Telegram CDN Converter', 0)
    `);
    const r = insertVideo.run(cleanTitle, cleanCreator, cleanDuration, finalStreamUrl, finalThumb, cleanTag);
    const newVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(r.lastInsertRowid);

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      'TELEGRAM_CDN_POSTED',
      `Admin published Telegram CDN video: "${cleanTitle}" [${cleanTag}]`,
      req.ip
    );

    res.json({
      success: true,
      message: `Successfully posted "${cleanTitle}" to DarkPAKI website!`,
      data: newVideo
    });
  } catch (err) {
    next(err);
  }
}

function getSettings(req, res, next) {
  try {
    const telegramUrl = db.prepare("SELECT value FROM settings WHERE key = 'telegram_url'").get()?.value || 'https://t.me/darkpaki_official';
    const allowInstantSkip = db.prepare("SELECT value FROM settings WHERE key = 'allow_instant_skip'").get()?.value === 'true';
    const adVideoUrl = db.prepare("SELECT value FROM settings WHERE key = 'ad_video_url'").get()?.value || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4';
    const cdnStreamUrl = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get()?.value || config.cdnStreamUrl;
    const popunderUrl = db.prepare("SELECT value FROM settings WHERE key = 'popunder_url'").get()?.value || '';
    const bannerAdHtml = db.prepare("SELECT value FROM settings WHERE key = 'banner_ad_html'").get()?.value || '';
    const monetagMetaTag = db.prepare("SELECT value FROM settings WHERE key = 'monetag_meta_tag'").get()?.value || '';
    const safeModeEnabled = db.prepare("SELECT value FROM settings WHERE key = 'safe_mode_enabled'").get()?.value !== 'false';
    const googleClientId = db.prepare("SELECT value FROM settings WHERE key = 'google_client_id'").get()?.value || '';
    const turnstileSiteKey = db.prepare("SELECT value FROM settings WHERE key = 'turnstile_site_key'").get()?.value || config.turnstileSiteKey || '0x4AAAAAAF_8PdMI9qhkYmZq';
    const turnstileSecretKey = db.prepare("SELECT value FROM settings WHERE key = 'turnstile_secret_key'").get()?.value || config.turnstileSecretKey || '0x4AAAAAAF_8PYj1uQzH7hJwMXSu-6GjWds';
    const recaptchaSiteKey = db.prepare("SELECT value FROM settings WHERE key = 'recaptcha_site_key'").get()?.value || config.recaptchaSiteKey || '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK';
    const recaptchaSecretKey = db.prepare("SELECT value FROM settings WHERE key = 'recaptcha_secret_key'").get()?.value || config.recaptchaSecretKey || '6LeYcCAuAAAAANftpMAN79ldhJuXZOp6_tqzZ85t';
    const adminAccessKey = db.prepare("SELECT value FROM settings WHERE key = 'admin_access_key'").get()?.value || config.adminAccessKey || 'naved_master_786';

    res.json({
      success: true,
      data: {
        telegramUrl,
        allowInstantSkip,
        adVideoUrl,
        cdnStreamUrl,
        popunderUrl,
        bannerAdHtml,
        monetagMetaTag,
        safeModeEnabled,
        googleClientId,
        turnstileSiteKey,
        turnstileSecretKey,
        recaptchaSiteKey,
        recaptchaSecretKey,
        adminAccessKey,
        cdnApiKey: config.cdnApiKey
      }
    });
  } catch (err) {
    next(err);
  }
}

function updateSettings(req, res, next) {
  try {
    const { telegramUrl, allowInstantSkip, adVideoUrl, cdnStreamUrl, popunderUrl, bannerAdHtml, monetagMetaTag, safeModeEnabled, turnstileSiteKey, turnstileSecretKey, recaptchaSiteKey, recaptchaSecretKey, googleClientId, newPin, adminAccessKey } = req.body;

    if (adminAccessKey && adminAccessKey.toString().trim()) {
      const cleanKey = sanitizeString(adminAccessKey).trim();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_access_key', ?)").run(cleanKey);
      db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
        'ADMIN_ACCESS_KEY_CHANGED',
        `Owner updated stealth access key`,
        req.ip
      );
    }

    if (recaptchaSiteKey !== undefined) {
      const cleanKey = sanitizeString(recaptchaSiteKey);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recaptcha_site_key', ?)").run(cleanKey);
    }

    if (recaptchaSecretKey !== undefined) {
      const cleanSecret = sanitizeString(recaptchaSecretKey);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('recaptcha_secret_key', ?)").run(cleanSecret);
    }

    if (googleClientId !== undefined) {
      const cleanGId = sanitizeString(googleClientId);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_client_id', ?)").run(cleanGId);
    }

    if (turnstileSiteKey !== undefined) {
      const cleanKey = sanitizeString(turnstileSiteKey);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('turnstile_site_key', ?)").run(cleanKey);
    }

    if (turnstileSecretKey !== undefined) {
      const cleanSecret = sanitizeString(turnstileSecretKey);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('turnstile_secret_key', ?)").run(cleanSecret);
    }

    if (telegramUrl !== undefined) {
      const cleanUrl = sanitizeString(telegramUrl);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_url', ?)").run(cleanUrl);
    }

    if (allowInstantSkip !== undefined) {
      const val = allowInstantSkip ? 'true' : 'false';
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_instant_skip', ?)").run(val);
    }

    if (adVideoUrl !== undefined) {
      const cleanAdUrl = sanitizeString(adVideoUrl);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('ad_video_url', ?)").run(cleanAdUrl);
    }

    if (cdnStreamUrl !== undefined) {
      let cleanCdn = sanitizeString(cdnStreamUrl).replace(/\/+$/, '');
      if (!cleanCdn || cleanCdn.includes('anizon.watch') || cleanCdn.includes('localhost:5000')) {
        cleanCdn = 'https://darkpaki-stream.onrender.com';
      }
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('cdn_stream_url', ?)").run(cleanCdn);
    }

    if (popunderUrl !== undefined) {
      const cleanPopunder = sanitizeString(popunderUrl);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('popunder_url', ?)").run(cleanPopunder);
    }

    if (bannerAdHtml !== undefined) {
      // Store banner ad code (HTML / iframe / script tags directly from ad network)
      const cleanBanner = bannerAdHtml ? bannerAdHtml.toString().trim() : '';
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('banner_ad_html', ?)").run(cleanBanner);
    }

    if (monetagMetaTag !== undefined) {
      let val = monetagMetaTag.toString().trim();
      const match = val.match(/content=(?:&quot;|["'])(.*?)(?:&quot;|["'])/i);
      const cleanMeta = match ? match[1] : val.replace(/<[^>]+>/g, '').trim();
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('monetag_meta_tag', ?)").run(cleanMeta);
    }

    if (safeModeEnabled !== undefined) {
      const val = safeModeEnabled ? 'true' : 'false';
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('safe_mode_enabled', ?)").run(val);
    }

    if (newPin && newPin.toString().trim()) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(newPin.toString().trim(), salt);
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('admin_pin_hash', ?)").run(hash);
      db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
        'ADMIN_PIN_CHANGED',
        `Admin changed master security PIN`,
        req.ip
      );
    }

    res.json({
      success: true,
      message: 'Platform settings updated successfully!'
    });
  } catch (err) {
    next(err);
  }
}

function resetDeviceLock(req, res, next) {
  try {
    const { deviceId } = req.body;
    if (deviceId) {
      db.prepare("DELETE FROM users WHERE device_id = ?").run(deviceId);
      db.prepare("DELETE FROM security_logs WHERE device_id = ?").run(deviceId);
    }

    res.json({
      success: true,
      message: `Device lock and session reset for ${deviceId || 'selected device'}!`
    });
  } catch (err) {
    next(err);
  }
}

// Direct Telegram Cloud CDN Streaming Upload Bridge
// Pipes file stream straight to Telegram-Stream CDN (Render or Local) with Zero CORS issues
function cdnDirectUpload(req, res, next) {
  try {
    const cdnUrl = getEffectiveCdnUrl();

    const parsedUrl = new URL(`${cdnUrl}/api/upload`);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? require('https') : require('http');

    const headers = { ...req.headers };
    headers['host'] = parsedUrl.host;
    headers['x-api-key'] = config.cdnApiKey;
    headers['authorization'] = `Bearer ${config.cdnApiKey}`;
    delete headers['cookie'];
    delete headers['origin'];
    delete headers['referer'];
    delete headers['connection'];
    delete headers['accept-encoding'];

    const proxyReq = client.request({
      method: 'POST',
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname,
      headers: headers,
      timeout: 180000
    }, (proxyRes) => {
      let stream = proxyRes;
      const encoding = proxyRes.headers['content-encoding'];
      if (encoding === 'gzip') stream = proxyRes.pipe(zlib.createGunzip());
      else if (encoding === 'br') stream = proxyRes.pipe(zlib.createBrotliDecompress());
      else if (encoding === 'deflate') stream = proxyRes.pipe(zlib.createInflate());

      let rawData = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => { rawData += chunk; });
      stream.on('end', () => {
        try {
          if (proxyRes.statusCode < 200 || proxyRes.statusCode >= 300) {
            return res.status(proxyRes.statusCode).json({
              success: false,
              message: `CDN Upload failed with status ${proxyRes.statusCode}`,
              raw: rawData
            });
          }
          const cdnData = JSON.parse(rawData);
          if (!cdnData.stream_url) {
            return res.status(500).json({ success: false, message: 'CDN did not return a valid stream URL', data: cdnData });
          }

          // Video metadata from query params or defaults
          const title = sanitizeString(req.query.title) || cdnData.file_name || 'Telegram Stream Video';
          const tag = (sanitizeString(req.query.category) || '18+ ADULT').toUpperCase();
          const creator = sanitizeString(req.query.creator) || 'DarkPAKI VIP Exclusive';
          const duration = sanitizeString(req.query.duration) || cdnData.file_size || '14:20';
          let thumb = req.query.thumb ? sanitizeString(req.query.thumb) : cdnData.thumb_url;
          if (!thumb && cdnData.chat_id && cdnData.msg_id) {
            thumb = `${cdnUrl}/api/thumb/${cdnData.chat_id}?id=${cdnData.msg_id}`;
          }
          if (!thumb) {
            thumb = 'https://placehold.co/600x400/121218/f43f5e?text=18%2B+DarkPAKI';
          }
          const isFeatured = req.query.featured === '1' ? 1 : 0;
          const requestedBy = sanitizeString(req.query.requestedBy) || 'Demanded by VIP Users';

          const insertVideo = db.prepare(`
            INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured)
            VALUES (?, ?, 'NEW • 1.5K views', ?, ?, ?, ?, ?, ?)
          `);
          const result = insertVideo.run(title, creator, duration, cdnData.stream_url, thumb, tag, requestedBy, isFeatured);
          const newVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(result.lastInsertRowid);

          db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
            'VIDEO_UPLOADED_DIRECT_CDN',
            `Admin uploaded to Telegram Cloud & published: "${title}"`,
            req.ip
          );

          res.json({
            success: true,
            message: `Video uploaded to Telegram Cloud & published successfully!`,
            cdn: cdnData,
            data: newVideo
          });
        } catch (parseErr) {
          return res.status(500).json({ success: false, message: 'Failed to process CDN response', error: parseErr.message, raw: rawData });
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('[DarkPAKI Proxy Upload Error]', err);
      res.status(502).json({ success: false, message: 'Failed to connect to Telegram Stream CDN', error: err.message });
    });

    // Pipe the request body directly to CDN
    req.pipe(proxyReq);

  } catch (err) {
    next(err);
  }
}

// =========================================================================
// USER SUBMISSION MODERATION & REVIEW QUEUE
// =========================================================================

function getPendingVideos(req, res, next) {
  try {
    const pending = db.prepare("SELECT * FROM videos WHERE status = 'PENDING' ORDER BY id DESC").all();
    res.json({
      success: true,
      data: pending
    });
  } catch (err) {
    next(err);
  }
}

function approveVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    db.prepare("UPDATE videos SET status = 'APPROVED' WHERE id = ?").run(id);

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      'VIDEO_APPROVED_BY_ADMIN',
      `Admin approved video #${id}: "${video.title}" by ${video.owner_name || video.creator}`,
      req.ip
    );

    res.json({
      success: true,
      message: `Video "${video.title}" approved and published live to DarkPAKI website!`
    });
  } catch (err) {
    next(err);
  }
}

function rejectVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const cleanReason = sanitizeString(reason) || 'Violated community guidelines or low quality';
    db.prepare("UPDATE videos SET status = 'REJECTED', rejection_reason = ? WHERE id = ?").run(cleanReason, id);

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      'VIDEO_REJECTED_BY_ADMIN',
      `Admin rejected video #${id}: "${video.title}". Reason: ${cleanReason}`,
      req.ip
    );

    res.json({
      success: true,
      message: `Video "${video.title}" has been rejected.`
    });
  } catch (err) {
    next(err);
  }
}

// =========================================================================
// CREATOR MONETIZATION & AUDIT SYSTEM
// =========================================================================

function getMonetizationApplications(req, res, next) {
  try {
    const apps = db.prepare('SELECT * FROM monetization_applications ORDER BY id DESC').all();

    const enriched = apps.map(app => {
      const user = app.user_id ? db.prepare('SELECT id, name, gmail, phone, device_id, followers_count, is_monetized, created_at FROM users WHERE id = ?').get(app.user_id) : null;
      const creatorName = app.creator_name || app.channel_name;

      // Real followers check: count distinct follower device IDs to catch spam / fake accounts
      const followerDevices = db.prepare('SELECT follower_device_id, COUNT(*) as cnt FROM follows WHERE creator_name = ? COLLATE NOCASE GROUP BY follower_device_id').all(creatorName);
      const distinctFollowers = followerDevices.length;
      const isSuspicious = (app.followers_count > 0 && distinctFollowers < app.followers_count * 0.5);

      // Best video check
      const bestVideo = db.prepare('SELECT title, views_count, src, created_at FROM videos WHERE (creator = ? COLLATE NOCASE OR owner_name = ? COLLATE NOCASE) ORDER BY views_count DESC LIMIT 1').get(creatorName, creatorName);

      return {
        ...app,
        user: user || null,
        real_gmail: user?.gmail || app.email,
        real_name: user?.real_name || user?.name || app.creator_name,
        distinct_follower_devices: distinctFollowers,
        is_fake_followers_flagged: isSuspicious,
        best_video: bestVideo || null,
        is_currently_monetized: Boolean(user?.is_monetized)
      };
    });

    res.json({
      success: true,
      data: enriched
    });
  } catch (err) {
    next(err);
  }
}

function reviewMonetizationApplication(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { action, notes } = req.body; // 'APPROVE' or 'REJECT'
    const app = db.prepare('SELECT * FROM monetization_applications WHERE id = ?').get(id);
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }

    const cleanNotes = sanitizeString(notes) || (action === 'APPROVE' ? 'Approved by Admin' : 'Rejected by Admin');
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const isMonetizedVal = action === 'APPROVE' ? 1 : 0;

    db.prepare(`
      UPDATE monetization_applications 
      SET status = ?, admin_notes = ?, reviewed_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(newStatus, cleanNotes, id);

    if (app.user_id) {
      db.prepare('UPDATE users SET is_monetized = ?, monetization_status = ? WHERE id = ?')
        .run(isMonetizedVal, newStatus, app.user_id);
    }
    if (app.creator_name) {
      db.prepare('UPDATE users SET is_monetized = ?, monetization_status = ? WHERE name = ? COLLATE NOCASE')
        .run(isMonetizedVal, newStatus, app.creator_name);
    }

    db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
      action === 'APPROVE' ? 'CREATOR_MONETIZATION_APPROVED' : 'CREATOR_MONETIZATION_REJECTED',
      `Admin ${action.toLowerCase()}d Creator Monetization for "${app.creator_name}" (${app.email})`,
      req.ip
    );

    res.json({
      success: true,
      message: `Creator Monetization for "${app.creator_name}" has been ${action === 'APPROVE' ? 'APPROVED (Monetization ON)' : 'REJECTED'}.`
    });
  } catch (err) {
    next(err);
  }
}

function toggleCreatorMonetization(req, res, next) {
  try {
    const { creatorName, userId, enabled } = req.body;
    const isMonetized = enabled ? 1 : 0;

    if (userId) {
      db.prepare('UPDATE users SET is_monetized = ? WHERE id = ?').run(isMonetized, userId);
    }
    if (creatorName) {
      db.prepare('UPDATE users SET is_monetized = ? WHERE name = ? COLLATE NOCASE').run(isMonetized, creatorName);
    }

    res.json({
      success: true,
      isMonetized: Boolean(isMonetized),
      message: `Creator Monetization is now ${isMonetized ? 'ENABLED (ON)' : 'DISABLED (OFF)'} for ${creatorName || 'User #' + userId}!`
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================================
// USDT PAYOUTS / TRUST WALLET MANAGEMENT
// ============================================================================
function getAdminWithdrawals(req, res, next) {
  try {
    const withdrawals = db.prepare(`
      SELECT w.id, w.user_id, w.upi_id as wallet_address, w.amount, w.device_id, w.status,
             w.tx_hash, w.admin_notes, w.created_at, w.processed_at,
             u.name as user_name, u.gmail as user_gmail, u.balance as user_balance
      FROM withdrawals w
      LEFT JOIN users u ON w.user_id = u.id
      ORDER BY w.id DESC
    `).all();

    const processedWithdrawals = withdrawals.map(w => {
      let payoutType = 'Crypto USDT';
      let isBinancePay = false;
      if (/^\d{6,12}$/.test(w.wallet_address)) {
        payoutType = 'Binance Pay ID / UID';
        isBinancePay = true;
      } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.wallet_address)) {
        payoutType = 'Binance Email';
        isBinancePay = true;
      }
      return {
        ...w,
        payoutType,
        isBinancePay
      };
    });

    const pendingCount = db.prepare("SELECT COUNT(*) as count FROM withdrawals WHERE status IN ('PENDING', 'QUEUED')").get()?.count || 0;
    const totalPaid = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'COMPLETED'").get()?.total || 0;

    res.json({
      success: true,
      data: {
        withdrawals: processedWithdrawals,
        pendingCount,
        totalPaid
      }
    });
  } catch (err) {
    next(err);
  }
}

function completeWithdrawal(req, res, next) {
  try {
    const { id } = req.params;
    const { txHash, notes } = req.body || {};

    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    db.prepare(`
      UPDATE withdrawals
      SET status = 'COMPLETED',
          tx_hash = ?,
          admin_notes = ?,
          processed_at = datetime('now')
      WHERE id = ?
    `).run(
      txHash ? sanitizeString(txHash) : '',
      notes ? sanitizeString(notes) : 'Paid via Trust Wallet USDT',
      id
    );

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'WITHDRAWAL_PAID_TRUST_WALLET',
      `Admin completed withdrawal #${id} ($${withdrawal.amount} USDT to ${withdrawal.upi_id}). TXID: ${txHash || 'N/A'}`,
      req.ip,
      'ADMIN'
    );

    res.json({
      success: true,
      message: `Withdrawal #${id} ($${withdrawal.amount} USDT) marked as COMPLETED (Paid via Trust Wallet)!`
    });
  } catch (err) {
    next(err);
  }
}

function rejectWithdrawal(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const withdrawal = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    if (withdrawal.status === 'REJECTED') {
      return res.status(400).json({ success: false, message: 'This withdrawal has already been rejected.' });
    }

    // Atomic transaction: Refund money back to user balance and update status
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(withdrawal.amount, withdrawal.user_id);
      db.prepare(`
        UPDATE withdrawals
        SET status = 'REJECTED',
            admin_notes = ?,
            processed_at = datetime('now')
        WHERE id = ?
      `).run(
        reason ? sanitizeString(reason) : 'Rejected by admin: Invalid USDT wallet address or duplicate',
        id
      );
      db.exec('COMMIT;');
    } catch (txnErr) {
      db.exec('ROLLBACK;');
      throw txnErr;
    }

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'WITHDRAWAL_REJECTED_REFUNDED',
      `Admin rejected withdrawal #${id}. $${withdrawal.amount} USDT refunded to user #${withdrawal.user_id}. Reason: ${reason || 'N/A'}`,
      req.ip,
      'ADMIN'
    );

    res.json({
      success: true,
      message: `Withdrawal #${id} rejected. $${withdrawal.amount} USDT refunded to user account.`
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  loginAdmin,
  verifyAuth,
  getStats,
  getAdminVideos,
  createVideo,
  updateVideo,
  deleteVideo,
  toggleFeatured,
  cdnConvertTelegramLink,
  cdnDirectUpload,
  getSettings,
  updateSettings,
  resetDeviceLock,
  getPendingVideos,
  approveVideo,
  rejectVideo,
  getMonetizationApplications,
  reviewMonetizationApplication,
  toggleCreatorMonetization,
  getAdminWithdrawals,
  completeWithdrawal,
  rejectWithdrawal
};
