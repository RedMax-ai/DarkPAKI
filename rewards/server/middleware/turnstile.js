/**
 * Cloudflare Turnstile verification middleware.
 *
 * Reads `turnstileToken` from the request body, verifies it against
 * the Cloudflare siteverify API, and rejects if the token is invalid.
 *
 * In development mode with the well-known test secret key the check
 * is skipped for convenience.
 */
const config = require('../../config');

/* Cloudflare's test secret keys always pass verification */
const TEST_SECRET_KEYS = new Set([
  '1x0000000000000000000000000000000AA',  /* always passes */
  '2x0000000000000000000000000000000AA',  /* always fails (we still allow in dev) */
  '3x0000000000000000000000000000000AA',  /* token already spent */
  '0x0000000000000000000000000000000000', /* placeholder */
]);

async function verifyTurnstile(req, res, next) {
  /* In development with a test key, skip verification */
  if (
    config.nodeEnv === 'development' &&
    TEST_SECRET_KEYS.has(config.turnstileSecretKey)
  ) {
    return next();
  }

  const token = req.body && req.body.turnstileToken;
  if (!token) {
    return res.status(403).json({ error: 'CAPTCHA verification required.' });
  }

  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: config.turnstileSecretKey,
          response: token,
          remoteip: req.ip,
        }),
      },
    );

    const data = await response.json();

    if (!data.success) {
      return res.status(403).json({ error: 'CAPTCHA verification failed.' });
    }

    return next();
  } catch (err) {
    console.error('[turnstile] Verification request failed:', err.message);
    return res.status(500).json({ error: 'Unable to verify CAPTCHA at this time.' });
  }
}

module.exports = { verifyTurnstile };
