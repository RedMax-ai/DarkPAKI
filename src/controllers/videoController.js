const db = require('../db/database');
const config = require('../config');
const { sanitizeString } = require('../middleware/validator');

function getVideos(req, res, next) {
  try {
    const { q, tag, shortsOnly } = req.query;
    let query = "SELECT * FROM videos WHERE (status = 'APPROVED' OR status IS NULL)";
    const params = [];

    if (shortsOnly === 'true' || shortsOnly === '1') {
      query += " AND (is_short = 1 OR tag LIKE '%SHORT%')";
    }

    if (tag && tag !== 'ALL' && tag !== 'SHORTS') {
      query += ' AND tag = ?';
      params.push(tag);
    }

    if (q && q.trim()) {
      const sanitizedQ = `%${q.trim()}%`;
      query += ' AND (title LIKE ? OR creator LIKE ? OR tag LIKE ? OR requested_by LIKE ?)';
      params.push(sanitizedQ, sanitizedQ, sanitizedQ, sanitizedQ);
    }

    query += ' ORDER BY id DESC';

    const videos = db.prepare(query).all(...params);

    // Enrich videos with creator monetization and followers count
    const enrichedVideos = videos.map(v => {
      const creatorName = v.creator || v.owner_name || 'DarkPAKI Creator';
      const user = db.prepare('SELECT is_monetized, followers_count FROM users WHERE name = ? COLLATE NOCASE LIMIT 1').get(creatorName);
      const followCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName)?.count || 0;

      return {
        ...v,
        is_monetized: Boolean(user?.is_monetized),
        followers_count: Math.max(user?.followers_count || 0, followCount)
      };
    });

    res.json({
      success: true,
      data: enrichedVideos
    });
  } catch (err) {
    next(err);
  }
}

function getVideoById(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const creatorName = video.creator || video.owner_name || 'DarkPAKI Creator';
    const user = db.prepare('SELECT is_monetized, followers_count FROM users WHERE name = ? COLLATE NOCASE LIMIT 1').get(creatorName);
    const followCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName)?.count || 0;

    res.json({
      success: true,
      data: {
        ...video,
        is_monetized: Boolean(user?.is_monetized),
        followers_count: Math.max(user?.followers_count || 0, followCount)
      }
    });
  } catch (err) {
    next(err);
  }
}

// Increment Video View Count
function incrementView(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT id, views_count FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const newCount = (video.views_count || 0) + 1;
    let formattedViews = `${newCount} views`;
    if (newCount >= 1000000) {
      formattedViews = `${(newCount / 1000000).toFixed(1)}M views`;
    } else if (newCount >= 1000) {
      formattedViews = `${(newCount / 1000).toFixed(1)}K views`;
    }

    db.prepare('UPDATE videos SET views_count = ?, views = ? WHERE id = ?').run(newCount, formattedViews, id);

    res.json({
      success: true,
      data: {
        id,
        viewsCount: newCount,
        views: formattedViews
      }
    });
  } catch (err) {
    next(err);
  }
}

// Public User Video Upload (Shorts / Reels style with Admin Review Queue)
function submitUserVideo(req, res, next) {
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
              message: `Upload failed (Status ${proxyRes.statusCode})`,
              raw: rawData
            });
          }
          const cdnData = JSON.parse(rawData);
          if (!cdnData.stream_url) {
            return res.status(500).json({ success: false, message: 'CDN did not return a valid stream URL', data: cdnData });
          }

          const title = sanitizeString(req.query.title) || cdnData.file_name || 'Community Video';
          const ownerName = sanitizeString(req.query.ownerName) || 'Community Creator';
          const ownerEmail = sanitizeString(req.query.ownerEmail) || 'user@darkpaki.com';
          const category = (sanitizeString(req.query.category) || 'SHORTS').toUpperCase();
          const duration = sanitizeString(req.query.duration) || cdnData.file_size || '0:45';
          const isShort = (req.query.isShort === '1' || category.includes('SHORT')) ? 1 : 0;

          let thumb = req.query.thumb ? sanitizeString(req.query.thumb) : cdnData.thumb_url;
          if (!thumb && cdnData.chat_id && cdnData.msg_id) {
            thumb = `${cdnUrl}/api/thumb/${cdnData.chat_id}?id=${cdnData.msg_id}`;
          }
          if (!thumb) {
            thumb = 'https://placehold.co/600x400/121218/f43f5e?text=User+Video';
          }

          // Insert with status = 'PENDING' for Admin Review!
          const insertVideo = db.prepare(`
            INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured, status, owner_name, owner_email, views_count, is_short)
            VALUES (?, ?, '0 views', ?, ?, ?, ?, 'Submitted by Community', 0, 'PENDING', ?, ?, 0, ?)
          `);
          const result = insertVideo.run(title, ownerName, duration, cdnData.stream_url, thumb, category, ownerName, ownerEmail, isShort);
          const newVideo = db.prepare('SELECT * FROM videos WHERE id = ?').get(result.lastInsertRowid);

          db.prepare('INSERT INTO security_logs (event_type, details, ip) VALUES (?, ?, ?)').run(
            'USER_VIDEO_SUBMITTED_FOR_REVIEW',
            `User "${ownerName}" (${ownerEmail}) submitted video: "${title}" [Pending Admin Approval]`,
            req.ip
          );

          res.json({
            success: true,
            message: '🎉 Video uploaded successfully! It is now in the Admin Review Queue and will go live once verified by DarkPAKI Admin.',
            status: 'PENDING',
            data: newVideo
          });
        } catch (parseErr) {
          return res.status(500).json({ success: false, message: 'Failed to process CDN response', error: parseErr.message, raw: rawData });
        }
      });
    });

    proxyReq.on('error', (err) => {
      console.error('[User Video Upload Proxy Error]', err);
      res.status(502).json({ success: false, message: 'Failed to stream video to CDN', error: err.message });
    });

    req.pipe(proxyReq);

  } catch (err) {
    next(err);
  }
}

function getAdConfig(req, res, next) {
  try {
    const adVideoSetting = db.prepare("SELECT value FROM settings WHERE key = 'ad_video_url'").get();
    const instantSkipSetting = db.prepare("SELECT value FROM settings WHERE key = 'allow_instant_skip'").get();
    const telegramSetting = db.prepare("SELECT value FROM settings WHERE key = 'telegram_url'").get();
    const popunderSetting = db.prepare("SELECT value FROM settings WHERE key = 'popunder_url'").get();
    const bannerAdSetting = db.prepare("SELECT value FROM settings WHERE key = 'banner_ad_html'").get();
    const monetagMetaSetting = db.prepare("SELECT value FROM settings WHERE key = 'monetag_meta_tag'").get();
    const safeModeSetting = db.prepare("SELECT value FROM settings WHERE key = 'safe_mode_enabled'").get();

    res.json({
      success: true,
      data: {
        adVideoUrl: adVideoSetting ? adVideoSetting.value : 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4',
        allowInstantSkip: instantSkipSetting ? instantSkipSetting.value === 'true' : false,
        telegramUrl: telegramSetting ? telegramSetting.value : 'https://t.me/darkpaki_official',
        popunderUrl: popunderSetting ? popunderSetting.value : '',
        bannerAdHtml: bannerAdSetting ? bannerAdSetting.value : '',
        monetagMetaTag: monetagMetaSetting ? monetagMetaSetting.value : '',
        safeModeEnabled: safeModeSetting ? safeModeSetting.value !== 'false' : true
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVideos,
  getVideoById,
  incrementView,
  submitUserVideo,
  getAdConfig
};
