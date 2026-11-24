import { Router } from 'express';
import { db } from '../db.js';
import { verifyPassword, hashPassword } from '../lib/password.js';
import {
  createSession, destroySession, getUserForToken, sessionCookieOptions, sessionTokenFromRequest,
} from '../auth.js';
import { isRateLimited, recordFailure, clearFailures, clientKey } from '../lib/ratelimit.js';

export const authRouter = Router();

// Dummy hash so login runs a password verification whether or not the email
// exists — response timing cannot then be used to enumerate valid emails.
// scrypt cost matches real hashes; computed once at module load.
const DUMMY_HASH = hashPassword('no-such-account-timing-equalizer');

function login(req, res, mobile) {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = req.body?.password ?? '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  // Brute-force protection (per client IP, fail-open).
  const key = clientKey(req);
  const limit = isRateLimited(key);
  if (limit.limited) {
    res.set('Retry-After', String(limit.retryAfter));
    return res.status(429).json({ error: 'Too many login attempts. Please wait a few minutes and try again.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email);
  // Always verify (against a dummy hash when the user is absent) so timing does
  // not reveal whether the email is registered.
  const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    recordFailure(key);
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  // Correct password -> legitimate user; reset the throttle for this IP.
  clearFailures(key);
  if (user.status === 'inactive') {
    return res.status(403).json({ error: 'This account has been deactivated. Please contact an administrator.' });
  }

  const token = createSession(user.id);
  if (!mobile) res.cookie('session', token, sessionCookieOptions());
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    ...(mobile ? { token } : {}),
  });
}

authRouter.post('/login', (req, res) => login(req, res, false));
authRouter.post('/mobile-login', (req, res) => login(req, res, true));

authRouter.post('/logout', (req, res) => {
  const token = sessionTokenFromRequest(req);
  if (token) destroySession(token);
  // Clear with the same attributes the cookie was set with (Secure/SameSite).
  const { maxAge, ...clearOpts } = sessionCookieOptions();
  res.clearCookie('session', clearOpts);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const user = getUserForToken(sessionTokenFromRequest(req));
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});
