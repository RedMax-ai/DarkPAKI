/**
 * Zod schemas for authentication endpoints.
 */
const { z } = require('zod');

const googleLoginSchema = z.object({
  credential: z
    .string({ required_error: 'Google credential is required.' })
    .min(1, 'Google credential is required.'),
  turnstileToken: z
    .string({ required_error: 'CAPTCHA token is required.' })
    .min(1, 'CAPTCHA token is required.'),
  deviceFingerprint: z
    .string({ required_error: 'Device fingerprint is required.' })
    .min(1, 'Device fingerprint is required.')
    .max(255, 'Device fingerprint is too long.'),
  referralCode: z
    .string()
    .max(20, 'Referral code is too long.')
    .optional(),
});

module.exports = { googleLoginSchema };
