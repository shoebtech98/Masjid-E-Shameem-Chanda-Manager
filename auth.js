// Session-based authentication. Sessions persist in SQLite so logins
// survive server restarts. Passwords are hashed with scrypt (lib/password.js).
import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_COOKIE = 'session';

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, nowIso, expiresAt);
  // Opportunistic cleanup: purge expired sessions so the table cannot grow
  // unbounded. Best-effort — a cleanup failure must never fail the login.
  try {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  } catch (err) {
    console.error('[auth] expired-session cleanup failed:', err);
  }
  return token;
}

export function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserForToken(token) {
  if (!token) return null;
  // Deactivated users are rejected immediately — their sessions die.
  const row = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ? AND u.status = 'active'`
  ).get(token, new Date().toISOString());
  if (!row) return null;
  return row;
}

export function sessionTokenFromRequest(req) {
  const authorization = String(req.get('authorization') ?? '');
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match ? match[1] : req.cookies?.[SESSION_COOKIE];
}

export function isBearerRequest(req) {
  return /^Bearer\s+[^\s]+$/i.test(String(req.get('authorization') ?? ''));
}

/** Express middleware: rejects unauthenticated requests with 401. */
export function requireAuth(req, res, next) {
  const token = sessionTokenFromRequest(req);
  const user = getUserForToken(token);
  if (!user) {
    return res.status(401).json({ error: 'You must be logged in to access this.' });
  }
  req.user = user;
  req.sessionToken = token;
  req.authType = isBearerRequest(req) ? 'bearer' : 'cookie';
  next();
}

/** Express middleware: requires one of the given roles (after requireAuth). */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'You must be logged in to access this.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

export function sessionCookieOptions() {
  // Secure cookies: always httpOnly + SameSite=Lax. The Secure flag is on in
  // production (HTTPS) and can be forced via COOKIE_SECURE=1/0 for proxies
  // that terminate TLS, or when running local plain-HTTP deployments.
  const secureOverride = String(process.env.COOKIE_SECURE ?? '').toLowerCase();
  const secure = secureOverride === '1' || secureOverride === 'true'
    ? true
    : secureOverride === '0' || secureOverride === 'false'
      ? false
      : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
    secure,
  };
}
