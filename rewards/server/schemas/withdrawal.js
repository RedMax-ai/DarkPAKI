/**
 * Zod schemas for withdrawal endpoints.
 */
const { z } = require('zod');

const createWithdrawalSchema = z.object({
  amountCoins: z
    .number({ required_error: 'Amount is required.' })
    .int('Amount must be a whole number.')
    .positive('Amount must be positive.'),
  method: z.enum(['upi', 'bank', 'jazzcash', 'easypaisa', 'paypal'], {
    required_error: 'Payment method is required.',
    invalid_type_error: 'Invalid payment method.',
  }),
  paymentDetails: z
    .object({}, { required_error: 'Payment details are required.' })
    .passthrough(), /* allow any fields within the object */
  turnstileToken: z
    .string({ required_error: 'CAPTCHA token is required.' })
    .min(1, 'CAPTCHA token is required.'),
  idempotencyKey: z
    .string({ required_error: 'Idempotency key is required.' })
    .uuid('Idempotency key must be a valid UUID.'),
});

const reviewWithdrawalSchema = z.object({
  status: z.enum(['approved', 'rejected'], {
    required_error: 'Status is required.',
    invalid_type_error: 'Status must be approved or rejected.',
  }),
  adminNote: z
    .string()
    .max(1000, 'Admin note is too long.')
    .optional(),
});

module.exports = { createWithdrawalSchema, reviewWithdrawalSchema };
