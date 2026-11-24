import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth, requireRole, createSession, setSessionCookie } from '../auth.js';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../password.js';
import { logAudit } from '../audit.js';
import { demoResetEnabled } from '../env.js';
import { seedSampleData } from '../seed.js';

export const settingsRouter = new Hono();
settingsRouter.use('*', requireAuth);

// GET /api/settings
settingsRouter.get('/', async (c) => {
  const stats = {
    households: (await db.prepare('SELECT COUNT(*) AS c FROM households').get()).c,
    active_households: (await db.prepare("SELECT COUNT(*) AS c FROM households WHERE status = 'active'").get()).c,
    payments: (await db.prepare('SELECT COUNT(*) AS c FROM payments').get()).c,
    users: (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c,
  };
  return c.json({ user: c.get('user'), stats });
});

// PUT /api/settings/password  { current_password, new_password }
settingsRouter.put('/password', async (c) => {
  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const { current_password, new_password } = body;
  if (typeof current_password !== 'string' || !current_password || typeof new_password !== 'string' || !new_password) {
    return c.json({ error: 'Current and new password are required.' }, 400);
  }
  if ([...new_password].length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  }
  if (new_password === current_password) {
    return c.json({ error: 'New password must be different from the current password.' }, 400);
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(c.get('user').id);
  if (!user) return c.json({ error: 'You must be logged in to access this.' }, 401);
  if (!(await verifyPassword(current_password, user.password_hash))) {
    return c.json({ error: 'Current password is incorrect.' }, 400);
  }

  // Invalidate every existing session after a password change, then issue a
  // fresh one for THIS device so the user stays logged in here but is signed
  // out everywhere else (matches the admin password-reset behaviour).
  const newHash = await hashPassword(new_password);
  const [update] = await db.batch([
    { sql: "UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ? AND status = 'active'", params: [newHash, user.id, user.password_hash] },
    { sql: 'DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)', params: [user.id, user.id, newHash] },
  ]);
  if (update.meta.changes !== 1) return c.json({ error: 'Account credentials changed. Sign in again.' }, 401);
  const token = await createSession(user.id, newHash);
  if (!token) return c.json({ error: 'Account credentials changed. Sign in again.' }, 401);
  setSessionCookie(c, token);
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'update',
    entity: 'user',
    entityId: c.get('user').id,
    description: 'Changed their own password',
  });
  return c.json({ ok: true, ...(c.get('authType') === 'bearer' ? { token } : {}) });
});

// PUT /api/settings/profile  { name }
settingsRouter.put('/profile', async (c) => {
  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const name = String(body.name ?? '').trim();
  if (!name) return c.json({ error: 'Name is required.' }, 400);
  if (name.length > 100) return c.json({ error: 'Name is too long.' }, 400);
  await db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, c.get('user').id);
  return c.json({ user: { ...c.get('user'), name } });
});

// POST /api/settings/reset-sample-data (admin only, demo environments only)
// The server ALWAYS rejects this in production — even a direct API call —
// so hiding the button in the UI is never relied on.
settingsRouter.post('/reset-sample-data', requireRole('admin'), async (c) => {
  if (!demoResetEnabled()) {
    return c.json({ error: 'This demo-only action is disabled in this environment.' }, 403);
  }
  // D1 has no interactive transactions — batch is atomic.
  await db.batch([
    { sql: 'DELETE FROM sessions' },
    { sql: 'DELETE FROM audit_log' },
    { sql: 'DELETE FROM payments' },
    { sql: 'DELETE FROM households' },
    { sql: 'DELETE FROM users' },
  ]);
  await seedSampleData();
  // Keep the requester logged in (the reseed recreates the same users).
  const requester = await db.prepare('SELECT id, name FROM users WHERE lower(email) = ?').get(String(c.get('user').email).toLowerCase());
  if (requester) {
    const token = await createSession(requester.id);
    setSessionCookie(c, token);
    await logAudit({
      userId: requester.id,
      userName: requester.name,
      action: 'reset',
      entity: 'system',
      description: 'Reset the entire database to sample data',
    });
  }
  return c.json({ ok: true });
});
