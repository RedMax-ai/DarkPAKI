const db = require('../db/database');
const { sanitizeString, validateDeviceId } = require('../middleware/validator');

function getDemands(req, res, next) {
  try {
    const deviceId = req.headers['x-device-id'] || req.query.deviceId || '';
    const demands = db.prepare('SELECT * FROM demands ORDER BY votes DESC').all();

    // Check votes for device
    const votedDemandIds = new Set();
    if (deviceId) {
      const votes = db.prepare('SELECT demand_id FROM demand_votes WHERE device_id = ?').all(deviceId);
      votes.forEach(v => votedDemandIds.add(v.demand_id));
    }

    const formatted = demands.map(d => ({
      id: d.id,
      topic: d.topic,
      creatorTarget: d.creator_target,
      category: d.category,
      votes: d.votes,
      voted: votedDemandIds.has(d.id)
    }));

    res.json({
      success: true,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
}

function voteDemand(req, res, next) {
  try {
    const demandId = parseInt(req.params.id, 10);
    const { deviceId } = req.body;

    const deviceVal = validateDeviceId(deviceId);
    if (!deviceVal.valid) {
      return res.status(400).json({ success: false, message: deviceVal.error });
    }
    const cleanDeviceId = deviceVal.deviceId;

    const demand = db.prepare('SELECT id, votes FROM demands WHERE id = ?').get(demandId);
    if (!demand) {
      return res.status(404).json({ success: false, message: 'Demand topic not found.' });
    }

    const existingVote = db.prepare('SELECT id FROM demand_votes WHERE demand_id = ? AND device_id = ?').get(demandId, cleanDeviceId);

    let hasVoted = false;
    let newVotes = demand.votes;

    if (existingVote) {
      // Remove vote
      db.prepare('DELETE FROM demand_votes WHERE id = ?').run(existingVote.id);
      db.prepare('UPDATE demands SET votes = MAX(0, votes - 1) WHERE id = ?').run(demandId);
      newVotes = Math.max(0, demand.votes - 1);
      hasVoted = false;
    } else {
      // Add vote
      db.prepare('INSERT INTO demand_votes (demand_id, device_id) VALUES (?, ?)').run(demandId, cleanDeviceId);
      db.prepare('UPDATE demands SET votes = votes + 1 WHERE id = ?').run(demandId);
      newVotes = demand.votes + 1;
      hasVoted = true;
    }

    res.json({
      success: true,
      data: {
        demandId,
        votes: newVotes,
        voted: hasVoted
      }
    });
  } catch (err) {
    next(err);
  }
}

function getComments(req, res, next) {
  try {
    const deviceId = req.headers['x-device-id'] || req.query.deviceId || '';
    const { filter } = req.query; // 'ALL' or 'DEMAND'

    let query = 'SELECT * FROM comments';
    const params = [];
    if (filter === 'DEMAND') {
      query += ' WHERE is_demand = 1';
    }
    query += ' ORDER BY id DESC';

    const comments = db.prepare(query).all(...params);

    const likedCommentIds = new Set();
    if (deviceId) {
      const likes = db.prepare('SELECT comment_id FROM comment_likes WHERE device_id = ?').all(deviceId);
      likes.forEach(l => likedCommentIds.add(l.comment_id));
    }

    const formatted = comments.map(c => ({
      id: c.id,
      user: c.user_name,
      avatarBg: c.avatar_bg,
      targetCreator: c.target_creator,
      badge: c.badge,
      isDemand: c.is_demand === 1,
      text: c.text,
      likes: c.likes,
      time: 'Recently',
      liked: likedCommentIds.has(c.id)
    }));

    res.json({
      success: true,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
}

function createCommentAndDemand(req, res, next) {
  try {
    const { userName, creatorTarget, badge, text, deviceId } = req.body;

    const cleanUserName = sanitizeString(userName);
    const cleanCreator = sanitizeString(creatorTarget);
    const cleanBadge = sanitizeString(badge) || '🔥 High-Demand Request';
    const cleanText = sanitizeString(text);

    if (!cleanUserName || !cleanCreator || !cleanText) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const isDemand = cleanBadge !== '💬 General Comment' ? 1 : 0;
    const avatarGradients = [
      'from-indigo-500 to-violet-600',
      'from-emerald-500 to-teal-600',
      'from-amber-500 to-orange-600',
      'from-fuchsia-500 to-rose-600',
      'from-sky-500 to-blue-600'
    ];
    const randomAvatar = avatarGradients[Math.floor(Math.random() * avatarGradients.length)];

    // Insert comment
    const insertComment = db.prepare(`
      INSERT INTO comments (user_name, avatar_bg, target_creator, badge, is_demand, text, likes)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    const commentRes = insertComment.run(cleanUserName, randomAvatar, cleanCreator, cleanBadge, isDemand, cleanText);
    const commentId = commentRes.lastInsertRowid;

    // Track initial self-like
    if (deviceId) {
      db.prepare('INSERT OR IGNORE INTO comment_likes (comment_id, device_id) VALUES (?, ?)').run(commentId, deviceId);
    }

    // If demand, also add to live poll
    let demandId = null;
    if (isDemand === 1) {
      const topicSnippet = cleanText.length > 70 ? cleanText.substring(0, 67) + '...' : cleanText;
      const insertDemand = db.prepare(`
        INSERT INTO demands (topic, creator_target, category, votes)
        VALUES (?, ?, 'Community Request', 1)
      `);
      const demandRes = insertDemand.run(topicSnippet, cleanCreator);
      demandId = demandRes.lastInsertRowid;

      if (deviceId) {
        db.prepare('INSERT OR IGNORE INTO demand_votes (demand_id, device_id) VALUES (?, ?)').run(demandId, deviceId);
      }
    }

    res.json({
      success: true,
      message: 'Demand and comment posted successfully!',
      data: {
        commentId,
        demandId
      }
    });
  } catch (err) {
    next(err);
  }
}

function likeComment(req, res, next) {
  try {
    const commentId = parseInt(req.params.id, 10);
    const { deviceId } = req.body;

    const deviceVal = validateDeviceId(deviceId);
    if (!deviceVal.valid) {
      return res.status(400).json({ success: false, message: deviceVal.error });
    }
    const cleanDeviceId = deviceVal.deviceId;

    const comment = db.prepare('SELECT id, likes FROM comments WHERE id = ?').get(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found.' });
    }

    const existingLike = db.prepare('SELECT id FROM comment_likes WHERE comment_id = ? AND device_id = ?').get(commentId, cleanDeviceId);

    let hasLiked = false;
    let newLikes = comment.likes;

    if (existingLike) {
      db.prepare('DELETE FROM comment_likes WHERE id = ?').run(existingLike.id);
      db.prepare('UPDATE comments SET likes = MAX(0, likes - 1) WHERE id = ?').run(commentId);
      newLikes = Math.max(0, comment.likes - 1);
      hasLiked = false;
    } else {
      db.prepare('INSERT INTO comment_likes (comment_id, device_id) VALUES (?, ?)').run(commentId, cleanDeviceId);
      db.prepare('UPDATE comments SET likes = likes + 1 WHERE id = ?').run(commentId);
      newLikes = comment.likes + 1;
      hasLiked = true;
    }

    res.json({
      success: true,
      data: {
        commentId,
        likes: newLikes,
        liked: hasLiked
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDemands,
  voteDemand,
  getComments,
  createCommentAndDemand,
  likeComment
};

