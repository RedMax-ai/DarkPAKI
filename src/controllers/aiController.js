const db = require('../db/database');
const { sanitizeString, validateDeviceId } = require('../middleware/validator');

// Style prompt modifiers
const STYLE_MODIFIERS = {
  'Cyberpunk 18+': 'cyberpunk 2077 aesthetic, futuristic neon glow, sleek dark cyberpunk club, volumetric lighting, 8k resolution, octane render, masterpiece',
  'Midnight Neon Glamour': 'high fashion glamour portrait, dark moody atmosphere, magenta and cyan neon rim lighting, cinema lens, ultra detailed, photorealistic',
  'Anime Fantasy 4K': 'high-end anime art style, makoto shinkai style, vibrant colors, detailed eyes, ethereal glowing lighting, 4k wallpaper quality',
  'Photorealistic Cinema': 'raw film photography, 35mm photograph, hyperrealistic, authentic skin texture, cinematic color grading, bokeh, award winning shot',
  'Desi Night Club': 'luxurious South Asian nightlife aesthetic, velvet and gold accents, warm dramatic spotlight, ultra HD, glamorous party ambiance'
};

// Dimensions based on aspect ratio
const DIMENSIONS = {
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 768, height: 1344 },
  '16:9': { width: 1280, height: 720 }
};

// Safety blocklist for illegal / extreme terms
const PROHIBITED_PATTERNS = [
  /child/i, /underage/i, /minor/i, /teen/i, /infant/i, /csam/i, /csea/i, /kid/i, /abuse/i, /non-consensual/i, /rape/i
];

function generateImage(req, res, next) {
  try {
    const { prompt, style = 'Cyberpunk 18+', aspectRatio = '1:1', deviceId } = req.body;

    const cleanPrompt = sanitizeString(prompt);
    if (!cleanPrompt || cleanPrompt.length < 3) {
      return res.status(400).json({ success: false, message: 'Please describe the image you want to generate (min 3 chars).' });
    }

    // Safety check
    if (PROHIBITED_PATTERNS.some(pattern => pattern.test(cleanPrompt))) {
      db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
        'AI_PROMPT_BLOCKED',
        `Blocked unsafe prompt attempt: ${cleanPrompt}`,
        req.ip,
        deviceId || 'UNKNOWN'
      );
      return res.status(400).json({
        success: false,
        message: 'Your prompt contains restricted or policy-violating terms. Please write a creative, artistic description.'
      });
    }

    // Build enhanced prompt
    const styleModifier = STYLE_MODIFIERS[style] || STYLE_MODIFIERS['Cyberpunk 18+'];
    const enhancedPrompt = `${cleanPrompt}, ${styleModifier}`;
    
    // Calculate dimensions
    const dims = DIMENSIONS[aspectRatio] || DIMENSIONS['1:1'];
    const randomSeed = Math.floor(Math.random() * 9999999);

    // Generate reliable AI image URL via Pollinations Flux engine
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${dims.width}&height=${dims.height}&nologo=true&seed=${randomSeed}&model=flux`;

    // Persist into SQLite database
    const insertStmt = db.prepare(`
      INSERT INTO ai_images (prompt, style, image_url, aspect_ratio, likes, device_id)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    const result = insertStmt.run(cleanPrompt, style, imageUrl, aspectRatio, deviceId || 'ANONYMOUS');
    const newImage = db.prepare('SELECT * FROM ai_images WHERE id = ?').get(result.lastInsertRowid);

    // Track initial like
    if (deviceId) {
      db.prepare('INSERT OR IGNORE INTO ai_image_likes (image_id, device_id) VALUES (?, ?)').run(newImage.id, deviceId);
    }

    // Log creation
    db.prepare('INSERT INTO security_logs (event_type, details, ip, device_id) VALUES (?, ?, ?, ?)').run(
      'AI_IMAGE_GENERATED',
      `Generated AI image ID ${newImage.id} for prompt: "${cleanPrompt}"`,
      req.ip,
      deviceId || 'UNKNOWN'
    );

    res.json({
      success: true,
      message: 'AI Image generated and saved successfully!',
      data: {
        id: newImage.id,
        prompt: newImage.prompt,
        style: newImage.style,
        imageUrl: newImage.image_url,
        aspectRatio: newImage.aspect_ratio,
        likes: newImage.likes,
        createdAt: newImage.created_at,
        liked: true
      }
    });
  } catch (err) {
    next(err);
  }
}

function getGallery(req, res, next) {
  try {
    const deviceId = req.headers['x-device-id'] || req.query.deviceId || '';
    const images = db.prepare('SELECT * FROM ai_images ORDER BY id DESC LIMIT 50').all();

    const likedIds = new Set();
    if (deviceId) {
      const likes = db.prepare('SELECT image_id FROM ai_image_likes WHERE device_id = ?').all(deviceId);
      likes.forEach(l => likedIds.add(l.image_id));
    }

    const formatted = images.map(img => ({
      id: img.id,
      prompt: img.prompt,
      style: img.style,
      imageUrl: img.image_url,
      aspectRatio: img.aspect_ratio,
      likes: img.likes,
      createdAt: img.created_at,
      liked: likedIds.has(img.id)
    }));

    res.json({
      success: true,
      data: formatted
    });
  } catch (err) {
    next(err);
  }
}

function likeImage(req, res, next) {
  try {
    const imageId = parseInt(req.params.id, 10);
    const { deviceId } = req.body;

    const deviceVal = validateDeviceId(deviceId);
    if (!deviceVal.valid) {
      return res.status(400).json({ success: false, message: deviceVal.error });
    }
    const cleanDeviceId = deviceVal.deviceId;

    const image = db.prepare('SELECT id, likes FROM ai_images WHERE id = ?').get(imageId);
    if (!image) {
      return res.status(404).json({ success: false, message: 'AI Image not found.' });
    }

    const existingLike = db.prepare('SELECT id FROM ai_image_likes WHERE image_id = ? AND device_id = ?').get(imageId, cleanDeviceId);

    let hasLiked = false;
    let newLikes = image.likes;

    if (existingLike) {
      db.prepare('DELETE FROM ai_image_likes WHERE id = ?').run(existingLike.id);
      db.prepare('UPDATE ai_images SET likes = MAX(0, likes - 1) WHERE id = ?').run(imageId);
      newLikes = Math.max(0, image.likes - 1);
      hasLiked = false;
    } else {
      db.prepare('INSERT INTO ai_image_likes (image_id, device_id) VALUES (?, ?)').run(imageId, cleanDeviceId);
      db.prepare('UPDATE ai_images SET likes = likes + 1 WHERE id = ?').run(imageId);
      newLikes = image.likes + 1;
      hasLiked = true;
    }

    res.json({
      success: true,
      data: {
        imageId,
        likes: newLikes,
        liked: hasLiked
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generateImage,
  getGallery,
  likeImage
};

