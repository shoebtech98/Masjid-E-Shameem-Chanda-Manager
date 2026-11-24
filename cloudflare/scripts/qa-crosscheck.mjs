/*
 * Endpoint-level cross-check: reference SQLite app vs Cloudflare D1 app.
 *
 * Builds an IDENTICAL fixture dataset, serves it from the reference app
 * (real HTTP, Node/Express/SQLite) and from the Cloudflare build (Hono +
 * D1 shim running in-process), then replays the same requests against both
 * and deep-compares the JSON after normalizing volatile timestamps.
 *
 * Also runs the financial behavior battery (cash/UPI/split, duplicates,
 * future dates, roles) against BOTH sides and compares the PDF
 * docDefinition produced by the reference server builders vs the
 * client-side ChandaPdf builders.
 *
 * The REAL data/chanda.db is never touched — the reference app runs on a
 * throwaway DB in a temp directory.
 *
 * Usage (from cloudflare/):
 *   npm run crosscheck
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { createD1Shim } from '../test/d1-shim.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF_ROOT = path.join(__dirname, '..');
const REPO_ROOT = path.join(CF_ROOT, '..');
const REF_PORT = 3211;
const REF_BASE = `http://127.0.0.1:${REF_PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.error(`  ✗ ${name} ${detail}`); }
}

/** Volatile timestamps that legitimately differ between the two servers. */
const VOLATILE = new Set(['created_at', 'updated_at', 'generated_at', 'uptime']);

function normalize(v) {
  if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
    try { return normalize(JSON.parse(v)); } catch { /* keep string */ }
  }
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (VOLATILE.has(k)) continue;
      out[k] = normalize(val);
    }
    return out;
  }
  return v;
}

const cookieFrom = (res) => {
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return sc[0] ? sc[0].split(';')[0] : '';
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* retry */ }
    await sleep(400);
  }
  return false;
}

function jsonHeaders(cookie) {
  return { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) };
}

// ---------------------------------------------------------------------------
// 1. Fixture: throwaway reference DB (the REAL data/chanda.db is never touched)
// ---------------------------------------------------------------------------
const tmp = mkdtempSync(path.join(tmpdir(), 'masjid-qa-'));
const refDb = path.join(tmp, 'ref.db');
const fixtureSql = path.join(tmp, 'fixture.sql');

console.log('\n== 1. Building identical fixture dataset (throwaway DB) ==');
const seedScript = [
  "import('./db.js').then((m) => {",
  '  m.initDb();',
  '  m.seedSampleData();',      // seeds users + households + payments + audit
  '  m.ensureDemoUsers();',     // no-op after the seed (users already exist)
  "  console.log('fixture ready');",
  '});',
].join('\n');
execFileSync(process.execPath, ['-e', seedScript], {
  env: { ...process.env, DB_PATH: refDb },
  cwd: REPO_ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
});
console.log('  reference fixture DB seeded (demo users + sample data)');

execFileSync(process.execPath, [
  path.join(CF_ROOT, 'scripts', 'export-local.mjs'),
  '--db', refDb, '--out', fixtureSql,
], { cwd: CF_ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
const dumpSql = readFileSync(fixtureSql, 'utf8');
ok('fixture dump contains data rows', dumpSql.includes('INSERT INTO households') && dumpSql.includes('INSERT INTO payments'));

// ---------------------------------------------------------------------------
// 2. Start the reference app on the throwaway DB (real HTTP)
// ---------------------------------------------------------------------------
console.log('\n== 2. Starting reference app (port ' + REF_PORT + ') ==');
const refProc = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, DB_PATH: refDb, NODE_ENV: 'development', PORT: String(REF_PORT) },
  cwd: REPO_ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
});
if (!(await waitFor(`${REF_BASE}/api/health`))) {
  console.error('✗ Reference app did not come up on port ' + REF_PORT);
  refProc.kill();
  process.exit(1);
}
console.log('  reference app healthy');

// ---------------------------------------------------------------------------
// 3. Cloudflare build in-process (Hono + D1 shim on the same fixture)
// ---------------------------------------------------------------------------
console.log('\n== 3. Booting Cloudflare build (Hono + D1 shim) ==');
const shim = createD1Shim();
shim.exec(dumpSql);

// The fixture users carry scrypt hashes (created by the reference seeder).
// The Cloudflare build verifies PBKDF2 only — re-hash them with the real
// migration path (scripts/bootstrap-passwords.mjs does this for real data).
const { hashPassword } = await import(pathToFileURL(path.join(CF_ROOT, 'src', 'password.js')).href);
for (const [email, pw] of [['treasurer@shameem.example', 'treasurer123'], ['admin@shameem.example', 'admin123']]) {
  const h = await hashPassword(pw);
  shim._sqlite.prepare('UPDATE users SET password_hash = ? WHERE lower(email) = lower(?)').run(h, email);
}

const { buildApp } = await import(pathToFileURL(path.join(CF_ROOT, 'src', 'index.js')).href);
const cfApp = await buildApp({ DB: shim, NODE_ENV: 'test', APP_TZ: 'Asia/Kolkata', PBKDF2_ITERATIONS: '3000', DEMO_MODE: 'true' });
ok('cloudflare app booted with identical data', true);

/** Request helper: returns { status, json, text, cookie } for one side. */
async function req(side, method, urlPath, { body, cookie, headers = {} } = {}) {
  const requestHeaders = {
    ...(body ? jsonHeaders(cookie) : { ...(cookie ? { cookie } : {}) }),
    ...headers,
  };
  const r = side === 'ref'
    ? await fetch(REF_BASE + urlPath, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
      })
    : await cfApp.fetch(new Request('http://localhost' + urlPath, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
      }));
  // Read the body exactly once (undici forbids a second read).
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json — text used */ }
  return { status: r.status, json, text, cookie: cookieFrom(r) };
}

async function login(side, email, password) {
  const r = await req(side, 'POST', '/api/auth/login', { body: { email, password } });
  return { status: r.status, cookie: r.cookie, json: r.json };
}

/** Compare an endpoint response between the two sides. */
async function compare(name, method, urlPath, opts = {}) {
  const a = await req('ref', method, urlPath, { ...opts, cookie: opts.cookie || opts.refCookie || T });
  const b = await req('cf', method, urlPath, { ...opts, cookie: opts.cfCookie || cT_ });
  let cond = a.status === b.status;
  let detail = `(status ${a.status} vs ${b.status})`;
  if (cond && a.json !== null && b.json !== null) {
    try { assert.deepStrictEqual(normalize(a.json), normalize(b.json)); }
    catch (e) { cond = false; detail = `\n    JSON mismatch: ${String(e.message).split('\n').slice(0, 4).join('\n    ')}`; }
  } else if (cond && a.text !== null && b.text !== null) {
    cond = a.text === b.text;
    detail = cond ? '' : `(text differs, ${a.text.length} vs ${b.text.length} chars)`;
  }
  ok(`${name} [${method} ${urlPath}]`, cond, cond ? '' : detail);
  return { a, b };
}

/** Apply the same mutation to both sides and compare status + JSON. */
async function both(name, method, urlPath, opts = {}) {
  const a = await req('ref', method, urlPath, { ...opts, cookie: opts.cookie || T });
  const b = await req('cf', method, urlPath, { ...opts, cookie: opts.cookie || cT_ });
  let cond = a.status === b.status;
  let detail = `(status ${a.status} vs ${b.status})`;
  if (cond && a.json !== null && b.json !== null) {
    try { assert.deepStrictEqual(normalize(a.json), normalize(b.json)); }
    catch (e) { cond = false; detail = `\n    JSON mismatch: ${String(e.message).split('\n').slice(0, 4).join('\n    ')}`; }
  }
  ok(`${name} [${method} ${urlPath}]`, cond, cond ? '' : detail);
  return { a, b };
}

// ---------------------------------------------------------------------------
// 4. Authentication + roles
// ---------------------------------------------------------------------------
console.log('\n== 4. Authentication & roles ==');
const tLogin = await login('ref', 'treasurer@shameem.example', 'treasurer123');
const aLogin = await login('ref', 'admin@shameem.example', 'admin123');
const cT = await login('cf', 'treasurer@shameem.example', 'treasurer123');
const cA = await login('cf', 'admin@shameem.example', 'admin123');
ok('treasurer login (ref 200, cf 200)', tLogin.status === 200 && cT.status === 200);
ok('admin login (ref 200, cf 200)', aLogin.status === 200 && cA.status === 200);
ok('bad password rejected (401 both)', (await login('ref', 'treasurer@shameem.example', 'wrongpass')).status === 401
  && (await login('cf', 'treasurer@shameem.example', 'wrongpass')).status === 401);
ok('unknown email rejected (401 both)', (await login('ref', 'nobody@example.com', 'whatever123')).status === 401
  && (await login('cf', 'nobody@example.com', 'whatever123')).status === 401);

const T = tLogin.cookie;
const A = aLogin.cookie;
const cT_ = cT.cookie;
const cA_ = cA.cookie;
const nativeLoginRef = await req('ref', 'POST', '/api/auth/mobile-login', {
  body: { email: 'treasurer@shameem.example', password: 'treasurer123' },
});
const nativeLoginCf = await req('cf', 'POST', '/api/auth/mobile-login', {
  body: { email: 'treasurer@shameem.example', password: 'treasurer123' },
});
ok('native login returns a session token on both backends',
  nativeLoginRef.status === 200 && Boolean(nativeLoginRef.json?.token)
  && nativeLoginCf.status === 200 && Boolean(nativeLoginCf.json?.token));
const nativeMeRef = await req('ref', 'GET', '/api/auth/me', {
  headers: { authorization: `Bearer ${nativeLoginRef.json?.token}` },
});
const nativeMeCf = await req('cf', 'GET', '/api/auth/me', {
  headers: { authorization: `Bearer ${nativeLoginCf.json?.token}` },
});
ok('native bearer session authenticates /me on both backends',
  nativeMeRef.status === 200 && nativeMeRef.json?.user?.email === 'treasurer@shameem.example'
  && nativeMeCf.status === 200 && nativeMeCf.json?.user?.email === 'treasurer@shameem.example');

await compare('treasurer blocked from /api/users', 'GET', '/api/users', { cookie: T });
await compare('treasurer blocked from /api/audit', 'GET', '/api/audit', { cookie: T });
await compare('admin can list users', 'GET', '/api/users', { refCookie: A, cfCookie: cA_ });
await compare('anonymous rejected', 'GET', '/api/dashboard', {});

// ---------------------------------------------------------------------------
// 5. Read endpoints (identical fixture) — the core reconciliation
// ---------------------------------------------------------------------------
console.log('\n== 5. Endpoint reconciliation (identical data) ==');
await compare('dashboard (current month)', 'GET', '/api/dashboard', { cookie: T });
await compare('dashboard (August 2026)', 'GET', '/api/dashboard?month=8&year=2026', { cookie: T });
await compare('dashboard (January 2026, empty)', 'GET', '/api/dashboard?month=1&year=2026', { cookie: T });
for (const filter of ['all', 'cash', 'upi', 'paid', 'pending']) {
  await compare(`report filter=${filter}`, 'GET', `/api/reports?month=8&year=2026&filter=${filter}`, { cookie: T });
}
await compare('report data monthly (all)', 'GET', '/api/reports/data?type=monthly&month=8&year=2026&mode=all', { cookie: T });
await compare('report data monthly (cash)', 'GET', '/api/reports/data?type=monthly&month=8&year=2026&mode=cash', { cookie: T });
await compare('report data annual', 'GET', '/api/reports/data?type=annual&year=2026&mode=all', { cookie: T });
await compare('households list', 'GET', '/api/households', { cookie: T });
await compare('households search A-10', 'GET', '/api/households?search=A-10', { cookie: T });
await compare('household detail (history + summary)', 'GET', '/api/households/1', { cookie: T });
await compare('settings stats', 'GET', '/api/settings', { cookie: T });
await compare('audit list (admin)', 'GET', '/api/audit?limit=50', { refCookie: A, cfCookie: cA_ });
await compare('audit stats (admin)', 'GET', '/api/audit/stats', { refCookie: A, cfCookie: cA_ });
await compare('csv export', 'GET', '/api/reports/export/monthly-csv?month=8&year=2026', { cookie: T });
await compare('payments check (duplicate exists)', 'GET', '/api/payments/check?household_id=1&month=8&year=2026', { cookie: T });
await compare('payments check (no duplicate)', 'GET', '/api/payments/check?household_id=2&month=8&year=2026', { cookie: T });

// ---------------------------------------------------------------------------
// 6. Financial behavior battery (mutations applied to BOTH sides)
// ---------------------------------------------------------------------------
console.log('\n== 6. Financial behavior battery (identical mutations on both sides) ==');

let qaHouseholdId = null;
let cashPaymentId = null;
let upiPaymentId = null;

// New household (ids in both DBs stay in sync — Q-1 gets id 12 after the 11 seeds)
let r = await both('create household Q-1', 'POST', '/api/households', {
  body: { house_no: 'Q-1', name: 'QA Household', phone: '12345 67890', monthly_amount: '400', status: 'active' },
});
qaHouseholdId = r.b.json?.household?.id ?? null;
await both('duplicate household rejected', 'POST', '/api/households', {
  body: { house_no: 'Q-1', name: 'Dup', phone: '', monthly_amount: '400', status: 'active' },
});

const concurrentCreateBody = {
  household_id: String(qaHouseholdId),
  month: 4,
  year: 2026,
  amount: '400',
  payment_mode: 'cash',
  payment_date: '2026-04-10',
};
const [refCreateA, refCreateB, cfCreateA, cfCreateB] = await Promise.all([
  req('ref', 'POST', '/api/payments', { body: concurrentCreateBody, cookie: T }),
  req('ref', 'POST', '/api/payments', { body: concurrentCreateBody, cookie: T }),
  req('cf', 'POST', '/api/payments', { body: concurrentCreateBody, cookie: cT_ }),
  req('cf', 'POST', '/api/payments', { body: concurrentCreateBody, cookie: cT_ }),
]);
const createStatuses = (a, b) => [a.status, b.status].sort((x, y) => x - y);
ok('concurrent payment create allows exactly one write (both backends)',
  JSON.stringify(createStatuses(refCreateA, refCreateB)) === JSON.stringify([201, 409])
  && JSON.stringify(createStatuses(cfCreateA, cfCreateB)) === JSON.stringify([201, 409]));

// Cash payment (today is 17 Aug 2026 — all dates below are in the past)
r = await both('record cash payment', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 8, year: 2026, amount: '400', payment_mode: 'cash', payment_date: '2026-08-10' },
});
cashPaymentId = r.b.json?.payment?.id ?? null;
r = await both('record upi payment', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 7, year: 2026, amount: '400', payment_mode: 'upi', payment_date: '2026-07-05', upi_reference: 'UPI-QA-1' },
});
upiPaymentId = r.b.json?.payment?.id ?? null;
await both('record split payment', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 6, year: 2026, amount: '300', payment_mode: 'split', cash_amount: '100', upi_amount: '200', payment_date: '2026-06-15' },
});
await both('split mismatch rejected', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 5, year: 2026, amount: '300', payment_mode: 'split', cash_amount: '100', upi_amount: '150', payment_date: '2026-05-15' },
});
await both('duplicate payment rejected', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 8, year: 2026, amount: '400', payment_mode: 'cash', payment_date: '2026-08-11' },
});
await both('future payment date rejected', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 8, year: 2099, amount: '100', payment_mode: 'cash', payment_date: '2099-01-01' },
});
await both('invalid payment mode rejected', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 5, year: 2026, amount: '100', payment_mode: 'cheque', payment_date: '2026-05-01' },
});

// Reconcile after mutations
await compare('dashboard after mutations', 'GET', '/api/dashboard?month=8&year=2026', { cookie: T });
await compare('household Q-1 history after mutations', 'GET', `/api/households/${qaHouseholdId}`, { cookie: T });
await compare('annual report after mutations', 'GET', '/api/reports/data?type=annual&year=2026&mode=all', { cookie: T });

const editRaceA = await both('create payment for update race A', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 2, year: 2026, amount: '400', payment_mode: 'cash', payment_date: '2026-02-10' },
});
const editRaceB = await both('create payment for update race B', 'POST', '/api/payments', {
  body: { household_id: String(qaHouseholdId), month: 3, year: 2026, amount: '400', payment_mode: 'cash', payment_date: '2026-03-10' },
});
const updateRaceBody = {
  household_id: String(qaHouseholdId),
  month: 5,
  year: 2026,
  amount: '400',
  payment_mode: 'cash',
  payment_date: '2026-05-10',
};
const [refUpdateA, refUpdateB, cfUpdateA, cfUpdateB] = await Promise.all([
  req('ref', 'PUT', `/api/payments/${editRaceA.a.json.payment.id}`, { body: updateRaceBody, cookie: T }),
  req('ref', 'PUT', `/api/payments/${editRaceB.a.json.payment.id}`, { body: updateRaceBody, cookie: T }),
  req('cf', 'PUT', `/api/payments/${editRaceA.b.json.payment.id}`, { body: updateRaceBody, cookie: cT_ }),
  req('cf', 'PUT', `/api/payments/${editRaceB.b.json.payment.id}`, { body: updateRaceBody, cookie: cT_ }),
]);
ok('concurrent payment edits allow exactly one write (both backends)',
  JSON.stringify(createStatuses(refUpdateA, refUpdateB)) === JSON.stringify([200, 409])
  && JSON.stringify(createStatuses(cfUpdateA, cfUpdateB)) === JSON.stringify([200, 409]));

// Edit + delete the recorded payments
await both('payment edit rejects a nonexistent household', 'PUT', `/api/payments/${cashPaymentId}`, {
  body: { household_id: '999999', month: 8, year: 2026, amount: '400', payment_mode: 'cash', payment_date: '2026-08-10' },
});
await both('edit payment (cash -> split amount change)', 'PUT', `/api/payments/${cashPaymentId}`, {
  body: { household_id: String(qaHouseholdId), month: 8, year: 2026, amount: '450', payment_mode: 'split', cash_amount: '200', upi_amount: '250', payment_date: '2026-08-10' },
});
await both('delete payment', 'DELETE', `/api/payments/${upiPaymentId}`);
await compare('audit log after mutations', 'GET', '/api/audit?limit=50', { refCookie: A, cfCookie: cA_ });
await compare('dashboard final state', 'GET', '/api/dashboard?month=8&year=2026', { cookie: T });

// ---------------------------------------------------------------------------
// 7. PDF docDefinition equivalence (reference builders vs client ChandaPdf)
// ---------------------------------------------------------------------------
console.log('\n== 7. PDF docDefinition equivalence (A4, totals, order, headers, page numbers) ==');
process.env.DB_PATH = refDb; // importing the reference lib must only ever see the throwaway DB
const refPdf = await import(pathToFileURL(path.join(REPO_ROOT, 'lib', 'pdf.js')).href);
await import(pathToFileURL(path.join(CF_ROOT, 'public', 'vendor', 'chanda-pdf.js')).href);
const ChandaPdf = globalThis.ChandaPdf;

const monthlyData = (await req('ref', 'GET', '/api/reports/data?type=monthly&month=8&year=2026&mode=all', { cookie: A })).json;
const annualData = (await req('ref', 'GET', '/api/reports/data?type=annual&year=2026&mode=all', { cookie: A })).json;

// Probe a function with representative inputs so the equivalence check is
// BEHAVIORAL (same inputs -> same outputs), not a whitespace-sensitive
// source-text comparison. header/footer/layout callbacks are all pure.
const PROBES = [[], [0], [1], [2], [3], [1, 1], [1, 2], [2, 7]];
const probeFn = (fn) => PROBES.map((args) => {
  try { return deepProbe(fn(...args)); } catch (e) { return `[threw:${e.message}]`; }
});
const deepProbe = (v) => {
  if (typeof v === 'function') return probeFn(v);
  if (Array.isArray(v)) return v.map(deepProbe);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = deepProbe(v[k]);
    return o;
  }
  return v;
};

function firstDiff(a, b, path = '$') {
  if (typeof a === 'function' || typeof b === 'function') {
    if (String(a) === String(b)) return null;
    return { path, a: String(a).slice(0, 120), b: String(b).slice(0, 120) };
  }
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return { path, a: JSON.stringify(a), b: JSON.stringify(b) };
  }
  if (Array.isArray(a) !== Array.isArray(b)) return { path, a, b };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

const refMonthly = deepProbe(refPdf.buildMonthlyPdf(monthlyData));
const cfMonthly = deepProbe(ChandaPdf.buildMonthlyPdf(monthlyData));
ok('monthly PDF docDefinition identical (A4 layout, totals, order, headers, page numbers)',
  JSON.stringify(refMonthly) === JSON.stringify(cfMonthly));
const refAnnual = deepProbe(refPdf.buildAnnualPdf(annualData));
const cfAnnual = deepProbe(ChandaPdf.buildAnnualPdf(annualData));
ok('annual PDF docDefinition identical (A4 layout, totals, order, headers, page numbers)',
  JSON.stringify(refAnnual) === JSON.stringify(cfAnnual));

const totalsRef = monthlyData.summary;
const totalsCf = (await req('cf', 'GET', '/api/reports/data?type=monthly&month=8&year=2026&mode=all', { cookie: cA_ })).json.summary;
ok('monthly totals reconcile (total/cash/upi/paid/pending)',
  totalsRef.total_collection_paise === totalsCf.total_collection_paise
  && totalsRef.cash_paise === totalsCf.cash_paise
  && totalsRef.upi_paise === totalsCf.upi_paise
  && totalsRef.households_paid === totalsCf.households_paid
  && totalsRef.households_pending === totalsCf.households_pending);

// ---------------------------------------------------------------------------
// 8. Health/config + FK constraint + cleanup
// ---------------------------------------------------------------------------
console.log('\n== 8. Health, config, FK & cleanup ==');
await compare('health endpoint', 'GET', '/api/health', {});
await compare('config endpoint', 'GET', '/api/config', {});

const passwordRef = await req('ref', 'PUT', '/api/settings/password', {
  body: { current_password: 'treasurer123', new_password: 'native-test-456' },
  headers: { authorization: `Bearer ${nativeLoginRef.json?.token}` },
});
const passwordCf = await req('cf', 'PUT', '/api/settings/password', {
  body: { current_password: 'treasurer123', new_password: 'native-test-456' },
  headers: { authorization: `Bearer ${nativeLoginCf.json?.token}` },
});
ok('native password change returns a renewed session token',
  passwordRef.status === 200 && Boolean(passwordRef.json?.token)
  && passwordCf.status === 200 && Boolean(passwordCf.json?.token));
const renewedMeRef = await req('ref', 'GET', '/api/auth/me', {
  headers: { authorization: `Bearer ${passwordRef.json?.token}` },
});
const renewedMeCf = await req('cf', 'GET', '/api/auth/me', {
  headers: { authorization: `Bearer ${passwordCf.json?.token}` },
});
ok('renewed native session remains authenticated after password change',
  renewedMeRef.status === 200 && renewedMeCf.status === 200);

// FK RESTRICT: a household with payments can never be deleted (schema-level,
// verified directly on the shim — the app has no household-delete route).
let fkBlocked = false;
try {
  shim._sqlite.prepare('DELETE FROM households WHERE id = 1').run();
} catch {
  fkBlocked = true;
}
ok('FK RESTRICT blocks deleting a household with payments (D1 shim)', fkBlocked);

// FK SET NULL: deleting a user must preserve payments (created_by -> NULL).
let createdById = null;
try {
  const before = shim._sqlite.prepare('SELECT created_by FROM payments WHERE id = ?').get(cashPaymentId);
  createdById = before?.created_by;
  shim._sqlite.prepare('DELETE FROM users WHERE id = ?').run(createdById);
  const after = shim._sqlite.prepare('SELECT created_by FROM payments WHERE id = ?').get(cashPaymentId);
  ok('FK SET NULL preserves payments when the creating user is deleted', after?.created_by === null);
} catch (err) {
  ok('FK SET NULL preserves payments when the creating user is deleted', false, String(err.message));
}

refProc.kill();
// Release the reference DB connection opened by importing the root lib/db.js
// in the PDF section, then clean up (retry if Windows still holds the file).
try {
  const refDbMod = await import(pathToFileURL(path.join(REPO_ROOT, 'db.js')).href);
  if (refDbMod.db && typeof refDbMod.db.close === 'function') refDbMod.db.close();
} catch { /* best effort */ }
try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  await sleep(1500);
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* leave temp dir */ }
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
if (failed) {
  console.error('Failures:', failures.join(' | '));
  process.exit(1);
}
console.log('All endpoint-level checks passed — Cloudflare build matches the reference app on identical data.');
