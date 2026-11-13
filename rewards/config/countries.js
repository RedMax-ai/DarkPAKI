const coins = require('./coins');

/**
 * Withdrawal minimums per country.
 * Keys are ISO-3166-1 alpha-2 codes (uppercased).
 * `minCoins` is pre-calculated from the currency amount × coinsPerRupee.
 */
const withdrawalRules = {
  IN: {
    country: 'India',
    currency: 'INR',
    minAmount: 500,
    minCoins: 500 * coins.coinsPerRupee,       // 50 000
    methods: ['upi', 'bank'],
  },
  PK: {
    country: 'Pakistan',
    currency: 'PKR',
    minAmount: 500,
    minCoins: 500 * coins.coinsPerRupee,       // 50 000  (same floor)
    methods: ['jazzcash', 'easypaisa'],
  },
  // Catch-all for rest of world
  DEFAULT: {
    country: 'Other',
    currency: 'USD',
    minAmount: 5,
    minCoins: 5 * 83 * coins.coinsPerRupee,    // ≈ $5 at ~₹83/$ → 41 500 coins
    methods: ['paypal'],
  },
};

/**
 * Return the withdrawal rules for a given country code.
 * Falls back to DEFAULT for unknown countries.
 */
function getRulesForCountry(countryCode) {
  const code = (countryCode || '').toUpperCase();
  return withdrawalRules[code] || withdrawalRules.DEFAULT;
}

module.exports = { withdrawalRules, getRulesForCountry };
