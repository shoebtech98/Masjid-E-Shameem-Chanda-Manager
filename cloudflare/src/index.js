// Masjid E Shameem – Chanda Manager · Cloudflare Worker entry point.
//
// Mirrors the reference server.js: same routes, same JSON shapes, same
// error semantics, same production account bootstrap rules. Differences:
//   - Hono instead of Express
//   - D1 binding instead of node:sqlite (see db.js)
//   - PDF generation is handled by the mobile app;
//     /api/reports/pdf answers 410 for legacy clients
//   - Business dates resolve in Asia/Kolkata (see time.js)
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { loadEnv, isProduction, demoResetEnabled } from './env.js';
import { db, initDb, isEmpty, createUser } from './db.js';
import { logAudit } from './audit.js';
import { seedSampleData, ensureDemoUsers } from './seed.js';
import { configureTime } from './time.js';
import { authRouter } from './routes/auth.js';
import { householdsRouter } from './routes/households.js';
import { paymentsRouter } from './routes/payments.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportsRouter } from './routes/reports.js';
import { settingsRouter } from './routes/settings.js';
import { auditRouter } from './routes/audit.js';
import { usersRouter } from './routes/users.js';

const APP_VERSION = '1.0.0';
const EXPO_WEB_ORIGINS = new Set([
  'http://localhost:8082',
  'http://127.0.0.1:8082',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
]);

/** Account bootstrap — mirrors the reference server.js production rules. */
async function boot(env) {
  const prod = isProduction();

  // Sample households/payments: dev convenience. seedSampleData() is a no-op
  // unless the database is completely empty; in production it only runs when
  // SEED_SAMPLE_DATA=1 is set explicitly.
  if (prod) {
    if (process.env.SEED_SAMPLE_DATA === '1') await seedSampleData();
  } else {
    await seedSampleData();
  }

  if (!prod) {
    await ensureDemoUsers();
  } else if (process.env.SEED_DEMO_USERS === '1' || process.env.SEED_SAMPLE_DATA === '1') {
    await ensureDemoUsers(); // explicit, documented opt-in (idempotent)
  } else if (await isEmpty()) {
    const initialEmail = String(process.env.INITIAL_ADMIN_EMAIL ?? '').trim();
    const initialPassword = process.env.INITIAL_ADMIN_PASSWORD ?? '';
    if (initialEmail && initialPassword) {
      try {
        const admin = await createUser({ name: 'Administrator', email: initialEmail, password: initialPassword, role: 'admin' });
        await logAudit({ userName: 'setup', action: 'create', entity: 'user', entityId: admin.id, description: `Created initial Admin ${admin.email} from INITIAL_ADMIN_* bootstrap` });
        console.warn(`⚠ PRODUCTION: initial Admin created for ${initialEmail} from environment variables. Remove INITIAL_ADMIN_* secrets and change the password immediately.`);
      } catch (err) {
        console.error(`[boot] could not create initial Admin from INITIAL_ADMIN_*: ${err.message}`);
      }
    } else {
      console.warn(
        '⚠ PRODUCTION: no user accounts exist. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD secrets (then remove them) or create accounts from the Users page.'
      );
    }
  }
}

/** Build the Hono app for a given environment (Workers env or test env). */
export async function buildApp(env) {
  loadEnv(env);
  configureTime({ tz: process.env.APP_TZ || 'Asia/Kolkata' });
  await initDb(env);
  await boot(env);

  const app = new Hono();
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  // Expo Web preview only. Production PWA auth remains same-origin; native
  // requests use bearer tokens and omit browser credentials.
  app.use('*', cors({
    origin: (origin) => EXPO_WEB_ORIGINS.has(origin) ? origin : undefined,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));

  // Basic hardening headers (no dependencies) — same three as the reference.
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'same-origin');
    await next();
  });

  app.use('/api/*', bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => c.json({ error: 'Request body is too large.' }, 413),
  }));

  // Lightweight, non-sensitive health probe: process up AND database reachable.
  app.get('/api/health', async (c) => {
    let dbOk = false;
    try {
      await db.prepare('SELECT 1 AS ok').get();
      dbOk = true;
    } catch { /* dbOk stays false */ }
    return c.json(
      dbOk
        ? { ok: true, name: 'Masjid E Shameem – Chanda Manager', version: APP_VERSION, uptime: 0, db: 'ok' }
        : { ok: false, name: 'Masjid E Shameem – Chanda Manager', version: APP_VERSION, uptime: 0, db: 'error' },
      dbOk ? 200 : 503
    );
  });

  // Public, non-sensitive config the frontend needs at boot. Never secrets.
  app.get('/api/config', async (c) => {
    const row = await db.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE lower(email) IN ('treasurer@shameem.example','admin@shameem.example')"
    ).get();
    const demoUsers = row.c > 0;
    return c.json({ demoUsers, demoMode: demoResetEnabled() });
  });

  app.route('/api/auth', authRouter);
  app.route('/api/households', householdsRouter);
  app.route('/api/payments', paymentsRouter);
  app.route('/api/dashboard', dashboardRouter);
  app.route('/api/reports', reportsRouter);
  app.route('/api/settings', settingsRouter);
  app.route('/api/audit', auditRouter);
  app.route('/api/users', usersRouter);

  app.notFound((c) => c.json({ error: 'Not found.' }, 404));

  // Central error handler — never silently fail, never leak internals.
  app.onError((err, c) => {
    const status = Number(err.status || err.statusCode) || 500;
    if (status >= 500) {
      console.error('[error]', err);
    }
    return c.json(
      status >= 500
        ? { error: 'Something went wrong on the server. Please try again.' }
        : { error: 'Bad request.' },
      status
    );
  });

  return app;
}

let cachedApp = null;

export default {
  async fetch(request, env, ctx) {
    if (!cachedApp) {
      cachedApp = await buildApp(env);
    }
    return cachedApp.fetch(request, env, ctx);
  },
};
