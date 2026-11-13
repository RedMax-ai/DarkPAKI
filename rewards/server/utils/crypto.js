/**
 * Cryptographic utilities.
 * - AES-256-CBC encrypt / decrypt (for payment details at rest)
 * - Gmail normalization
 */
const crypto = require('crypto');
const config = require('../../config');

const ALGORITHM = 'aes-256-cbc';

/**
 * Encrypt plaintext with AES-256-CBC.
 * Returns "iv:ciphertext" both hex-encoded.
 *
 * @param {string} text  Plaintext to encrypt
 * @returns {string}     "iv_hex:ciphertext_hex"
 */
function encrypt(text) {
  const iv = crypto.randomBytes(config.encryptionIvLength);
  const key = Buffer.from(config.encryptionKey, 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string produced by encrypt().
 *
 * @param {string} encryptedText  "iv_hex:ciphertext_hex"
 * @returns {string}  Original plaintext
 */
function decrypt(encryptedText) {
  const [ivHex, cipherHex] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = Buffer.from(config.encryptionKey, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Normalize a Gmail (or Google Workspace) address:
 *  1. Lowercase
 *  2. Remove dots from the local part (Gmail ignores them)
 *  3. Strip any +alias suffix
 *
 * For non-Gmail domains, only lowercases.
 *
 * @param {string} email
 * @returns {string}
 */
function normalizeGmail(email) {
  const lower = email.toLowerCase().trim();
  const [localRaw, domain] = lower.split('@');
  if (!domain) return lower;

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    /* Remove + alias */
    const localNoAlias = localRaw.split('+')[0];
    /* Remove dots */
    const localClean = localNoAlias.replace(/\./g, '');
    return `${localClean}@gmail.com`;
  }

  /* Non-Gmail: still strip + alias, but keep dots */
  const localNoAlias = localRaw.split('+')[0];
  return `${localNoAlias}@${domain}`;
}

module.exports = { encrypt, decrypt, normalizeGmail };
