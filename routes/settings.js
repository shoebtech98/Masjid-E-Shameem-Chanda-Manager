import { Router } from 'express';
import { db, seedSampleData } from '../db.js';
import { requireAuth, requireRole, createSession, sessionCookieOptions } from '../auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { logAudit } from '../lib/audit.js';
import { demoResetEnabled } from '../env.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

// GET /api/settings
settingsRouter.get('/', (req, res) => {
  const stats = {
    households: db.prepare('SELECT COUNT(*) AS c FROM households').get().c,
    active_households: db.prepare("SELECT COUNT(*) AS c FROM households WHERE status = 'active'").get().c,
    payments: db.prepare('SELECT COUNT(*) AS c FROM payments').get().c,
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
  };
  res.json({ user: req.user, stats });
});

// PUT /api/settings/password  { current_password, new_password }
settingsRouter.put('/password', (req, res) => {
  const { current_password, new_password } = req.body ?? {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  // Invalidate every existing session after a password change, then issue a
  // fresh one for THIS device so the user stays logged in here but is signed
  // out everywhere else (matches the admin password-reset behaviour).
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
  const token = createSession(req.user.id);
  res.cookie('session', token, sessionCookieOptions());
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'update',
    entity: 'user',
    entityId: req.user.id,
    description: 'Changed their own password',
  });
  res.json({ ok: true, ...(req.authType === 'bearer' ? { token } : {}) });
});

// PUT /api/settings/profile  { name }
settingsRouter.put('/profile', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (name.length > 100) return res.status(400).json({ error: 'Name is too long.' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: { ...req.user, name } });
});

// POST /api/settings/reset-sample-data (admin only, demo environments only)
// Wipes households (payments cascade) and reseeds the sample data set.
// The client shows a strong confirmation before calling this.
//
// The server ALWAYS rejects this in production — even a direct API call —
// so hiding the button in the UI is never relied on. See env.js demoResetEnabled().
settingsRouter.post('/reset-sample-data', requireRole('admin'), (req, res) => {
  if (!demoResetEnabled()) {
    return res.status(403).json({ error: 'This demo-only action is disabled in this environment.' });
  }
  db.exec('BEGIN');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM audit_log');
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM households');
  db.exec('DELETE FROM users');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','households','payments','audit_log')");
  db.exec('COMMIT');
  seedSampleData();
  // Keep the requester logged in (the reseed recreates the same users).
  const requester = db.prepare('SELECT id, name FROM users WHERE lower(email) = ?').get(String(req.user.email).toLowerCase());
  if (requester) {
    const token = createSession(requester.id);
    res.cookie('session', token, sessionCookieOptions());
    logAudit({
      userId: requester.id,
      userName: requester.name,
      action: 'reset',
      entity: 'system',
      description: 'Reset the entire database to sample data',
    });
  }
  res.json({ ok: true });
});
