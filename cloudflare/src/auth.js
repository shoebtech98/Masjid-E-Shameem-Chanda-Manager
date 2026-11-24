// Session-based authentication (Hono) — port of the reference auth.js.
// Sessions persist in D1 so logins survive restarts. Same design: random
// 256-bit token in the sessions table, httpOnly + SameSite=Lax + Secure
// cookie, 30-day TTL, deactivated users rejected by the lookup JOIN.
// Session rows keep UTC timestamps internally (expiry comparisons are exact);
// user-facing timestamps use Asia/Kolkata via time.js.
import { getCookie, setCookie } from 'hono/cookie';
import { db } from './db.js';
import { isProduction, cookieSecureOverride } from './env.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_COOKIE = 'session';

export async function createSession(userId, verifiedPasswordHash = null) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const inserted = await db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at)
    SELECT ?, id, ?, ? FROM users
    WHERE id = ? AND status = 'active' AND (? IS NULL OR password_hash = ?)`)
    .run(token, nowIso, expiresAt, userId, verifiedPasswordHash, verifiedPasswordHash);
  if (inserted.changes !== 1) return null;
  // Opportunistic cleanup: purge expired sessions so the table cannot grow
  // unbounded. Best-effort — a cleanup failure must never fail the login.
  try {
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  } catch (err) {
    console.error('[auth] expired-session cleanup failed:', err);
  }
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export async function getUserForToken(token) {
  if (!token) return null;
  // Deactivated users are rejected immediately — their sessions die.
  const row = await db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.status = 'active'`
  ).get(token, new Date().toISOString());
  if (!row) return null;
  return row;
}

export function sessionTokenFromContext(c) {
  const authorization = c.req.header('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match ? match[1] : getCookie(c, SESSION_COOKIE);
}

export function isBearerContext(c) {
  return /^Bearer\s+[^\s]+$/i.test(c.req.header('authorization') || '');
}

/** Hono middleware: rejects unauthenticated requests with 401. */
export const requireAuth = async (c, next) => {
  const token = sessionTokenFromContext(c);
  const user = await getUserForToken(token);
  if (!user) {
    return c.json({ error: 'You must be logged in to access this.' }, 401);
  }
  c.set('user', user);
  c.set('sessionToken', token);
  c.set('authType', isBearerContext(c) ? 'bearer' : 'cookie');
  await next();
};

/** Hono middleware: requires one of the given roles (after requireAuth). */
export const requireRole = (...roles) => async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'You must be logged in to access this.' }, 401);
  }
  if (!roles.includes(user.role)) {
    return c.json({ error: 'You do not have permission to perform this action.' }, 403);
  }
  await next();
};

export function sessionCookieOptions() {
  const override = cookieSecureOverride();
  const secure = override !== null ? override : isProduction();
  return {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    secure,
  };
}

export { SESSION_COOKIE };

/** Set the session cookie on a Hono context. */
export function setSessionCookie(c, token) {
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions());
}

/**
 * Clear the session cookie using the SAME attributes it was set with
 * (Secure/SameSite/Path) so browsers reliably remove it — a bare
 * `Set-Cookie: session=; Max-Age=0` without Secure can be ignored on HTTPS.
 */
export function clearSessionCookie(c) {
  setCookie(c, SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
}
