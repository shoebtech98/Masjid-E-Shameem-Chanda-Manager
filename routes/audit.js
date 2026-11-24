import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole('admin'));

const VALID_ACTIONS = ['create', 'update', 'delete', 'reset', 'seed'];

// GET /api/audit?entity=household|payment&action=create|update|delete&search=&limit=&offset=
// Newest first.
auditRouter.get('/', (req, res) => {
  const entity = ['household', 'payment', 'user'].includes(req.query.entity) ? req.query.entity : null;
  const action = VALID_ACTIONS.includes(req.query.action) ? req.query.action : null;
  const search = String(req.query.search ?? '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let where = '1=1';
  const params = [];
  if (entity) { where += ' AND entity = ?'; params.push(entity); }
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (search) {
    where += ' AND (user_name LIKE ? OR description LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like);
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE ${where}`).get(...params).c;
  const items = db.prepare(
    `SELECT id, user_id, user_name, action, entity, entity_id, description, details, created_at
       FROM audit_log WHERE ${where}
      ORDER BY id DESC, created_at DESC
      LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ total, items });
});

// GET /api/audit/stats — summary counts for the audit page.
auditRouter.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_log').get().c;
  const byAction = db.prepare('SELECT action, COUNT(*) AS c FROM audit_log GROUP BY action').all();
  const byEntity = db.prepare('SELECT entity, COUNT(*) AS c FROM audit_log GROUP BY entity').all();
  res.json({ total, by_action: byAction, by_entity: byEntity });
});
