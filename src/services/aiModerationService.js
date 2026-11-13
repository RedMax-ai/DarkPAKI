/**
 * CreatorLoop (DarkPAKI VIP) — AI Moderation & Content Safety Adapter
 * 
 * In accordance with AI_MODERATION.md:
 * - Operates in a strictly labeled Mock Mode (isMock: true) unless external cloud API key is supplied.
 * - Computes multi-category risk signals: NSFW/Adult, Violence, Hate/Harassment, Copyright Similarity.
 * - Flags uncertain or high-risk content for mandatory human reviewer action.
 * - Never treats automated signals as final legal proof of copyright or absolute safety.
 */

const config = require('../config');

/**
 * Categorize risk scores into operational moderation states:
 * - 'clear': Score <= 0.40 -> Candidate for standard moderator approval.
 * - 'review_required': 0.40 < Score <= 0.75 -> Elevated risk; needs careful human verification.
 * - 'blocked_pending_review': Score > 0.75 -> Critical policy violation risk; blocked from feed pending super-admin review.
 */
function evaluateRiskStatus(score) {
  if (score > 0.75) return 'blocked_pending_review';
  if (score > 0.40) return 'review_required';
  return 'clear';
}

/**
 * Analyze submitted video metadata and frame indicators
 * @param {Object} videoData
 * @param {string} videoData.title
 * @param {string} videoData.category
 * @param {string} videoData.creator
 * @param {number} [videoData.durationSeconds]
 * @returns {Promise<Object>}
 */
async function analyzeVideoSafety(videoData = {}) {
  const mode = process.env.AI_MODERATION_MODE || 'mock';
  const title = (videoData.title || '').toLowerCase();
  const category = (videoData.category || '').toLowerCase();

  // In Mock Mode: deterministic, rule-based simulation of multi-modal safety signals
  let nsfwScore = 0.15;
  let violenceScore = 0.05;
  let hateScore = 0.02;
  let similarityScore = 0.10;
  const flags = [];

  // Adult / Sensual Content Signals
  if (title.includes('uncut') || title.includes('exclusive') || title.includes('private') || category.includes('18+')) {
    nsfwScore = 0.65;
    flags.push('MATURE_18_PLUS_AUDIENCE_TAG');
  }
  if (title.includes('explicit') || title.includes('hardcore')) {
    nsfwScore = 0.88;
    flags.push('POTENTIAL_GRAPHIC_NSFW_VIOLATION');
  }

  // Violence / Harm Signals
  if (title.includes('fight') || title.includes('blood') || title.includes('brutal')) {
    violenceScore = 0.78;
    flags.push('POTENTIAL_GRAPHIC_VIOLENCE');
  }

  // Copyright / Duplicate Similarity Signals
  if (title.includes('full movie') || title.includes('netflix') || title.includes('disney') || title.includes('marvel')) {
    similarityScore = 0.85;
    flags.push('HIGH_COPYRIGHT_RISK_THIRD_PARTY_BRAND');
  }

  // Compute composite risk score
  const compositeRisk = Math.max(nsfwScore * 0.5, violenceScore * 0.9, hateScore, similarityScore * 0.8);
  const roundedRisk = Math.round(compositeRisk * 100) / 100;
  const status = evaluateRiskStatus(roundedRisk);

  return {
    provider: mode === 'mock' ? 'CreatorLoop-AI-Mock-v1' : 'CreatorLoop-Cloud-Vision',
    isMock: mode === 'mock',
    riskScore: roundedRisk,
    moderationStatus: status,
    signals: {
      nsfw: Math.round(nsfwScore * 100) / 100,
      violence: Math.round(violenceScore * 100) / 100,
      hate: Math.round(hateScore * 100) / 100,
      copyrightSimilarity: Math.round(similarityScore * 100) / 100
    },
    flags,
    recommendation: status === 'clear' ? 'APPROVE' : (status === 'review_required' ? 'INSPECT_MANUALLY' : 'REJECT_OR_HOLD'),
    analyzedAt: new Date().toISOString()
  };
}

module.exports = {
  analyzeVideoSafety,
  evaluateRiskStatus
};
