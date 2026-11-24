import assert from 'node:assert/strict';
import { buildApp } from '../src/index.js';
import { createUser } from '../src/db.js';
import { createD1Shim } from './d1-shim.mjs';

const allowedOrigin = 'http://localhost:8082';
const app = await buildApp({
  DB: createD1Shim(),
  NODE_ENV: 'production',
  DEMO_MODE: 'true',
});

async function request(path, { method = 'GET', origin = allowedOrigin, headers = {}, body } = {}) {
  const requestHeaders = new Headers(headers);
  if (origin) requestHeaders.set('Origin', origin);
  return app.fetch(new Request(`https://worker.test${path}`, {
    method,
    headers: requestHeaders,
    body,
  }), {});
}

console.log('\n== Expo Web CORS ==');

{
  const response = await request('/');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Not found.' });
  console.log('  ✓ API Worker has no website at the root');
}

{
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).db, 'ok');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  console.log('  ✓ health endpoint returns data and allows the Expo Web origin');
}

{
  const response = await request('/api/auth/me');
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  console.log('  ✓ authentication errors retain CORS headers');
}

{
  const response = await request('/api/health', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  assert.deepEqual(
    response.headers.get('Access-Control-Allow-Methods').split(',').map((value) => value.trim()),
    ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  );
  const allowedHeaders = response.headers.get('Access-Control-Allow-Headers').toLowerCase();
  assert.match(allowedHeaders, /content-type/);
  assert.match(allowedHeaders, /authorization/);
  assert.equal(response.headers.get('Access-Control-Max-Age'), '600');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
  console.log('  ✓ preflight allows API methods and required headers without cookies');
}

{
  const response = await request('/api/health', { origin: 'https://unapproved.example' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  console.log('  ✓ unapproved origins receive no allow-origin header');
}

{
  for (const origin of [
    'http://localhost:8082',
    'http://127.0.0.1:8082',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
  ]) {
    const response = await request('/api/health', { origin });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
  console.log('  ✓ all four configured Expo Web origins are allowed');
}

{
  const response = await request('/api/health', {
    method: 'OPTIONS',
    origin: 'https://unapproved.example',
    headers: { 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  console.log('  ✓ unapproved preflight origins receive no allow-origin header');
}

{
  const created = await createUser({
    name: 'CORS Test Admin',
    email: 'cors-test@example.org',
    password: 'cors-test-password',
    role: 'admin',
  });
  assert.equal(created.role, 'admin');

  const login = await request('/api/auth/mobile-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: created.email, password: 'cors-test-password' }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  const loginData = await login.json();
  assert.equal(loginData.user.id, created.id);
  assert.equal(typeof loginData.token, 'string');

  const me = await request('/api/auth/me', {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  assert.equal((await me.json()).user.email, created.email);

  const browserLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: created.email, password: 'cors-test-password' }),
  });
  assert.equal(browserLogin.status, 200);
  const cookie = browserLogin.headers.get('Set-Cookie');
  assert.match(cookie || '', /session=/);
  assert.equal(browserLogin.headers.get('Access-Control-Allow-Credentials'), null);
  const browserMe = await request('/api/auth/me', {
    headers: { Cookie: cookie.split(';', 1)[0] },
  });
  assert.equal(browserMe.status, 200);
  assert.equal((await browserMe.json()).user.email, created.email);
  assert.equal(browserMe.headers.get('Cache-Control'), 'no-store');

  const config = await request('/api/config');
  assert.equal((await config.json()).demoMode, false);
  const reset = await request('/api/settings/reset-sample-data', {
    method: 'POST',
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  assert.equal(reset.status, 403);

  const oversized = await request('/api/auth/mobile-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'fixture@example.org', password: 'a'.repeat(1024 * 1024) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
  console.log('  ✓ mobile bearer and existing browser cookie authentication remain unchanged');
}

console.log('\nALL CORS TESTS PASSED\n');
