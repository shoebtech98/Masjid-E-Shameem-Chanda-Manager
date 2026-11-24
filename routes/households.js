import { Router } from 'express';
import { db, currentMonthYear, monthLabel } from '../db.js';
import { requireAuth } from '../auth.js';
import { validateHousehold } from '../lib/validate.js';
import { toPaise } from '../lib/amounts.js';
import { logAudit } from '../lib/audit.js';

export const householdsRouter = Router();
householdsRouter.use(requireAuth);

const FIELDS = 'id, house_no, name, phone, monthly_amount, status, created_at, updated_at';

// GET /api/households?search=&status=&limit=&offset=
householdsRouter.get('/', (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const status = req.query.status === 'all' ? null : req.query.status === 'inactive' ? 'inactive' : 'active';
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

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

  const total = db.prepare(`SELECT COUNT(*) AS c FROM households WHERE ${where}`).get(...params).c;
  const items = db.prepare(
    `SELECT ${FIELDS} FROM households WHERE ${where} ORDER BY house_no LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ total, items });
});

// POST /api/households
householdsRouter.post('/', (req, res) => {
  const body = req.body ?? {};
  const errors = validateHousehold(body);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const houseNo = String(body.house_no).trim();
  const existing = db.prepare('SELECT id FROM households WHERE house_no = ?').get(houseNo);
  if (existing) {
    return res.status(409).json({ error: `House number "${houseNo}" already exists.` });
  }

  const now = new Date().toISOString();
  const info = db.prepare(
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

  const household = db.prepare(`SELECT ${FIELDS} FROM households WHERE id = ?`).get(Number(info.lastInsertRowid));
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'create',
    entity: 'household',
    entityId: household.id,
    description: `Created household ${household.house_no} (${household.name})`,
    details: household,
  });
  res.status(201).json({ household });
});

// GET /api/households/:id  (household + summary + full payment history)
householdsRouter.get('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  const household = db.prepare(`SELECT ${FIELDS} FROM households WHERE id = ?`).get(id);
  if (!household) return res.status(404).json({ error: 'Household not found.' });

  const payments = db.prepare(
    `SELECT p.*, h.house_no, h.name AS household_name
       FROM payments p
       JOIN households h ON h.id = p.household_id
      WHERE p.household_id = ?
      ORDER BY p.year DESC, p.month DESC, p.payment_date DESC, p.id DESC`
  ).all(id);

  const totals = db.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total_paise FROM payments WHERE household_id = ?`
  ).get(id);

  const { month: curMonth, year: curYear } = currentMonthYear();

  const curMonthRow = db.prepare(
    'SELECT * FROM payments WHERE household_id = ? AND month = ? AND year = ?'
  ).get(id, curMonth, curYear);

  const curYearTotal = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total_paise FROM payments WHERE household_id = ? AND year = ?'
  ).get(id, curYear).total_paise;

  const lastPayment = payments[0] ?? null;

  // Months paid: distinct (month, year) combinations.
  const monthsPaid = db.prepare(
    'SELECT COUNT(*) AS c FROM (SELECT DISTINCT month, year FROM payments WHERE household_id = ?)'
  ).get(id).c;

  // Pending months: calendar months from the household's creation month (or
  // first payment, whichever is earlier) through the current month, minus
  // the months actually paid.
  const firstPayment = db.prepare(
    'SELECT month, year FROM payments WHERE household_id = ? ORDER BY year ASC, month ASC LIMIT 1'
  ).get(id);
  const created = currentMonthYear(new Date(household.created_at));
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

  res.json({ household, payments, summary });
});

// PUT /api/households/:id
householdsRouter.put('/:id(\\d+)', (req, res) => {
  const id = Number(req.params.id);
  const household = db.prepare(`SELECT * FROM households WHERE id = ?`).get(id);
  if (!household) return res.status(404).json({ error: 'Household not found.' });

  const body = req.body ?? {};
  const errors = validateHousehold({ ...household, ...body });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const houseNo = String(body.house_no).trim();
  const clash = db.prepare('SELECT id FROM households WHERE house_no = ? AND id != ?').get(houseNo, id);
  if (clash) {
    return res.status(409).json({ error: `House number "${houseNo}" already exists for another household.` });
  }

  db.prepare(
    `UPDATE households SET house_no = ?, name = ?, phone = ?, monthly_amount = ?, status = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    houseNo,
    String(body.name).trim(),
    String(body.phone ?? '').trim() || null,
    toPaise(body.monthly_amount),
    body.status === 'inactive' ? 'inactive' : 'active',
    new Date().toISOString(),
    id
  );

  const updated = db.prepare(`SELECT ${FIELDS} FROM households WHERE id = ?`).get(id);
  logAudit({
    userId: req.user.id,
    userName: req.user.name,
    action: 'update',
    entity: 'household',
    entityId: id,
    description: `Updated household ${updated.house_no} (${updated.name})`,
    details: { before: household, after: updated },
  });
  res.json({ household: updated });
});
