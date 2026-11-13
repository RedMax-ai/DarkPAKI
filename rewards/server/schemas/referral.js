/**
 * Zod schemas for referral endpoints.
 */
const { z } = require('zod');

const qualifyReferralSchema = z.object({
  actionType: z
    .string({ required_error: 'Action type is required.' })
    .min(1, 'Action type is required.')
    .max(100, 'Action type is too long.'),
});

module.exports = { qualifyReferralSchema };
