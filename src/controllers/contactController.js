const db = require('../db/database');
const { sanitizeString } = require('../middleware/validator');

function submitContact(req, res, next) {
  try {
    const { userName, contactMethod, contactValue, videoTitle, fileUrl, message } = req.body;

    const cleanName = sanitizeString(userName);
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your name (at least 2 characters).' });
    }

    const cleanMethod = sanitizeString(contactMethod || 'telegram').toLowerCase();
    const cleanValue = sanitizeString(contactValue);
    if (!cleanValue || cleanValue.length < 3) {
      return res.status(400).json({ success: false, message: 'Please provide your contact handle or number (WhatsApp, Telegram, Phone or Email).' });
    }

    const cleanTitle = sanitizeString(videoTitle || 'User Video & Media Request');
    const cleanFileUrl = sanitizeString(fileUrl || '');
    const cleanMessage = sanitizeString(message);
    if (!cleanMessage || cleanMessage.length < 3) {
      return res.status(400).json({ success: false, message: 'Please write a brief message or video instructions.' });
    }

    const deviceId = req.headers['x-device-id'] || req.user?.device_id || 'DPK-CLIENT';

    const stmt = db.prepare(`
      INSERT INTO user_contacts (user_name, contact_method, contact_value, video_title, file_url, message, device_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'NEW')
    `);

    const result = stmt.run(cleanName, cleanMethod, cleanValue, cleanTitle, cleanFileUrl, cleanMessage, deviceId);
    const contactId = result.lastInsertRowid;
    const ticketId = `DPK-REQ-${contactId.toString().padStart(4, '0')}`;

    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'CONTACT_REQUEST_SUBMITTED',
      `Contact & Video request #${contactId} submitted by ${cleanName} (${cleanMethod}: ${cleanValue})`,
      req.ip,
      deviceId
    );

    res.json({
      success: true,
      message: 'Your video/file submission and contact request have been received successfully!',
      data: {
        id: contactId,
        ticketId,
        userName: cleanName,
        contactMethod: cleanMethod,
        contactValue: cleanValue,
        videoTitle: cleanTitle,
        fileUrl: cleanFileUrl,
        message: cleanMessage,
        status: 'NEW',
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
}

function getRecentContacts(req, res, next) {
  try {
    const deviceId = req.headers['x-device-id'] || req.user?.device_id || '';
    if (!deviceId) {
      return res.json({ success: true, data: [] });
    }

    const requests = db.prepare(`
      SELECT id, user_name, contact_method, contact_value, video_title, file_url, message, status, created_at
      FROM user_contacts
      WHERE device_id = ?
      ORDER BY id DESC
      LIMIT 10
    `).all(deviceId);

    res.json({
      success: true,
      data: requests
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitContact,
  getRecentContacts
};
