// Login rate limiting (brute-force protection) for the single-process Node
// reference app. In-memory is reliable here (one process); state resets on
// restart, which is acceptable. Keyed by client IP so it throttles a
// brute-forcing source without letting an attacker lock out an account by
// spamming its email. Fail-open: any error allows the login through.

const MAX_ATTEMPTS = 10; // failed attempts allowed within the window
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_KEYS = 10000; // safety cap so a spraying attacker cannot grow the map unbounded

const attempts = new Map(); // key -> { count, windowStart }

export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function isRateLimited(key) {
  const rec = attempts.get(key);
  if (!rec) return { limited: false, retryAfter: 0 };
  const elapsed = Date.now() - rec.windowStart;
  if (elapsed >= WINDOW_MS) {
    attempts.delete(key);
    return { limited: false, retryAfter: 0 };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    return { limited: true, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - elapsed) / 1000)) };
  }
  return { limited: false, retryAfter: 0 };
}

export function recordFailure(key) {
  const now = Date.now();
  if (attempts.size > MAX_KEYS) attempts.clear(); // fail-open safety valve
  const rec = attempts.get(key);
  if (!rec || now - rec.windowStart >= WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
  } else {
    rec.count += 1;
  }
}

export function clearFailures(key) {
  attempts.delete(key);
}
