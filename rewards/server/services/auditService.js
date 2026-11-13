/**
 * Audit log service.
 * Every security-sensitive action goes through here.
 */
const { query } = require('../../db/pool');

/**
 * Write an entry to the audit_log table.
 *
 * @param {number|null} userId      Acting user (null for system actions)
 * @param {string}      action      e.g. 'login', 'withdrawal_created'
 * @param {string|null} targetType  e.g. 'user', 'withdrawal', 'referral'
 * @param {number|null} targetId    PK of the target row
 * @param {object|null} details     Arbitrary JSON metadata
 * @param {string|null} ipAddress   Request IP
 */
async function logAudit(userId, action, targetType, targetId, details, ipAddress) {
  await query(
    `INSERT INTO audit_log (user_id, action, target_type, target_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId || null,
      action,
      targetType || null,
      targetId || null,
      details ? JSON.stringify(details) : null,
      ipAddress || null,
    ],
  );
}

module.exports = { logAudit };
