// Simple audit logging. Writes are best-effort: a failure to write the log
// must never break the operation being logged.
import { db } from '../db.js';

export function logAudit({ userId = null, userName = 'system', action, entity, entityId = null, description = '', details = null }) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, description, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      userName,
      action,
      entity,
      entityId,
      description,
      details ? JSON.stringify(details) : null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[audit] failed to write log:', err);
  }
}
