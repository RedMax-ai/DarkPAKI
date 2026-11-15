const db = require('../src/db/database');

console.log('[PURGE] Starting 100% complete purge of all fake posts and items (A to Z)...');

// 1. Delete all videos (fake seed & test)
const delVideos = db.prepare('DELETE FROM videos').run();
console.log(`[PURGE] Deleted ${delVideos.changes} videos.`);

// 2. Delete all demands and demand votes
const delVotes = db.prepare('DELETE FROM demand_votes').run();
const delDemands = db.prepare('DELETE FROM demands').run();
console.log(`[PURGE] Deleted ${delVotes.changes} demand votes and ${delDemands.changes} demands.`);

// 3. Delete all comments and comment likes
const delLikes = db.prepare('DELETE FROM comment_likes').run();
const delComments = db.prepare('DELETE FROM comments').run();
console.log(`[PURGE] Deleted ${delLikes.changes} comment likes and ${delComments.changes} comments.`);

// 4. Delete all AI images and AI image likes
const delAiLikes = db.prepare('DELETE FROM ai_image_likes').run();
const delAi = db.prepare('DELETE FROM ai_images').run();
console.log(`[PURGE] Deleted ${delAiLikes.changes} AI image likes and ${delAi.changes} AI images.`);

// 5. Delete test user contacts
const delContacts = db.prepare('DELETE FROM user_contacts').run();
console.log(`[PURGE] Deleted ${delContacts.changes} user contact inquiries.`);

// 6. Reset autoincrement sequences
try {
  db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('videos', 'demands', 'demand_votes', 'comments', 'comment_likes', 'ai_images', 'ai_image_likes', 'user_contacts')").run();
  console.log('[PURGE] Autoincrement sequence IDs reset.');
} catch (e) {
  console.log('[PURGE] Note on sequence reset:', e.message);
}

console.log('[PURGE] ALL FAKE POSTS & ITEMS SUCCESSFULLY PURGED FROM DATABASE!');
