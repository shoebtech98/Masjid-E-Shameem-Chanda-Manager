import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../password.js';
import { logAudit } from '../audit.js';
import { isoNow } from '../time.js';

export const usersRouter = new Hono();
usersRouter.use('*', requireAuth, requireRole('admin'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_FIELDS = 'id, name, email, role, status, created_at';

// Check the invariant in the same SQL statement as the write so concurrent
// admin requests cannot both pass a check against the same earlier state.
const canRemoveAdmin = `(
  role <> 'admin' OR status <> 'active' OR EXISTS (
    SELECT 1 FROM users AS other
    WHERE other.role = 'admin' AND other.status = 'active' AND other.id <> users.id
  )
)`;
const lastAdminError = 'The last administrator cannot be removed or demoted.';

// GET /api/users?search=
usersRouter.get('/', async (c) => {
  const search = String(c.req.query('search') ?? '').trim();
  let sql = `SELECT ${USER_FIELDS} FROM users`;
  const params = [];
  if (search) {
    sql += ' WHERE name LIKE ? OR email LIKE ?';
    const like = `%${search}%`;
    params.push(like, like);
  }
  sql += ' ORDER BY id';
  return c.json({ users: await db.prepare(sql).all(...params) });
});

// POST /api/users — create a new account (admin only).
usersRouter.post('/', async (c) => {
  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = body.password;
  const role = body.role === 'admin' ? 'admin' : 'treasurer';

  if (!name) return c.json({ error: 'Name is required.' }, 400);
  if (name.length > 100) return c.json({ error: 'Name is too long (max 100 characters).' }, 400);
  if (!EMAIL_RE.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
  if (body.role !== undefined && body.role !== 'admin' && body.role !== 'treasurer') {
    return c.json({ error: 'Select a valid account role.' }, 400);
  }
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  }

  const clash = await db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (clash) return c.json({ error: 'A user with this email already exists.' }, 409);

  const info = await db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, await hashPassword(password), role, isoNow());

  const user = await db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(Number(info.lastInsertRowid));
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'create',
    entity: 'user',
    entityId: user.id,
    description: `Created ${user.role} account for ${user.name} (${user.email})`,
    details: user,
  });
  return c.json({ user }, 201);
});

// PUT /api/users/:id/password — reset a user's password (admin only).
usersRouter.put('/:id/password', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return c.json({ error: 'User not found.' }, 404);

  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const password = body.new_password;
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
  }

  await db.batch([
    { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', params: [await hashPassword(password), id] },
    { sql: 'DELETE FROM sessions WHERE user_id = ?', params: [id] },
  ]);
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'update',
    entity: 'user',
    entityId: id,
    description: `Reset password for ${user.name} (${user.email})`,
  });
  return c.json({ ok: true });
});

// PUT /api/users/:id — change role and/or activate/deactivate (admin only).
usersRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return c.json({ error: 'User not found.' }, 404);

  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);

  const wantsRole = body.role === 'admin' || body.role === 'treasurer';
  if (body.role !== undefined && !wantsRole) return c.json({ error: 'Select a valid account role.' }, 400);
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive') {
    return c.json({ error: 'Select a valid account status.' }, 400);
  }
  const newRole = wantsRole ? body.role : user.role;
  const wantsStatus = body.status === 'active' || body.status === 'inactive';
  const newStatus = wantsStatus ? body.status : user.status;

  if (id === c.get('user').id && wantsRole && newRole !== user.role) {
    return c.json({ error: 'You cannot change your own role. Ask another administrator.' }, 400);
  }
  if (id === c.get('user').id && newStatus === 'inactive' && user.status === 'active') {
    return c.json({ error: 'You cannot deactivate your own account.' }, 400);
  }

  if (newRole !== user.role || newStatus !== user.status) {
    const keepsActiveAdmin = newRole === 'admin' && newStatus === 'active';
    const result = await db.prepare(
      `UPDATE users SET role = ?, status = ? WHERE id = ? AND (? OR ${canRemoveAdmin})`
    ).run(newRole, newStatus, id, Number(keepsActiveAdmin));
    if (!result.changes) return c.json({ error: lastAdminError }, 400);
    if (newStatus === 'inactive' && user.status === 'active') {
      await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    const bits = [];
    if (newRole !== user.role) bits.push(`role changed to ${newRole}`);
    if (newStatus !== user.status) bits.push(newStatus === 'inactive' ? 'deactivated' : 'activated');
    await logAudit({
      userId: c.get('user').id,
      userName: c.get('user').name,
      action: 'update',
      entity: 'user',
      entityId: id,
      description: `${bits.join(' and ')} for ${user.name} (${user.email})`,
    });
  }

  const updated = await db.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).get(id);
  return c.json({ user: updated });
});

// DELETE /api/users/:id — delete a user (admin only).
usersRouter.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return c.json({ error: 'User not found.' }, 404);

  if (id === c.get('user').id) {
    return c.json({ error: 'You cannot delete your own account.' }, 400);
  }

  // Foreign keys clear session rows and preserve payments with a null author.
  const result = await db.prepare(`DELETE FROM users WHERE id = ? AND ${canRemoveAdmin}`).run(id);
  if (!result.changes) return c.json({ error: lastAdminError }, 400);
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'delete',
    entity: 'user',
    entityId: id,
    description: `Deleted account for ${user.name} (${user.email})`,
  });
  return c.json({ ok: true });
});
