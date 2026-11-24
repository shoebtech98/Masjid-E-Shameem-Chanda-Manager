import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { parseMonthYear } from '../validate.js';
import { currentMonthYear, monthLabel } from '../time.js';

export const dashboardRouter = new Hono();
dashboardRouter.use('*', requireAuth);

// GET /api/dashboard?month=&year=
// All totals are computed from the payments table — nothing is hardcoded.
dashboardRouter.get('/', async (c) => {
  const { month, year } = parseMonthYear(c.req.query());
  const { month: curMonth, year: curYear } = currentMonthYear();

  const stats = await db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN h.status = 'active' THEN p.household_id END) AS paid,
       COALESCE(SUM(p.amount), 0)         AS total_paise,
       COALESCE(SUM(p.cash_amount), 0)    AS cash_paise,
       COALESCE(SUM(p.upi_amount), 0)     AS upi_paise
      FROM payments p
      JOIN households h ON h.id = p.household_id
     WHERE p.month = ? AND p.year = ?`
  ).get(month, year);

  const activeHouseholds = (await db.prepare("SELECT COUNT(*) AS c FROM households WHERE status = 'active'").get()).c;
  const totalHouseholds = (await db.prepare('SELECT COUNT(*) AS c FROM households').get()).c;

  const recent = await db.prepare(
    `SELECT p.id, p.household_id, p.month, p.year, p.amount, p.payment_mode, p.cash_amount, p.upi_amount,
            p.payment_date, p.upi_reference, p.notes, h.house_no, h.name AS household_name
       FROM payments p
       JOIN households h ON h.id = p.household_id
      ORDER BY p.payment_date DESC, p.id DESC
      LIMIT 10`
  ).all();

  return c.json({
    month,
    year,
    month_label: monthLabel(month, year),
    is_current_month: month === curMonth && year === curYear,
    total_collection_paise: stats.total_paise,
    households_paid: stats.paid,
    households_pending: Math.max(activeHouseholds - stats.paid, 0),
    cash_paise: stats.cash_paise,
    upi_paise: stats.upi_paise,
    active_households: activeHouseholds,
    total_households: totalHouseholds,
    recent,
  });
});
