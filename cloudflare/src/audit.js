// Audit logging — port of the reference lib/audit.js.
// Writes are best-effort: a failure to write the log must never break the
// operation being logged. Timestamps are Asia/Kolkata (safeguard 2).
import { db } from './db.js';
import { isoNow } from './time.js';

// IMPORTANT (Workers reliability): the write is AWAITED, not fire-and-forget.
// On the Workers runtime an un-awaited D1 write that is still pending when the
// response is returned can be cancelled by the runtime, silently dropping the
// audit entry. Callers therefore `await logAudit(...)` before responding. The
// internal try/catch means this never throws and never rejects, so awaiting it
// can never break (or fail) the operation being logged.
export async function logAudit({ userId = null, userName = 'system', action, entity, entityId = null, description = '', details = null }) {
  try {
    await db.prepare(
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
      isoNow()
    );
  } catch (err) {
    console.error('[audit] failed to write log:', err);
  }
}
