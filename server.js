import './env.js'; // loads .env before any process.env.* reads
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, initDb, seedSampleData, ensureDemoUsers, isEmpty, createUser } from './db.js';
import { logAudit } from './lib/audit.js';
import { demoResetEnabled } from './env.js';
import { authRouter } from './routes/auth.js';
import { householdsRouter } from './routes/households.js';
import { paymentsRouter } from './routes/payments.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportsRouter } from './routes/reports.js';
import { settingsRouter } from './routes/settings.js';
import { auditRouter } from './routes/audit.js';
import { usersRouter } from './routes/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const APP_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

initDb();

// Sample households/payments: a dev-only convenience. seedSampleData() is a
// no-op unless the database is completely empty, and in production it only
// runs when SEED_SAMPLE_DATA=1 is set explicitly — financial sample data is
// never silently injected into a production database.
const seeded = IS_PRODUCTION
  ? (process.env.SEED_SAMPLE_DATA === '1' ? seedSampleData() : false)
  : seedSampleData();
if (seeded) {
  if (IS_PRODUCTION) {
    console.warn('⚠ PRODUCTION: sample data was seeded because SEED_SAMPLE_DATA=1. Remove the flag and reset the database before real use.');
  } else {
    console.log('Sample data created. Demo logins: treasurer@shameem.example / treasurer123 · admin@shameem.example / admin123');
  }
}

// Account bootstrap.
//  - Development: demo accounts are always ensured (local convenience).
//  - Production: demo accounts are NEVER created automatically. The first
//    real Admin comes from INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD (one
//    time, only on a database with no users), or the operator creates it with
//    `npm run create-user`. SEED_DEMO_USERS=1 is an explicit testing opt-in.
if (!IS_PRODUCTION) {
  ensureDemoUsers();
} else if (process.env.SEED_DEMO_USERS === '1' || process.env.SEED_SAMPLE_DATA === '1') {
  ensureDemoUsers(); // explicit, documented opt-in (idempotent)
} else if (isEmpty()) {
  const initialEmail = String(process.env.INITIAL_ADMIN_EMAIL ?? '').trim();
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD ?? '';
  if (initialEmail && initialPassword) {
    try {
      const admin = createUser({ name: 'Administrator', email: initialEmail, password: initialPassword, role: 'admin' });
      logAudit({ userName: 'setup', action: 'create', entity: 'user', entityId: admin.id, description: `Created initial Admin ${admin.email} from INITIAL_ADMIN_* bootstrap` });
      console.warn(`⚠ PRODUCTION: initial Admin created for ${initialEmail} from environment variables. Remove INITIAL_ADMIN_* from .env and change the password in Settings immediately.`);
    } catch (err) {
      console.error(`[boot] could not create initial Admin from INITIAL_ADMIN_*: ${err.message}`);
    }
  } else {
    console.warn(
      '⚠ PRODUCTION: no user accounts exist. Create the first Admin with:\n' +
      '    npm run create-user -- --name "Admin Name" --email admin@example.org --role admin\n' +
      '  or set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in .env and restart.'
    );
  }
}

const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Behind a reverse proxy (nginx/Caddy/Traefik) that terminates TLS, express
// must trust the proxy so req.secure and Secure cookies work correctly.
app.set('trust proxy', IS_PRODUCTION ? 1 : false);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Basic hardening headers (no dependencies).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  );
  next();
});

// Lightweight, non-sensitive health probe: confirms the process is up AND
// the database is reachable. Safe to expose publicly (load balancer checks).
app.get('/api/health', (req, res) => {
  let dbOk = false;
  try {
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch { /* dbOk stays false */ }
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    name: 'Masjid E Shameem – Chanda Manager',
    version: APP_VERSION,
    uptime: Math.round(process.uptime()),
    db: dbOk ? 'ok' : 'error',
  });
});

// Public, non-sensitive config the frontend needs at boot (e.g. whether to
// show the demo-credentials hint). Never contains secrets.
app.get('/api/config', (req, res) => {
  const demoUsers = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE lower(email) IN ('treasurer@shameem.example','admin@shameem.example')"
  ).get().c > 0;
  res.json({ demoUsers, demoMode: demoResetEnabled() });
});

app.use('/api/auth', authRouter);
app.use('/api/households', householdsRouter);
app.use('/api/payments', paymentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/users', usersRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

// Central error handler — never silently fail, never leak internals.
// Client-caused errors (e.g. malformed JSON -> 400) keep their status; real
// server errors become a generic 500. Full details go to the server log only.
app.use((err, req, res, next) => {
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  if (res.headersSent) return next(err);
  res.status(status).json({
    error: status >= 500
      ? 'Something went wrong on the server. Please try again.'
      : (err.type === 'entity.parse.failed' ? 'Invalid JSON in request body.' : 'Bad request.'),
  });
});

const envPort = Number(process.env.PORT);
const PORT = Number.isInteger(envPort) && envPort > 0 ? envPort : 3000;
app.listen(PORT, () => {
  console.log(`Masjid E Shameem – Chanda Manager running at http://localhost:${PORT}`);
});
