import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const auditRouter = new Hono();
auditRouter.use('*', requireAuth, requireRole('admin'));

const VALID_ACTIONS = ['create', 'update', 'delete', 'reset', 'seed'];

// GET /api/audit?entity=&action=&search=&limit=&offset=  (newest first)
auditRouter.get('/', async (c) => {
  const q = c.req.query();
  const entity = ['household', 'payment', 'user'].includes(q.entity) ? q.entity : null;
  const action = VALID_ACTIONS.includes(q.action) ? q.action : null;
  const search = String(q.search ?? '').trim();
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);

  let where = '1=1';
  const params = [];
  if (entity) { where += ' AND entity = ?'; params.push(entity); }
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (search) {
    where += ' AND (user_name LIKE ? OR description LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like);
  }

  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE ${where}`).get(...params)).c;
  const items = await db.prepare(
    `SELECT id, user_id, user_name, action, entity, entity_id, description, details, created_at
       FROM audit_log WHERE ${where}
      ORDER BY id DESC, created_at DESC
      LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return c.json({ total, items });
});

// GET /api/audit/stats
auditRouter.get('/stats', async (c) => {
  const total = (await db.prepare('SELECT COUNT(*) AS c FROM audit_log').get()).c;
  const byAction = await db.prepare('SELECT action, COUNT(*) AS c FROM audit_log GROUP BY action').all();
  const byEntity = await db.prepare('SELECT entity, COUNT(*) AS c FROM audit_log GROUP BY entity').all();
  return c.json({ total, by_action: byAction, by_entity: byEntity });
});
