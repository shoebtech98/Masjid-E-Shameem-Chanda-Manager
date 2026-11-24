import { Hono } from 'hono';
import { db } from '../db.js';
import { verifyPassword, hashPassword } from '../password.js';
import {
  createSession, destroySession, getUserForToken, sessionTokenFromContext,
  setSessionCookie, clearSessionCookie,
} from '../auth.js';
import { isRateLimited, recordFailure, clearFailures, clientKey } from '../ratelimit.js';

export const authRouter = new Hono();

// Lazily-computed dummy hash: login runs a password verification whether or not
// the email exists, so response timing cannot be used to enumerate which emails
// are registered. Uses the same KDF/iterations as real hashes so cost matches.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('no-such-account-timing-equalizer');
  return dummyHashPromise;
}

async function login(c, mobile) {
  let body = null;
  try { body = await c.req.json(); } catch { /* malformed JSON -> 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    return c.json({ error: 'Email and password are required.' }, 400);
  }

  // Brute-force protection (per client IP, fail-open).
  const key = clientKey(c);
  const limit = await isRateLimited(key);
  if (limit.limited) {
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ error: 'Too many login attempts. Please wait a few minutes and try again.' }, 429);
  }

  const user = await db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  // Always run a verification (against a dummy hash when the user is absent) so
  // timing does not reveal whether the email is registered.
  const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash());
  if (!user || !ok) {
    await recordFailure(key);
    return c.json({ error: 'Invalid email or password.' }, 401);
  }
  // Correct password -> legitimate user; reset the throttle for this IP.
  await clearFailures(key);
  if (user.status === 'inactive') {
    return c.json({ error: 'This account has been deactivated. Please contact an administrator.' }, 403);
  }

  const token = await createSession(user.id, user.password_hash);
  if (!token) return c.json({ error: 'Sign-in details changed. Please try again.' }, 401);
  if (!mobile) setSessionCookie(c, token);
  return c.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    ...(mobile ? { token } : {}),
  });
}

authRouter.post('/login', (c) => login(c, false));
authRouter.post('/mobile-login', (c) => login(c, true));

authRouter.post('/logout', async (c) => {
  const token = sessionTokenFromContext(c);
  if (token) await destroySession(token);
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRouter.get('/me', async (c) => {
  const user = await getUserForToken(sessionTokenFromContext(c));
  if (!user) return c.json({ error: 'Not authenticated' }, 401);
  return c.json({ user });
});
