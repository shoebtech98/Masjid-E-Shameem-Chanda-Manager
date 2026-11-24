import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { validateHousehold } from '../validate.js';
import { toPaise } from '../amounts.js';
import { logAudit } from '../audit.js';
import { currentMonthYear, monthLabel, isoNow, tzMonthOfInstant } from '../time.js';

export const householdsRouter = new Hono();
householdsRouter.use('*', requireAuth);

const FIELDS = 'id, house_no, name, phone, monthly_amount, status, created_at, updated_at';

// GET /api/households?search=&status=&limit=&offset=
householdsRouter.get('/', async (c) => {
  const q = c.req.query();
  const search = String(q.search ?? '').trim();
  const status = q.status === 'all' ? null : q.status === 'inactive' ? 'inactive' : 'active';
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);

  let where = '1=1';
  const params = [];
  if (search) {
    where += ' AND (house_no LIKE ? OR name LIKE ? OR phone LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM households WHERE ${where}`).get(...params)).c;
  const items = await db.prepare(
    `SELECT ${FIELDS} FROM households WHERE ${where} ORDER BY house_no LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return c.json({ total, items });
});

// POST /api/households
householdsRouter.post('/', async (c) => {
  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const errors = validateHousehold(body);
  if (errors.length) return c.json({ error: errors[0], errors }, 400);

  const houseNo = String(body.house_no).trim();
  const existing = await db.prepare('SELECT id FROM households WHERE house_no = ?').get(houseNo);
  if (existing) {
    return c.json({ error: `House number "${houseNo}" already exists.` }, 409);
  }

  const now = isoNow();
  const info = await db.prepare(
    `INSERT INTO households (house_no, name, phone, monthly_amount, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    houseNo,
    String(body.name).trim(),
    String(body.phone ?? '').trim() || null,
    toPaise(body.monthly_amount),
    body.status === 'inactive' ? 'inactive' : 'active',
    now,
    now
  );

  const household = await db.prepare(`SELECT ${FIELDS} FROM households WHERE id = ?`).get(Number(info.lastInsertRowid));
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'create',
    entity: 'household',
    entityId: household.id,
    description: `Created household ${household.house_no} (${household.name})`,
    details: household,
  });
  return c.json({ household }, 201);
});

// GET /api/households/:id  (household + summary + full payment history)
householdsRouter.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const household = await db.prepare(`SELECT ${FIELDS} FROM households WHERE id = ?`).get(id);
  if (!household) return c.json({ error: 'Household not found.' }, 404);

  const payments = await db.prepare(
    `SELECT p.*, h.house_no, h.name AS household_name
       FROM payments p
       JOIN households h ON h.id = p.household_id
      WHERE p.household_id = ?
      ORDER BY p.year DESC, p.month DESC, p.payment_date DESC, p.id DESC`
  ).all(id);

  const totals = await db.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_paise FROM payments WHERE household_id = ?`
  ).get(id);

  const { month: curMonth, year: curYear } = currentMonthYear();

  const curMonthRow = await db.prepare(
    'SELECT * FROM payments WHERE household_id = ? AND month = ? AND year = ?'
  ).get(id, curMonth, curYear);

  const curYearTotal = (await db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total_paise FROM payments WHERE household_id = ? AND year = ?'
  ).get(id, curYear)).total_paise;

  const lastPayment = payments[0] ?? null;

  // Months paid: distinct (month, year) combinations.
  const monthsPaid = (await db.prepare(
    'SELECT COUNT(*) AS c FROM (SELECT DISTINCT month, year FROM payments WHERE household_id = ?)'
  ).get(id)).c;

  // Pending months: calendar months from the household's creation month (or
  // first payment, whichever is earlier) through the current month, minus the
  // months actually paid. Month boundaries use Asia/Kolkata (time.js).
  const firstPayment = await db.prepare(
    'SELECT month, year FROM payments WHERE household_id = ? ORDER BY year ASC, month ASC LIMIT 1'
  ).get(id);
  const created = tzMonthOfInstant(household.created_at) ?? { month: 1, year: 2000 };
  let startMonth = created.month;
  let startYear = created.year;
  if (firstPayment) {
    if (firstPayment.year < startYear || (firstPayment.year === startYear && firstPayment.month < startMonth)) {
      startMonth = firstPayment.month;
      startYear = firstPayment.year;
    }
  }
  let totalMonthsSince = 0;
  let m = startMonth;
  let y = startYear;
  while (y < curYear || (y === curYear && m <= curMonth)) {
    totalMonthsSince += 1;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const monthsPending = Math.max(totalMonthsSince - monthsPaid, 0);

  const summary = {
    total_payments: totals.count,
    total_amount_paise: totals.total_paise,
    current_year_paise: curYearTotal,
    current_month: curMonthRow
      ? { paid: true, amount_paise: curMonthRow.amount, payment_mode: curMonthRow.payment_mode, payment_date: curMonthRow.payment_date }
      : { paid: false },
    last_payment_date: lastPayment ? lastPayment.payment_date : null,
    months_paid: monthsPaid,
    months_pending: monthsPending,
    current_month_label: monthLabel(curMonth, curYear),
  };

  return c.json({ household, payments, summary });
});

// PUT /api/households/:id
householdsRouter.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'Not found.' }, 404);
  const household = await db.prepare(`SELECT * FROM households WHERE id = ?`).get(id);
  if (!household) return c.json({ error: 'Household not found.' }, 404);

  let body = null;
  try { body = await c.req.json(); } catch { /* 400 below */ }
  if (!body || typeof body !== 'object') return c.json({ error: 'Invalid JSON in request body.' }, 400);
  const errors = validateHousehold({ ...household, ...body });
  if (errors.length) return c.json({ error: errors[0], errors }, 400);

  const houseNo = String(body.house_no).trim();
  const clash = await db.prepare('SELECT id FROM households WHERE house_no = ? AND id != ?').get(houseNo, id);
  if (clash) {
    return c.json({ error: `House number "${houseNo}" already exists for another household.` }, 409);
  }

  await db.prepare(
    `UPDATE households SET house_no = ?, name = ?, phone = ?, monthly_amount = ?, status = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    houseNo,
    String(body.name).trim(),
    String(body.phone ?? '').trim() || null,
    toPaise(body.monthly_amount),
    body.status === 'inactive' ? 'inactive' : 'active',
    isoNow(),
    id
  );

  const updated = await db.prepare(`SELECT ${FIELDS} FROM households WHERE id = ?`).get(id);
  await logAudit({
    userId: c.get('user').id,
    userName: c.get('user').name,
    action: 'update',
    entity: 'household',
    entityId: id,
    description: `Updated household ${updated.house_no} (${updated.name})`,
    details: { before: household, after: updated },
  });
  return c.json({ household: updated });
});
