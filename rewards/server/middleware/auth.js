/**
 * Authentication middleware.
 * - requireAuth : verifies the access_token httpOnly cookie
 * - requireAdmin: requireAuth + role check
 */
const jwt = require('jsonwebtoken');
const config = require('../../config');

/**
 * Verify the JWT access token stored in the httpOnly cookie.
 * On success, attaches req.user = { id, role, email }.
 */
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.access_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(token, config.jwtAccessSecret);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res
        .status(401)
        .json({ error: 'Token expired.', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

/**
 * Admin-only gate — must be placed AFTER requireAuth in the middleware chain,
 * or used standalone (it calls requireAuth internally).
 */
function requireAdmin(req, res, next) {
  requireAuth(req, res, (authErr) => {
    if (authErr) return next(authErr);
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return next();
  });
}

module.exports = { requireAuth, requireAdmin };
