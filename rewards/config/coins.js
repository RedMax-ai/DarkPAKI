/**
 * Coin economy configuration.
 * Single source of truth for all coin/currency maths.
 */
module.exports = {
  /** How many coins equal 1 INR */
  coinsPerRupee: 100,

  /** Signup bonus (coins) */
  signupBonus: 500,

  /** Referral: coins credited to the REFERRER when the referred user qualifies */
  referralBonus: 3000,

  /** Referral: coins credited to the REFERRED user on qualifying */
  referredUserBonus: 500,

  /** Maximum referrals one user can earn per calendar day */
  maxReferralsPerDay: 10,

  /** Cooldown between withdrawal requests in milliseconds (24 hours) */
  withdrawalCooldownMs: 24 * 60 * 60 * 1000,

  /** Per-ad-watch reward (coins) */
  watchReward: 10,

  /** Maximum ad watches rewarded per day per user */
  maxWatchesPerDay: 50,
};
