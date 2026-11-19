const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString } = require('../middleware/validator');
const aiModeration = require('../services/aiModerationService');

// Self-healing CDN URL resolver (Prevents self-referencing loops & 404s)
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

    // Enrich videos with creator monetization, followers count, and video earnings
    const enrichedVideos = videos.map(v => {
      const creatorName = v.creator || v.owner_name || 'DarkPAKI Creator';
      const user = db.prepare('SELECT is_monetized, followers_count, avatar_url FROM users WHERE name = ? COLLATE NOCASE LIMIT 1').get(creatorName);
      const followCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName)?.count || 0;
      const viewsCount = v.views_count || 0;
      const coinsEarned = viewsCount * 25;
      const usdEarned = ((coinsEarned / 1000) * 0.11).toFixed(2);

      return {
        ...v,
        likes_count: v.likes_count || 0,
        dislikes_count: v.dislikes_count || 0,
        is_monetized: Boolean(user?.is_monetized),
        followers_count: Math.max(user?.followers_count || 0, followCount),
        creator_avatar: user?.avatar_url || null,
        earnings: {
          coins: coinsEarned,
          usd: usdEarned
        }
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
    const user = db.prepare('SELECT is_monetized, followers_count, avatar_url FROM users WHERE name = ? COLLATE NOCASE LIMIT 1').get(creatorName);
    const followCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName)?.count || 0;
    const viewsCount = video.views_count || 0;
    const coinsEarned = viewsCount * 25;
    const usdEarned = ((coinsEarned / 1000) * 0.11).toFixed(2);

    res.json({
      success: true,
      data: {
        ...video,
        likes_count: video.likes_count || 0,
        dislikes_count: video.dislikes_count || 0,
        is_monetized: Boolean(user?.is_monetized),
        followers_count: Math.max(user?.followers_count || 0, followCount),
        creator_avatar: user?.avatar_url || null,
        earnings: {
          coins: coinsEarned,
          usd: usdEarned
        }
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

    const video = db.prepare('SELECT id, views_count, creator, owner_name, user_id FROM videos WHERE id = ?').get(id);
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

    // Record authentic traffic source into video_views_log
    const allowedSources = ['trending', 'search', 'direct'];
    const rawSource = (req.body?.source || req.query?.source || 'direct').toString().toLowerCase().trim();
    const source = allowedSources.includes(rawSource) ? rawSource : 'direct';

    const creatorName = video.creator || video.owner_name || '';
    const creatorUserId = video.user_id || null;

    try {
      db.prepare(`
        INSERT INTO video_views_log (video_id, creator_name, user_id, source, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, creatorName, creatorUserId, source, req.ip || '', req.headers['user-agent'] || '');
    } catch (logErr) {
      console.warn('[Views Log Error]', logErr.message);
    }

    res.json({
      success: true,
      data: {
        id,
        viewsCount: newCount,
        views: formattedViews,
        source
      }
    });
  } catch (err) {
    next(err);
  }
}

// POST /api/videos/upload-thumbnail
function uploadThumbnail(req, res, next) {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'Base64 image data is required.' });
    }

    const match = imageBase64.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Invalid image format. Supported formats: PNG, JPEG, WebP.' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Thumbnail image exceeds 5MB limit.' });
    }

    const thumbDir = path.resolve(__dirname, '../../public/uploads/thumbnails');
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }

    const fileName = `thumb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(thumbDir, fileName), buffer);

    res.json({
      success: true,
      thumbUrl: `/public/uploads/thumbnails/${fileName}`
    });
  } catch (err) {
    next(err);
  }
}

// Public User Video Upload (Shorts / Reels style with Admin Review Queue)
function submitUserVideo(req, res, next) {
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
    delete headers['accept-encoding']; // Prevents upstream gzip/brotli compressed strings

    const proxyReq = client.request({
      method: 'POST',
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname, // Clean path to avoid huge query string proxy error
      headers: headers,
      timeout: 180000 // 3 minutes timeout
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

          let thumb = req.query.thumb ? sanitizeString(req.query.thumb) : '';
          // If thumb is base64, save safely to disk
          if (thumb && thumb.startsWith('data:image')) {
            try {
              const match = thumb.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
              if (match) {
                const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
                const thumbDir = path.resolve(__dirname, '../../public/uploads/thumbnails');
                if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
                const fileName = `thumb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
                fs.writeFileSync(path.join(thumbDir, fileName), Buffer.from(match[2], 'base64'));
                thumb = `/public/uploads/thumbnails/${fileName}`;
              }
            } catch (e) {
              thumb = '';
            }
          }

          if (!thumb && cdnData.chat_id && cdnData.msg_id) {
            thumb = `${cdnUrl}/api/thumb/${cdnData.chat_id}?id=${cdnData.msg_id}`;
          }
          if (!thumb) {
            thumb = cdnData.thumb_url || '/public/darkpaki-logo.png';
          }

          // Find creator user ID if registered
          let userId = null;
          if (ownerEmail) {
            const userMatch = db.prepare('SELECT id FROM users WHERE gmail = ? COLLATE NOCASE').get(ownerEmail);
            if (userMatch) userId = userMatch.id;
          }

          // Insert with status = 'PENDING' for Admin Review
          const insertVideo = db.prepare(`
            INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured, status, owner_name, owner_email, user_id, views_count, is_short)
            VALUES (?, ?, '0 views', ?, ?, ?, ?, 'Submitted by Community', 0, 'PENDING', ?, ?, ?, 0, ?)
          `);
          const result = insertVideo.run(title, ownerName, duration, cdnData.stream_url, thumb, category, ownerName, ownerEmail, userId, isShort);
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

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('CDN stream connection timed out'));
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

function reactToVideo(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const { reaction, deviceId } = req.body;
    if (isNaN(id) || !['like', 'dislike'].includes(reaction)) {
      return res.status(400).json({ success: false, message: 'Valid reaction (like or dislike) is required.' });
    }

    const cleanDevice = sanitizeString(deviceId) || req.user?.device_id || req.ip || 'anonymous';
    const video = db.prepare('SELECT id, likes_count, dislikes_count, views_count FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const existing = db.prepare('SELECT id, reaction FROM video_reactions WHERE video_id = ? AND device_id = ?').get(id, cleanDevice);

    let userReaction = null;
    let likes = video.likes_count || 0;
    let dislikes = video.dislikes_count || 0;

    if (existing) {
      if (existing.reaction === reaction) {
        // Toggle off
        db.prepare('DELETE FROM video_reactions WHERE id = ?').run(existing.id);
        if (reaction === 'like') likes = Math.max(0, likes - 1);
        if (reaction === 'dislike') dislikes = Math.max(0, dislikes - 1);
        userReaction = null;
      } else {
        // Switch reaction
        db.prepare('UPDATE video_reactions SET reaction = ? WHERE id = ?').run(reaction, existing.id);
        if (reaction === 'like') {
          likes += 1;
          dislikes = Math.max(0, dislikes - 1);
        } else {
          dislikes += 1;
          likes = Math.max(0, likes - 1);
        }
        userReaction = reaction;
      }
    } else {
      // New reaction
      db.prepare('INSERT INTO video_reactions (video_id, device_id, reaction) VALUES (?, ?, ?)').run(id, cleanDevice, reaction);
      if (reaction === 'like') likes += 1;
      if (reaction === 'dislike') dislikes += 1;
      userReaction = reaction;
    }

    db.prepare('UPDATE videos SET likes_count = ?, dislikes_count = ? WHERE id = ?').run(likes, dislikes, id);

    const viewsCount = video.views_count || 0;
    const coinsEarned = viewsCount * 25;
    const usdEarned = ((coinsEarned / 1000) * 0.11).toFixed(2);

    res.json({
      success: true,
      data: {
        id,
        likesCount: likes,
        dislikesCount: dislikes,
        userReaction,
        earnings: {
          coins: coinsEarned,
          usd: usdEarned
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

function getVideoReactions(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const deviceId = req.query.deviceId || req.user?.device_id || req.ip || 'anonymous';
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT id, likes_count, dislikes_count, views_count FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const existing = db.prepare('SELECT reaction FROM video_reactions WHERE video_id = ? AND device_id = ?').get(id, sanitizeString(deviceId));
    const viewsCount = video.views_count || 0;
    const coinsEarned = viewsCount * 25;
    const usdEarned = ((coinsEarned / 1000) * 0.11).toFixed(2);

    res.json({
      success: true,
      data: {
        id,
        likesCount: video.likes_count || 0,
        dislikesCount: video.dislikes_count || 0,
        userReaction: existing ? existing.reaction : null,
        earnings: {
          coins: coinsEarned,
          usd: usdEarned
        }
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
  uploadThumbnail,
  submitUserVideo,
  getAdConfig,
  reactToVideo,
  getVideoReactions
};
