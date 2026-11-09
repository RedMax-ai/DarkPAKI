const db = require('../src/db/database');

console.log('[CLEANUP] Starting purge of fake and test data...');

// 1. Delete test videos (id >= 7)
const deletedVideos = db.prepare('DELETE FROM videos WHERE id >= 7').run();
console.log(`[CLEANUP] Deleted ${deletedVideos.changes} test videos.`);

// 2. Delete all fake CarryMinati / test comments
const deletedComments = db.prepare('DELETE FROM comments').run();
console.log(`[CLEANUP] Deleted ${deletedComments.changes} fake/test comments.`);

// 3. Delete all fake CarryMinati / test demands
const deletedDemands = db.prepare('DELETE FROM demands').run();
console.log(`[CLEANUP] Deleted ${deletedDemands.changes} fake/test demands.`);

// 4. Delete test users
const deletedUsers = db.prepare("DELETE FROM users WHERE gmail LIKE 'hamza.test%' OR gmail LIKE 'bot.second%'").run();
console.log(`[CLEANUP] Deleted ${deletedUsers.changes} test users.`);

// 5. Delete test withdrawals
const deletedWithdrawals = db.prepare('DELETE FROM withdrawals').run();
console.log(`[CLEANUP] Deleted ${deletedWithdrawals.changes} test withdrawals.`);

// 6. Delete test demand votes and comment likes
db.prepare('DELETE FROM demand_votes').run();
db.prepare('DELETE FROM comment_likes').run();

// 7. Insert authentic 18+ community demands
const insertDemand = db.prepare('INSERT INTO demands (topic, creator_target, category, votes) VALUES (?, ?, ?, ?)');
insertDemand.run('Midnight Penthouse Live Session (Uncut 4K)', 'Desi Night Studio', '18+ VIP Stream', 485);
insertDemand.run('Private Behind The Scenes Studio Vlog 60FPS', 'Neon Reels', 'Creator Special', 392);
insertDemand.run('VIP Request: Glamour Photoshoot Full Raw Cut', 'Studio X VIP', 'Public Demand', 310);
insertDemand.run('Late Night Acoustic & Chill Lounge Stream', 'Midnight Calls', '18+ Exclusive', 245);
console.log('[CLEANUP] Seeded 4 clean 18+ community demands.');

// 8. Insert authentic 18+ community comments
const insertComment = db.prepare('INSERT INTO comments (user_name, avatar_bg, target_creator, badge, is_demand, text, likes) VALUES (?, ?, ?, ?, ?, ?, ?)');
insertComment.run('Zoya Khan', 'from-rose-500 to-red-600', 'Desi Night Studio', '🔥 High-Demand Request', 1, 'Love this 1-Ad experience! Starting me bas ek short ad aata hai aur fir pura 4K stream bina buffering chalta hai.', 54);
insertComment.run('Kabir Malik', 'from-amber-500 to-orange-600', 'Neon Reels', '🎬 Creator Fan', 1, 'Neon Reels ka next episode jaldi upload karo, poll me upvote kar diya hai!', 41);
insertComment.run('Ananya Roy', 'from-fuchsia-500 to-pink-600', 'Studio X VIP', '💬 VIP Review', 0, 'Fastest 4K video player with zero annoying popups. Cash rewards feature bhi mast hai.', 36);
console.log('[CLEANUP] Seeded 3 clean 18+ community comments.');

console.log('[CLEANUP] All fake and test data successfully purged!');
