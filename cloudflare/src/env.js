// Environment handling for the Cloudflare Worker.
//
// Workers deliver configuration through bindings (wrangler.toml [vars] and
// `wrangler secret put`). This module copies string bindings into
// process.env (available with nodejs_compat) so the rest of the code reads
// environment the same way the reference app does. Secrets are NEVER logged
// or exposed — only read here.
//
// Production rules (mirror the reference app exactly):
//   - Demo/sample seeding only with explicit SEED_* opt-ins.
//   - Reset Sample Data is disabled in production.

const ENV = (typeof process !== 'undefined' && process.env) ? process.env : {};

/** Copy string bindings into process.env once, at boot. Never overwrites. */
export function loadEnv(env = {}) {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && ENV[key] === undefined) {
      ENV[key] = value;
    }
  }
}

export const isProduction = () => (ENV.NODE_ENV || 'development') === 'production';

/**
 * The demo-only reset is disabled in production. Outside production,
 * DEMO_MODE=false disables it.
 */
export function demoResetEnabled() {
  return !isProduction() && ENV.DEMO_MODE !== 'false';
}

/** PBKDF2-SHA256 iteration count — set by the benchmark, not guessed. */
export function getIterations() {
  const n = Number(ENV.PBKDF2_ITERATIONS);
  return Number.isInteger(n) && n >= 3000 && n <= 200000 ? n : 7000;
}

/** Cookie Secure flag override (COOKIE_SECURE=1/0), default = production. */
export function cookieSecureOverride() {
  const raw = String(ENV.COOKIE_SECURE ?? '').toLowerCase();
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null; // fall back to isProduction()
}
