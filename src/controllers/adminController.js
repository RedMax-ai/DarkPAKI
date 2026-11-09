const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString } = require('../middleware/validator');

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
    } else {
      isMatch = (pin.toString() === config.adminPin);
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
    const totalContacts = db.prepare('SELECT COUNT(*) as count FROM user_contacts').get().count;
    const blockedAttempts = db.prepare(`
      SELECT COUNT(*) as count FROM security_logs 
      WHERE event_type IN ('DEVICE_LOCK_VIOLATION', 'FAILED_ADMIN_LOGIN', 'FAILED_CAPTCHA', 'DEVICE_MISMATCH')
    `).get().count;

    const recentVideos = db.prepare('SELECT id, title, creator, tag, duration, src, thumb_img, is_featured, created_at FROM videos ORDER BY id DESC LIMIT 10').all();
    const users = db.prepare('SELECT id, name, gmail, phone, device_id, balance, referrals, ads_watched, created_at FROM users ORDER BY id DESC LIMIT 50').all();
    const logs = db.prepare('SELECT * FROM security_logs ORDER BY id DESC LIMIT 25').all();
    
    const telegramUrl = db.prepare("SELECT value FROM settings WHERE key = 'telegram_url'").get()?.value || 'https://t.me/darkpaki_official';
    const allowInstantSkip = db.prepare("SELECT value FROM settings WHERE key = 'allow_instant_skip'").get()?.value === 'true';
    const cdnStreamUrl = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get()?.value || config.cdnStreamUrl;
    const adVideoUrl = db.prepare("SELECT value FROM settings WHERE key = 'ad_video_url'").get()?.value || 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4';
    const popunderUrl = db.prepare("SELECT value FROM settings WHERE key = 'popunder_url'").get()?.value || '';
    const bannerAdHtml = db.prepare("SELECT value FROM settings WHERE key = 'banner_ad_html'").get()?.value || '';
    const monetagMetaTag = db.prepare("SELECT value FROM settings WHERE key = 'monetag_meta_tag'").get()?.value || '';
    const safeModeEnabled = db.prepare("SELECT value FROM settings WHERE key = 'safe_mode_enabled'").get()?.value !== 'false';

    res.json({
      success: true,
      data: {
        stats: {
          totalVideos,
          totalUsers,
          totalDemands,
          totalContacts,
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
        cdnApiKey: config.cdnApiKey
      }
    });
  } catch (err) {
    next(err);
  }
}

function updateSettings(req, res, next) {
  try {
    const { telegramUrl, allowInstantSkip, adVideoUrl, cdnStreamUrl, popunderUrl, bannerAdHtml, monetagMetaTag, safeModeEnabled, newPin } = req.body;

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
      const cleanCdn = sanitizeString(cdnStreamUrl).replace(/\/+$/, '');
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
    const cdnSetting = db.prepare("SELECT value FROM settings WHERE key = 'cdn_stream_url'").get();
    const cdnUrl = (cdnSetting?.value || config.cdnStreamUrl || 'https://darkpaki-stream.onrender.com').trim().replace(/\/+$/, '');

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

    const proxyReq = client.request({
      method: 'POST',
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: headers
    }, (proxyRes) => {
      let rawData = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', chunk => { rawData += chunk; });
      proxyRes.on('end', () => {
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
  resetDeviceLock
};
