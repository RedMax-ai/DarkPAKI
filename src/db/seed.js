const bcrypt = require('bcryptjs');
const db = require('./database');
const config = require('../config');

function seedDatabase() {
  // Check if videos already exist
  const videoCount = db.prepare('SELECT COUNT(*) as count FROM videos').get().count;
  if (videoCount === 0) {
    const insertVideo = db.prepare(`
      INSERT INTO videos (title, creator, views, duration, src, thumb_img, tag, requested_by, is_featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const initialVideos = [
      {
        title: "Cute Midnight Lounge Live Session",
        creator: "Desi Night Studio",
        views: "842K views",
        duration: "12:45",
        src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        thumb_img: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80",
        tag: "TRENDING VIDEOS",
        requested_by: "Demanded by 840+ users",
        is_featured: 1
      },
      {
        title: "Desi Doll Live Video Stream Uncut",
        creator: "Live Stream Hub",
        views: "1.2M views",
        duration: "08:20",
        src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        thumb_img: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=600&q=80",
        tag: "TRENDING VIDEOS",
        requested_by: "Demanded by 1.1K+ users",
        is_featured: 0
      },
      {
        title: "Exclusive Backstage Creator Reel HD",
        creator: "Neon Reels",
        views: "690K views",
        duration: "15:10",
        src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
        thumb_img: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80",
        tag: "CREATOR SPECIAL",
        requested_by: "Demanded by 690+ users",
        is_featured: 0
      },
      {
        title: "Private Girlfriend Video Call Story",
        creator: "Midnight Calls",
        views: "2.4M views",
        duration: "10:05",
        src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoy.mp4",
        thumb_img: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80",
        tag: "PUBLIC DEMAND",
        requested_by: "#1 Audience Demand Winner",
        is_featured: 0
      },
      {
        title: "Late Night Dance & Music Showcase",
        creator: "Studio X",
        views: "530K views",
        duration: "09:40",
        src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
        thumb_img: "https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&w=600&q=80",
        tag: "CREATOR SPECIAL",
        requested_by: "Demanded by 410+ users",
        is_featured: 0
      },
      {
        title: "Viral Influencer Room Tour & Chat",
        creator: "Desi Creators",
        views: "980K views",
        duration: "14:15",
        src: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackSeeTheWorld.mp4",
        thumb_img: "https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=600&q=80",
        tag: "PUBLIC DEMAND",
        requested_by: "Demanded by 770+ users",
        is_featured: 0
      }
    ];

    for (const v of initialVideos) {
      insertVideo.run(v.title, v.creator, v.views, v.duration, v.src, v.thumb_img, v.tag, v.requested_by, v.is_featured);
    }
    console.log(`[SEED] Inserted ${initialVideos.length} initial videos.`);
  }

  // Check Demands
  const demandCount = db.prepare('SELECT COUNT(*) as count FROM demands').get().count;
  if (demandCount === 0) {
    const insertDemand = db.prepare(`
      INSERT INTO demands (topic, creator_target, category, votes)
      VALUES (?, ?, ?, ?)
    `);

    const initialDemands = [
      {
        topic: "Midnight Penthouse Live Session (Uncut 4K)",
        creator_target: "Desi Night Studio",
        category: "18+ VIP Stream",
        votes: 485
      },
      {
        topic: "Private Behind The Scenes Studio Vlog 60FPS",
        creator_target: "Neon Reels",
        category: "Creator Special",
        votes: 392
      },
      {
        topic: "VIP Request: Glamour Photoshoot Full Raw Cut",
        creator_target: "Studio X VIP",
        category: "Public Demand",
        votes: 310
      },
      {
        topic: "Late Night Acoustic & Chill Lounge Stream",
        creator_target: "Midnight Calls",
        category: "18+ Exclusive",
        votes: 245
      }
    ];

    for (const d of initialDemands) {
      insertDemand.run(d.topic, d.creator_target, d.category, d.votes);
    }
    console.log(`[SEED] Inserted ${initialDemands.length} initial community demands.`);
  }

  // Check Comments
  const commentCount = db.prepare('SELECT COUNT(*) as count FROM comments').get().count;
  if (commentCount === 0) {
    const insertComment = db.prepare(`
      INSERT INTO comments (user_name, avatar_bg, target_creator, badge, is_demand, text, likes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const initialComments = [
      {
        user_name: "Zoya Khan",
        avatar_bg: "from-rose-500 to-red-600",
        target_creator: "Desi Night Studio",
        badge: "🔥 High-Demand Request",
        is_demand: 1,
        text: "Love this 1-Ad experience! Starting me bas ek short ad aata hai aur fir pura 4K stream bina buffering chalta hai.",
        likes: 54
      },
      {
        user_name: "Kabir Malik",
        avatar_bg: "from-amber-500 to-orange-600",
        target_creator: "Neon Reels",
        badge: "🎬 Creator Fan",
        is_demand: 1,
        text: "Neon Reels ka next episode jaldi upload karo, poll me upvote kar diya hai!",
        likes: 41
      },
      {
        user_name: "Ananya Roy",
        avatar_bg: "from-fuchsia-500 to-pink-600",
        target_creator: "Studio X VIP",
        badge: "💬 VIP Review",
        is_demand: 0,
        text: "Fastest 4K video player with zero annoying popups. Cash rewards feature bhi mast hai.",
        likes: 36
      }
    ];

    for (const c of initialComments) {
      insertComment.run(c.user_name, c.avatar_bg, c.target_creator, c.badge, c.is_demand, c.text, c.likes);
    }
    console.log(`[SEED] Inserted ${initialComments.length} initial comments.`);
  }

  // Check Settings
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  const hashedAdminPin = bcrypt.hashSync(config.adminPin, 10);
  insertSetting.run('admin_pin_hash', hashedAdminPin);
  insertSetting.run('telegram_url', 'https://t.me/darkpaki_official');
  insertSetting.run('ad_video_url', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4');
  insertSetting.run('allow_instant_skip', 'false');

  // Check Initial Verified User
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (name, gmail, phone, device_id, balance, referrals, ads_watched, ref_code, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertUser.run(
      "Naved Master",
      "naved.official@gmail.com",
      "9876543210",
      "DPK-ADMIN-01",
      540.0,
      12,
      45,
      "DPK786",
      "admin"
    );
    console.log('[SEED] Inserted default admin user.');
  }

  // Check AI Images
  const aiCount = db.prepare('SELECT COUNT(*) as count FROM ai_images').get().count;
  if (aiCount === 0) {
    const insertAi = db.prepare(`
      INSERT INTO ai_images (prompt, style, image_url, aspect_ratio, likes, device_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const initialAiImages = [
      {
        prompt: "Cyberpunk VIP model with glowing neon tattoos in late-night luxury lounge",
        style: "Cyberpunk 18+",
        image_url: "https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80",
        aspect_ratio: "1:1",
        likes: 142,
        device_id: "DPK-SYSTEM-SEED"
      },
      {
        prompt: "Glamorous Bollywood actress in crimson dress under dramatic midnight spotlights",
        style: "Midnight Neon Glamour",
        image_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80",
        aspect_ratio: "9:16",
        likes: 189,
        device_id: "DPK-SYSTEM-SEED"
      },
      {
        prompt: "Futuristic anime queen in dark synthwave gaming penthouse 4K",
        style: "Anime Fantasy 4K",
        image_url: "https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=800&q=80",
        aspect_ratio: "1:1",
        likes: 97,
        device_id: "DPK-SYSTEM-SEED"
      }
    ];

    for (const img of initialAiImages) {
      insertAi.run(img.prompt, img.style, img.image_url, img.aspect_ratio, img.likes, img.device_id);
    }
    console.log(`[SEED] Inserted ${initialAiImages.length} initial AI images.`);
  }

  console.log('[SEED] Database seeding complete and verified.');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;

