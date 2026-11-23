const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../db/database');
const config = require('../config');
const { sanitizeString } = require('../middleware/validator');
const aiModeration = require('../services/aiModerationService');
const vastService = require('../services/vastService');

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

// Calculate Creator Earnings: 100 Coins per 1,000 Views (0.10 Coins per view)
// Conversion: 1,000 Coins = $0.11 USD -> 100 Coins = $0.011 USD
function calculateCreatorEarnings(viewsCount) {
  const count = Math.max(0, parseInt(viewsCount, 10) || 0);
  const coinsEarned = Math.floor((count / 1000) * 100);
  const usdEarned = ((coinsEarned / 1000) * 0.11).toFixed(2);
  return { coins: coinsEarned, usd: usdEarned };
}

function getVideos(req, res, next) {
  try {
    const { q, tag, folder, folderId, shortsOnly } = req.query;
    let query = "SELECT * FROM videos WHERE (status = 'APPROVED' OR status IS NULL)";
    const params = [];

    if (shortsOnly === 'true' || shortsOnly === '1' || tag === 'SHORTS') {
      query += " AND (is_short = 1 OR tag LIKE '%SHORT%')";
    } else if (tag && tag !== 'ALL') {
      query += ' AND (tag = ? COLLATE NOCASE OR tags LIKE ? COLLATE NOCASE)';
      params.push(tag, `%${tag}%`);
    }

    if (folderId) {
      query += ' AND folder_id = ?';
      params.push(parseInt(folderId, 10));
    } else if (folder && folder !== 'ALL') {
      query += ' AND (folder_name = ? COLLATE NOCASE OR folder_id = (SELECT id FROM folders WHERE slug = ? OR name = ? COLLATE NOCASE LIMIT 1))';
      params.push(folder, folder, folder);
    }

    if (q && q.trim()) {
      const sanitizedQ = `%${q.trim()}%`;
      query += ' AND (title LIKE ? OR creator LIKE ? OR tag LIKE ? OR tags LIKE ? OR description LIKE ? OR requested_by LIKE ? OR folder_name LIKE ?)';
      params.push(sanitizedQ, sanitizedQ, sanitizedQ, sanitizedQ, sanitizedQ, sanitizedQ, sanitizedQ);
    }

    query += ' ORDER BY id DESC';

    const videos = db.prepare(query).all(...params);

    // Enrich videos with creator monetization, followers count, and video earnings
    const enrichedVideos = videos.map(v => {
      const creatorName = v.creator || v.owner_name || 'DarkPAKI Creator';
      const user = db.prepare('SELECT is_monetized, followers_count, avatar_url FROM users WHERE name = ? COLLATE NOCASE LIMIT 1').get(creatorName);
      const followCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName)?.count || 0;
      const viewsCount = v.views_count || 0;
      const earnings = calculateCreatorEarnings(viewsCount);

      return {
        ...v,
        likes_count: v.likes_count || 0,
        dislikes_count: v.dislikes_count || 0,
        is_monetized: Boolean(user?.is_monetized),
        followers_count: Math.max(user?.followers_count || 0, followCount),
        creator_avatar: user?.avatar_url || null,
        earnings
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
    const earnings = calculateCreatorEarnings(viewsCount);

    res.json({
      success: true,
      data: {
        ...video,
        likes_count: video.likes_count || 0,
        dislikes_count: video.dislikes_count || 0,
        is_monetized: Boolean(user?.is_monetized),
        followers_count: Math.max(user?.followers_count || 0, followCount),
        creator_avatar: user?.avatar_url || null,
        earnings
      }
    });
  } catch (err) {
    next(err);
  }
}

// Increment Video View Count with Strict 24h Deduplication & Creator Self-View Filter
function incrementView(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid video ID.' });
    }

    const video = db.prepare('SELECT id, views_count, creator, owner_name, owner_email, user_id FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const clientIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.socket?.remoteAddress || '').trim();
    const rawDeviceId = (req.body?.deviceId || req.query?.deviceId || '').toString().trim();
    const cleanDevice = sanitizeString(rawDeviceId);
    const authUser = req.user;

    // 1. Creator self-view check: Creator watching their own video does NOT count as a view
    const creatorName = (video.creator || video.owner_name || '').toLowerCase().trim();
    const creatorEmail = (video.owner_email || '').toLowerCase().trim();
    if (authUser) {
      const viewerName = (authUser.name || '').toLowerCase().trim();
      const viewerEmail = (authUser.gmail || authUser.email || '').toLowerCase().trim();
      if (
        (creatorName && viewerName && creatorName === viewerName) ||
        (creatorEmail && viewerEmail && creatorEmail === viewerEmail) ||
        (video.user_id && authUser.id === video.user_id)
      ) {
        return res.json({
          success: true,
          deduplicated: true,
          reason: 'creator_self_view',
          data: {
            id,
            viewsCount: video.views_count || 0,
            views: `${video.views_count || 0} views`
          }
        });
      }
    }

    // 2. Strict 24-hour rate limiting / deduplication per IP and per deviceId
    let existingView = null;
    if (cleanDevice && clientIp) {
      existingView = db.prepare(`
        SELECT id FROM video_views_log 
        WHERE video_id = ? AND (device_id = ? OR ip = ?) AND created_at > datetime('now', '-24 hours')
        LIMIT 1
      `).get(id, cleanDevice, clientIp);
    } else if (cleanDevice) {
      existingView = db.prepare(`
        SELECT id FROM video_views_log 
        WHERE video_id = ? AND device_id = ? AND created_at > datetime('now', '-24 hours')
        LIMIT 1
      `).get(id, cleanDevice);
    } else if (clientIp) {
      existingView = db.prepare(`
        SELECT id FROM video_views_log 
        WHERE video_id = ? AND ip = ? AND created_at > datetime('now', '-24 hours')
        LIMIT 1
      `).get(id, clientIp);
    }

    if (existingView) {
      return res.json({
        success: true,
        deduplicated: true,
        reason: 'rate_limited_24h',
        data: {
          id,
          viewsCount: video.views_count || 0,
          views: `${video.views_count || 0} views`
        }
      });
    }

    // Authentic view: increment views count
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

    const creatorUserId = video.user_id || null;

    try {
      db.prepare(`
        INSERT INTO video_views_log (video_id, creator_name, user_id, source, ip, user_agent, device_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, video.creator || video.owner_name || '', creatorUserId, source, clientIp, req.headers['user-agent'] || '', cleanDevice || null);
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

          const title = sanitizeString(req.query.title || req.body?.title) || cdnData.file_name || 'Community Video';
          const ownerName = sanitizeString(req.query.ownerName || req.body?.ownerName) || 'Community Creator';
          const ownerEmail = sanitizeString(req.query.ownerEmail || req.body?.ownerEmail) || 'user@darkpaki.com';
          const category = (sanitizeString(req.query.category || req.body?.category) || 'SHORTS').toUpperCase();
          const duration = sanitizeString(req.query.duration || req.body?.duration) || cdnData.file_size || '0:45';
          const isShort = (req.query.isShort === '1' || category.includes('SHORT')) ? 1 : 0;
          const description = sanitizeString(req.query.description || req.body?.description) || '';
          const tags = sanitizeString(req.query.tags || req.body?.tags) || '';

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
            INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured, status, owner_name, owner_email, user_id, views_count, is_short, description, tags)
            VALUES (?, ?, '0 views', ?, ?, ?, ?, 'Submitted by Community', 0, 'PENDING', ?, ?, ?, 0, ?, ?, ?)
          `);
          const result = insertVideo.run(title, ownerName, duration, cdnData.stream_url, thumb, category, ownerName, ownerEmail, userId, isShort, description, tags);
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
    const vastTagSetting = db.prepare("SELECT value FROM settings WHERE key = 'vast_tag_url'").get();
    const instantSkipSetting = db.prepare("SELECT value FROM settings WHERE key = 'allow_instant_skip'").get();
    const telegramSetting = db.prepare("SELECT value FROM settings WHERE key = 'telegram_url'").get();
    const popunderSetting = db.prepare("SELECT value FROM settings WHERE key = 'popunder_url'").get();
    const bannerAdSetting = db.prepare("SELECT value FROM settings WHERE key = 'banner_ad_html'").get();
    const monetagMetaSetting = db.prepare("SELECT value FROM settings WHERE key = 'monetag_meta_tag'").get();
    const safeModeSetting = db.prepare("SELECT value FROM settings WHERE key = 'safe_mode_enabled'").get();
    const adsensePubSetting = db.prepare("SELECT value FROM settings WHERE key = 'adsense_pub_id'").get();
    const adsenseHeadSetting = db.prepare("SELECT value FROM settings WHERE key = 'adsense_head_code'").get();
    const adsenseSlotSetting = db.prepare("SELECT value FROM settings WHERE key = 'adsense_slot_id'").get();
    const adsenseEnabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'adsense_enabled'").get();

    res.json({
      success: true,
      data: {
        adVideoUrl: (adVideoSetting && adVideoSetting.value) ? adVideoSetting.value : 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
        vastTagUrl: (vastTagSetting && vastTagSetting.value) ? vastTagSetting.value : 'https://rodexchange.com/adt/vd.php?pid=0SA1QS7GFZZ4D',
        allowInstantSkip: instantSkipSetting ? instantSkipSetting.value === 'true' : false,
        telegramUrl: telegramSetting ? telegramSetting.value : 'https://t.me/darkpaki_official',
        popunderUrl: popunderSetting ? popunderSetting.value : '',
        bannerAdHtml: bannerAdSetting ? bannerAdSetting.value : '',
        monetagMetaTag: monetagMetaSetting ? monetagMetaSetting.value : '',
        safeModeEnabled: safeModeSetting ? safeModeSetting.value !== 'false' : true,
        adsensePubId: adsensePubSetting ? adsensePubSetting.value : '',
        adsenseHeadCode: adsenseHeadSetting ? adsenseHeadSetting.value : '',
        adsenseSlotId: adsenseSlotSetting ? adsenseSlotSetting.value : '',
        adsenseEnabled: adsenseEnabledSetting ? adsenseEnabledSetting.value === 'true' : false
      }
    });
  } catch (err) {
    next(err);
  }
}

async function getVastAd(req, res, next) {
  try {
    const vastTagSetting = db.prepare("SELECT value FROM settings WHERE key = 'vast_tag_url'").get();
    const adVideoSetting = db.prepare("SELECT value FROM settings WHERE key = 'ad_video_url'").get();
    const fallbackUrl = (adVideoSetting && adVideoSetting.value) ? adVideoSetting.value : 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
    
    // Priority Waterfall: 1) Configured VAST (WYNQ) 2) ExoClick In-Stream fallback
    const configuredVast = (vastTagSetting && vastTagSetting.value) ? vastTagSetting.value : 'https://rodexchange.com/adt/vd.php?pid=0SA1QS7GFZZ4D';
    const exoClickVast = 'https://s.magsrv.com/v1/vast.php?idz=6098978';

    // 1. Try Primary VAST tag (WYNQ)
    let result = await vastService.resolveVastTag(configuredVast);

    // 2. If no-fill on primary, waterfall to ExoClick
    if ((!result || !result.success || !result.ad) && configuredVast !== exoClickVast) {
      result = await vastService.resolveVastTag(exoClickVast);
    }

    if (result && result.success && result.ad) {
      return res.json({
        success: true,
        ad: result.ad
      });
    }

    return res.json({
      success: false,
      noFill: true,
      fallbackUrl: null,
      message: result?.message || 'No VAST ad fill'
    });
  } catch (err) {
    console.error('[VAST Resolver Controller Error]', err);
    return res.json({
      success: false,
      fallbackUrl: null,
      message: err.message
    });
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
    const earnings = calculateCreatorEarnings(viewsCount);

    const creatorName = video.creator || video.owner_name || 'DarkPAKI VIP';
    const followRow = db.prepare('SELECT id FROM follows WHERE creator_name = ? COLLATE NOCASE AND follower_device_id = ?').get(creatorName, cleanDevice);
    const countRow = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName);
    const followersCount = countRow ? countRow.count : 0;

    res.json({
      success: true,
      data: {
        id,
        likesCount: likes,
        dislikesCount: dislikes,
        userReaction,
        isFollowing: Boolean(followRow),
        followersCount,
        earnings
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

    const video = db.prepare('SELECT id, likes_count, dislikes_count, views_count, creator, owner_name FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ success: false, message: 'Video not found.' });
    }

    const cleanDevice = sanitizeString(deviceId);
    const existing = db.prepare('SELECT reaction FROM video_reactions WHERE video_id = ? AND device_id = ?').get(id, cleanDevice);
    const viewsCount = video.views_count || 0;
    const earnings = calculateCreatorEarnings(viewsCount);

    const creatorName = video.creator || video.owner_name || 'DarkPAKI VIP';
    const followRow = db.prepare('SELECT id FROM follows WHERE creator_name = ? COLLATE NOCASE AND follower_device_id = ?').get(creatorName, cleanDevice);
    const countRow = db.prepare('SELECT COUNT(*) as count FROM follows WHERE creator_name = ? COLLATE NOCASE').get(creatorName);
    const followersCount = countRow ? countRow.count : 0;

    res.json({
      success: true,
      data: {
        id,
        likesCount: video.likes_count || 0,
        dislikesCount: video.dislikes_count || 0,
        userReaction: existing ? existing.reaction : null,
        isFollowing: Boolean(followRow),
        followersCount,
        earnings
      }
    });
  } catch (err) {
    next(err);
  }
}

// Stream Proxy for External CDNs (bypasses 403 Forbidden, CORS & supports HTTP Range seeking)
function proxyVideoStream(req, res, next) {
  try {
    const rawUrl = req.query.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).send('Video URL parameter is required.');
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      return res.status(400).send('Invalid video URL.');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return res.status(400).send('Only HTTP and HTTPS protocols are supported.');
    }

    // SSRF protection: block local/private network addresses
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.')
    ) {
      return res.status(403).send('Forbidden destination host.');
    }

    const client = parsed.protocol === 'https:' ? require('https') : require('http');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const proxyReq = client.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: headers,
      timeout: 60000
    }, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;

      // Handle redirects
      if ([301, 302, 307, 308].includes(statusCode) && proxyRes.headers.location) {
        return res.redirect(proxyRes.headers.location);
      }

      const responseHeaders = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*'
      };

      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }
      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }

      res.writeHead(statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) res.status(504).send('CDN Gateway Timeout');
    });

    proxyReq.on('error', (err) => {
      console.error('[Video Stream Proxy Error]', err.message);
      if (!res.headersSent) res.status(502).send('Error streaming from upstream CDN');
    });

    res.on('close', () => {
      proxyReq.destroy();
    });

    proxyReq.end();

  } catch (err) {
    next(err);
  }
}

function getPublicFolders(req, res, next) {
  try {
    const folders = db.prepare(`
      SELECT f.*, COUNT(v.id) AS video_count
      FROM folders f
      LEFT JOIN videos v ON (v.folder_id = f.id OR (v.folder_id IS NULL AND v.folder_name = f.name COLLATE NOCASE)) AND (v.status = 'APPROVED' OR v.status IS NULL)
      GROUP BY f.id
      ORDER BY f.name ASC
    `).all();

    res.json({
      success: true,
      data: folders
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVideos,
  getVideoById,
  getPublicFolders,
  incrementView,
  uploadThumbnail,
  submitUserVideo,
  getAdConfig,
  getVastAd,
  reactToVideo,
  getVideoReactions,
  proxyVideoStream
};
