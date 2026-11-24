import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { hashPassword } from '../lib/password.js';
import { logAudit } from '../lib/audit.js';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('admin'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_FIELDS = 'id, name, email, role, status, created_at';

function countActiveAdmins() {
  return db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").get().c;
}

/**
 * Safety rule: the application must never allow the last remaining active
 * administrator to be removed or demoted. Returns an error string when the
 * action would leave zero active admins, else null.
 */
function lastAdminError(targetUser) {
  if (targetUser.role !== 'admin' || targetUser.status !== 'active') return null;
  if (countActiveAdmins() <= 1) {
    return 'The last administrator cannot be removed or demoted.';
  }
  return null;
}

// GET /api/users?search= — list all users (admin only).
usersRouter.get('/', (req, res) => {
  const search = String(req.query.search ?? '').trim();
  let sql = `SELECT ${USER_FIELDS} FROM users`;
  const params = [];
  if (search) {
    sql += ' WHERE name LIKE ? OR email LIKE ?';
    const like = `%${search}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY id';
  res.json({ users: db.prepare(sql).all(...params) });
});

// POST /api/users — create a new account (admin only).
usersRouter.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const role = req.body?.role === 'admin' ? 'admin' : 'treasurer';

  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (name.length > 100) return res.status(400).json({ error: 'Name is too long (max 100 characters).' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const clash = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (clash) return res.status(409).json({ error: 'A user with this email already exists.' });

  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, hashPassword(password), role, new Date().toISOString());

  const user = db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(Number(info.lastInsertRowid));
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'create',
    entity: 'user',
    entityId: user.id,
    description: `Created ${user.role} account for ${user.name} (${user.email})`,
    details: user,
  });
  res.status(201).json({ user });
});

// PUT /api/users/:id/password — reset a user's password (admin only).
// Ends the user's existing sessions so the change takes effect immediately.
usersRouter.put('/:id(\\d+)/password', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const password = String(req.body?.new_password ?? '');
  if (password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'update',
    entity: 'user',
    entityId: id,
    description: `Reset password for ${user.name} (${user.email})`,
  });
  res.json({ ok: true });
});

// PUT /api/users/:id — change role and/or activate/deactivate (admin only).
// Role changes take effect immediately: every request re-reads the role from
// the database, so existing sessions respect the new role right away.
// Deactivation ends their sessions; the account can no longer log in.
usersRouter.put('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const body = req.body ?? {};
  const wantsRole = body.role === 'admin' || body.role === 'treasurer';
  const newRole = wantsRole ? body.role : user.role;
  const wantsStatus = body.status === 'active' || body.status === 'inactive';
  const newStatus = wantsStatus ? body.status : user.status;

  if (id === req.user.id && wantsRole && newRole !== user.role) {
    return res.status(400).json({ error: 'You cannot change your own role. Ask another administrator.' });
  }
  if (id === req.user.id && newStatus === 'inactive' && user.status === 'active') {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' });
  }

  // Last-admin protection: demoting or deactivating an admin must never leave
  // zero active administrators.
  if ((newRole !== user.role || newStatus === 'inactive') && user.role === 'admin') {
    const err = lastAdminError(user);
    if (err) return res.status(400).json({ error: err });
  }

  if (newRole !== user.role || newStatus !== user.status) {
    db.prepare('UPDATE users SET role = ?, status = ? WHERE id = ?').run(newRole, newStatus, id);
    if (newStatus === 'inactive' && user.status === 'active') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    const bits = [];
    if (newRole !== user.role) bits.push(`role changed to ${newRole}`);
    if (newStatus !== user.status) bits.push(newStatus === 'inactive' ? 'deactivated' : 'activated');
    logAudit({
      userId: req.user.id,
      userName: req.user.name,
      action: 'update',
      entity: 'user',
      entityId: id,
      description: `${bits.join(' and ')} for ${user.name} (${user.email})`,
    });
  }

  const updated = db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(id);
  res.json({ user: updated });
});

// DELETE /api/users/:id — delete a user (admin only).
// Financial records created by the user are preserved: payments.created_by is
// SET NULL by the foreign key, and the audit trail keeps the user's name
// snapshot, so history stays intact and attributable.
usersRouter.delete('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }

  const err = lastAdminError(user);
  if (err) return res.status(400).json({ error: err });

  // Sanity guard: never allow deletion while payments reference the user
  // (the FK is ON DELETE SET NULL, but double-check for safety).
  const referenced = db.prepare('SELECT COUNT(*) AS c FROM payments WHERE created_by = ?').get(id).c;
  if (referenced > 0) {
    db.prepare('UPDATE payments SET created_by = NULL WHERE created_by = ?').run(id);
  }

  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'delete',
    entity: 'user',
    entityId: id,
    description: `Deleted account for ${user.name} (${user.email})`,
  });
  res.json({ ok: true });
});
