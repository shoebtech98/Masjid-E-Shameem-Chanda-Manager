// Password hashing — Safeguard 1.
//
// scrypt is NOT available on Workers (not in WebCrypto) and, even if it were,
// the current scrypt(N=16384) cost (~40–100 ms CPU) exceeds the Workers Free
// plan's 10 ms CPU-per-invocation cap. The chosen replacement is PBKDF2-SHA256
// via WebCrypto (crypto.subtle), the platform-supported KDF.
//
// The iteration count is NOT hard-coded arbitrarily: scripts/benchmark-pbkdf2.mjs
// measures PBKDF2 cost in the real Workers runtime (workerd via wrangler dev /
// miniflare) and the documented result is set in wrangler.toml
// (PBKDF2_ITERATIONS). The count is also read from the environment at
// verification time (stored per-hash), so it can be raised later without
// invalidating existing hashes.
//
// Format (versioned):  pbkdf2$<iterations>$<salt-hex>$<hash-hex>
//   - unique random 16-byte salt per password
//   - 256-bit derived key
//   - constant-time comparison (WebCrypto has no timingSafeEqual)
//
// Passwords, hashes and salts are NEVER logged. Legacy scrypt hashes cannot be
// verified here (by design) — existing accounts get a one-time re-hash through
// the controlled migration workflow (scripts/bootstrap-passwords.mjs).

import { getIterations } from './env.js';

const KEY_LEN_BYTES = 32; // 256-bit derived key
export const MIN_PASSWORD_LENGTH = 15;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function derive(password, saltHex, iterations) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(saltHex), iterations },
    keyMaterial,
    KEY_LEN_BYTES * 8
  );
  return hex(new Uint8Array(bits));
}

function randomSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return hex(b);
}

/** Constant-time string comparison (byte-wise, no early exit). */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password, iterations = getIterations()) {
  const salt = randomSalt();
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${salt}$${hash}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts[0] !== 'pbkdf2' || parts.length !== 4) return false; // legacy scrypt: not verifiable on Workers
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const candidate = await derive(password, salt, iterations);
  return constantTimeEqual(expected, candidate);
}
