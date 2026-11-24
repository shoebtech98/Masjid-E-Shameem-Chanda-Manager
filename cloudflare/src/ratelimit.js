// Login rate limiting (brute-force protection).
//
// D1-backed on purpose: Worker in-memory state is per-isolate and isolates are
// recycled, so an in-memory counter would not reliably throttle anything. The
// counter lives in D1 so every isolate sees the same state.
//
// Keyed by client IP: this throttles an automated/brute-forcing SOURCE without
// letting an attacker lock out a specific ACCOUNT by spamming its email
// (which keying by email would enable — a denial-of-service on that user).
//
// Fail-open by design: ANY storage error allows the login through. The limiter
// can never itself become a reason a legitimate user cannot log in.
import { db } from './db.js';

const MAX_ATTEMPTS = 10; // failed attempts allowed within the window
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Use the platform-provided client IP for the login throttle. */
export function clientKey(c) {
  return c.req.header('cf-connecting-ip') || 'unknown';
}

/**
 * Whether the key is currently blocked.
 * @returns {Promise<{ limited: boolean, retryAfter: number }>} retryAfter in seconds.
 */
export async function isRateLimited(key) {
  try {
    const row = await db.prepare('SELECT attempts, window_start FROM login_attempts WHERE key = ?').get(key);
    if (!row) return { limited: false, retryAfter: 0 };
    const elapsed = Date.now() - Date.parse(row.window_start);
    if (elapsed >= WINDOW_MS) return { limited: false, retryAfter: 0 }; // window expired
    if (row.attempts >= MAX_ATTEMPTS) {
      return { limited: true, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)) };
    }
    return { limited: false, retryAfter: 0 };
  } catch (err) {
    console.error('[ratelimit] check failed (allowing login):', err);
    return { limited: false, retryAfter: 0 }; // fail-open
  }
}

/** Record one failed login for the key, starting or extending the window. */
export async function recordFailure(key) {
  try {
    const nowIso = new Date().toISOString();
    const cutoffIso = new Date(Date.now() - WINDOW_MS).toISOString();
    // If the stored window has expired, reset to 1; otherwise increment.
    await db.prepare(
      `INSERT INTO login_attempts (key, attempts, window_start)
       VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         attempts     = CASE WHEN login_attempts.window_start <= ? THEN 1 ELSE login_attempts.attempts + 1 END,
         window_start = CASE WHEN login_attempts.window_start <= ? THEN ? ELSE login_attempts.window_start END`
    ).run(key, nowIso, cutoffIso, cutoffIso, nowIso);
  } catch (err) {
    console.error('[ratelimit] record failed:', err);
  }
}

/** Clear the counter for the key after a correct password (legitimate user). */
export async function clearFailures(key) {
  try {
    await db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
  } catch (err) {
    console.error('[ratelimit] clear failed:', err);
  }
}
