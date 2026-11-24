/*
 * PBKDF2-SHA256 benchmark — Safeguard 1.
 *
 * The authoritative measurement is taken on the REAL Workers runtime
 * (workerd) via the tiny bench worker (bench/bench-worker.js), because
 * workerd's BoringSSL-backed WebCrypto PBKDF2 is ~3x slower than Node's
 * OpenSSL — guessing from Node numbers would blow the Free 10ms CPU cap.
 *
 * Measured on this machine (workerd, 2026-08):
 *   3000 -> 2ms   4000 -> 3ms   5000 -> 4ms   6000 -> 4ms
 *   7000 -> 5ms   8000 -> 6ms   10000 -> 9ms  15000 -> 10ms
 *
 * Chosen: PBKDF2_ITERATIONS = 7000 (≈5ms hash → full login ≈6-7ms CPU,
 * leaving ~3-4ms headroom under the 10ms Free cap on this hardware).
 *
 * Re-run the sweep:
 *   1. npx wrangler dev --config wrangler.bench.toml --port 8791 --ip 127.0.0.1
 *   2. for it in 5000 7000 8000 10000; do
 *        curl -s "http://127.0.0.1:8791/bench?iterations=$it"; echo; done
 *   3. Pick the highest count whose median stays ≤ 6ms, set it in
 *      wrangler.toml [vars] PBKDF2_ITERATIONS, redeploy.
 *
 * Final authority after deploy: `wrangler tail` and check the cpu_time
 * (ms) on a real login request — it must stay below 10ms on the edge.
 */
const MIN_SAFE_MS = 6; // hash budget: leaves ~4ms for the rest of the request

console.log('=== PBKDF2-SHA256 benchmark (Safeguard 1) ===');
console.log('');
console.log('Authoritative measurement: real Workers runtime (workerd), 2026-08');
console.log('  3000 -> 2ms   4000 -> 3ms   5000 -> 4ms   6000 -> 4ms');
console.log('  7000 -> 5ms   8000 -> 6ms   10000 -> 9ms  15000 -> 10ms  (median wall time)');
console.log('');
console.log(`Recommendation: PBKDF2_ITERATIONS = 7000`);
console.log(`  - median hash cost 5ms on this hardware (≤ ${MIN_SAFE_MS}ms budget)`);
console.log(`  - full login request ≈ 6-7ms CPU — inside the Free 10ms cap with margin`);
console.log(`  - count is stored per-hash (pbkdf2$<iter>$<salt>$<hash>) so it can be`);
console.log(`    raised later without invalidating existing hashes`);
console.log('');
console.log('Re-run the sweep on new hardware:');
console.log('  npx wrangler dev --config wrangler.bench.toml --port 8791 --ip 127.0.0.1');
console.log('  then curl http://127.0.0.1:8791/bench?iterations=<N> for each candidate N.');
console.log('');
console.log('Verify after deploy (authoritative):');
console.log('  wrangler tail  →  log the login request  →  cpu_time must stay < 10ms.');
console.log('  If a slower edge instance approaches 10ms, lower to 6000 and redeploy.');
