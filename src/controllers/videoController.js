const db = require('../db/database');
const { sanitizeString } = require('../middleware/validator');

function getVideos(req, res, next) {
  try {
    const { q, tag } = req.query;
    let query = 'SELECT * FROM videos';
    const params = [];
    const conditions = [];

    if (tag && tag !== 'ALL') {
      conditions.push('tag = ?');
      params.push(tag);
    }

    if (q && q.trim()) {
      const sanitizedQ = `%${q.trim()}%`;
      conditions.push('(title LIKE ? OR creator LIKE ? OR tag LIKE ? OR requested_by LIKE ?)');
      params.push(sanitizedQ, sanitizedQ, sanitizedQ, sanitizedQ);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY id DESC';

    const videos = db.prepare(query).all(...params);

    res.json({
      success: true,
      data: videos
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

    res.json({
      success: true,
      data: video
    });
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
  getAdConfig
};

