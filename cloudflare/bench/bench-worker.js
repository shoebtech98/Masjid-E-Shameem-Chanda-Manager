// PBKDF2 benchmark worker — runs inside the REAL Workers runtime (workerd)
// via `wrangler dev`. Measures WebCrypto PBKDF2-SHA256 wall time (the exact
// API the app's login uses) at a requested iteration count.
//
//   GET /bench?iterations=15000  ->  { iterations, ms }
//
// Wall time is the closest observable proxy for the Free plan's 10 ms CPU
// per-invocation cap from inside a Worker (CPU time itself is a billing
// metric not exposed to the handler).
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/bench') return new Response('bench', { status: 404 });
    const iterations = Number(url.searchParams.get('iterations')) || 15000;

    const enc = new TextEncoder();
    const password = 'benchmark-password-123!';
    const salt = enc.encode('0123456789abcdef');

    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    // Warm-up
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 }, key, 256);

    const times = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[2];
    return new Response(JSON.stringify({ iterations, median_ms: Number(median.toFixed(3)), samples_ms: times.map((t) => Number(t.toFixed(3))) }), {
      headers: { 'content-type': 'application/json' },
    });
  },
};
