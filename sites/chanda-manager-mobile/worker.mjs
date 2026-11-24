const backend = 'https://masjid-shameem-staging.kingshoaib.workers.dev';
const cookieName = '__Host-chanda-admin-staging';
const protectedRoutes = [
  ['GET', /^\/api\/users$/],
  ['POST', /^\/api\/users$/],
  ['PUT', /^\/api\/users\/\d+(?:\/password)?$/],
  ['DELETE', /^\/api\/users\/\d+$/],
  ['GET', /^\/api\/audit(?:\/stats)?$/],
  ['GET', /^\/api\/(?:dashboard|households(?:\/\d+)?|payments\/\d+|reports\/data|settings)$/],
  ['POST', /^\/api\/(?:households|payments)$/],
  ['PUT', /^\/api\/(?:households\/\d+|payments\/\d+|settings\/(?:profile|password))$/],
  ['DELETE', /^\/api\/payments\/\d+$/],
];
const sessionToken = /^[a-f0-9]{64}$/i;
const baseHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function cookie(token = '') {
  return cookieName + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (token ? 28800 : 0);
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { ...baseHeaders, ...headers } });
}

function userFields(user) {
  if (!user) return user;
  const { id, name, email, role, status, created_at } = user;
  return { id, name, email, role, status, created_at };
}

function recordFields(pathname, data) {
  if (pathname === '/api/audit' && Array.isArray(data.items)) {
    return {
      total: data.total,
      items: data.items.map(({ id, action, entity, description, user_name, created_at }) =>
        ({ id, action, entity, description, user_name, created_at })),
    };
  }
  if (pathname === '/api/users' && Array.isArray(data.users)) {
    return { users: data.users.map(userFields) };
  }
  if ((pathname.startsWith('/api/users') || pathname.startsWith('/api/settings')) && data.user) {
    return { user: userFields(data.user) };
  }
  return data;
}

async function upstream(path, method = 'GET', token, body) {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const target = new URL(backend + path);
  const options = { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(12000) };
  let response;
  try {
    response = await fetch(target.href, options);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = location ? new URL(location, target) : null;
      const sameEndpoint = next && next.origin === target.origin && !next.username && !next.password
        && next.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '')
        && next.search === target.search && !next.hash;
      if (sameEndpoint && next.href !== target.href && [301, 302, 307, 308].includes(response.status)) {
        response = await fetch(next.href, options);
      } else {
        console.error('Chanda API rejected redirect', response.status, next?.hostname || 'no-location');
        throw new Error('Unexpected API redirect');
      }
    }
  } catch (error) {
    const reason = String(error?.message || '').match(/network|blocked|denied|forbidden|outbound|disallowed|connection|redirect|timeout|subrequest|unsupported|failed|not allowed|not implemented/gi);
    console.error('Chanda API transport failed', error?.name || 'Error', reason?.join(' ') || 'unclassified');
    throw error;
  }
  const type = response.headers.get('content-type') || '';
  if (!/^application\/json\b/i.test(type) && path !== '/api/auth/logout') {
    const edgeCode = /^text\/html\b/i.test(type)
      ? (await response.text()).match(/(?:Error\s+|error code:\s*)(\d{4})\b/i)?.[1]
      : undefined;
    console.error('Chanda API returned a non-JSON response', response.status, edgeCode || '');
    throw new Error('Chanda API returned a non-JSON response');
  }
  return response;
}

async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const decoder = new TextDecoder();
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

async function api(request, url) {
  const { pathname, search, origin } = url;
  const { method } = request;
  if (method !== 'GET' && request.headers.get('origin') !== origin) {
    return json({ error: 'This request must come from the administration page.' }, 403);
  }

  if (pathname === '/api/session' && method === 'POST') {
    const body = await readBody(request);
    if (!body) return json({ error: 'A JSON sign-in request is required.' }, 400);
    const response = await upstream('/api/auth/mobile-login', 'POST', undefined, body);
    const result = await response.json();
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      return json({ error: result.error || 'Sign-in failed.' }, response.status, retry ? { 'Retry-After': retry } : {});
    }
    if (!sessionToken.test(result.token || '')) throw Error('Invalid upstream session');
    if (result.user?.role !== 'admin') {
      await upstream('/api/auth/logout', 'POST', result.token).catch(() => {});
      return json({ error: 'An administrator account is required.' }, 403);
    }
    return json({ user: userFields(result.user) }, 200, { 'Set-Cookie': cookie(result.token) });
  }

  const token = request.headers.get('cookie')?.split(';')
    .map((part) => part.trim()).find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const clearCookie = { 'Set-Cookie': cookie() };
  if (pathname === '/api/session' && method === 'DELETE') {
    if (sessionToken.test(token || '')) await upstream('/api/auth/logout', 'POST', token).catch(() => {});
    return json({ ok: true }, 200, clearCookie);
  }
  const isSession = pathname === '/api/session' && method === 'GET';
  if (!isSession && !protectedRoutes.some(([verb, route]) => method === verb && route.test(pathname))) {
    return json({ error: 'Not found.' }, 404);
  }
  if (!sessionToken.test(token || '')) return json({ error: 'Sign in as an administrator.' }, 401, clearCookie);
  const session = await upstream('/api/auth/me', 'GET', token);
  if (session.status === 401) return json({ error: 'Your session has expired. Sign in again.' }, 401, clearCookie);
  if (!session.ok) throw Error('Could not verify session');
  const { user } = await session.json();
  if (user?.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403, clearCookie);
  if (isSession) return json({ user: userFields(user) });

  let body;
  if (method === 'POST' || method === 'PUT') {
    body = await readBody(request);
    if (!body) return json({ error: 'A JSON request is required.' }, 400);
  }
  const result = await upstream(pathname + search, method, token, body);
  if (result.status >= 500) throw Error('Upstream error');
  const data = await result.json();
  if (pathname === '/api/settings/password' && result.ok) {
    if (!sessionToken.test(data.token || '')) throw Error('Missing replacement session');
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(data.token) });
  }
  return json(recordFields(pathname, data), result.status);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(request, url);
      } catch (error) {
        console.error('Chanda admin request failed', error?.name || 'Error');
        return json({ error: 'Chanda Manager is temporarily unavailable. Try again shortly.' }, 502);
      }
    }
    const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : null;
    if (!asset || !['GET', 'HEAD'].includes(request.method)) return json({ error: 'Not found.' }, 404);
    return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.body), (byte) => byte.charCodeAt(0)), {
      headers: { ...baseHeaders, 'Content-Type': asset.type },
    });
  },
};
