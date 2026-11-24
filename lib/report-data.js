// Report data aggregation. Every report (JSON view, CSV, PDF, print preview)
// reads from these functions so the business logic lives in one place.
import { db, monthLabel, MONTHS } from '../db.js';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> '05-Aug-2026' */
export function formatReportDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  return `${d}-${SHORT_MONTHS[Number(m) - 1]}-${y}`;
}

/**
 * Natural sort for house numbers: "A-2" < "A-10" < "A-101" < "B-201".
 * Mixed strings like "7-473" and "A-101" sort deterministically (numbers
 * before letters at the first differing segment).
 */
export function naturalCompare(a, b) {
  const ta = String(a ?? '').match(/\d+|\D+/g) || [];
  const tb = String(b ?? '').match(/\d+|\D+/g) || [];
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    if (ta[i] === undefined) return -1;
    if (tb[i] === undefined) return 1;
    const na = /^\d+$/.test(ta[i]);
    const nb = /^\d+$/.test(tb[i]);
    if (na && nb) {
      const diff = parseInt(ta[i], 10) - parseInt(tb[i], 10);
      if (diff !== 0) return diff;
      continue;
    }
    if (na) return -1;
    if (nb) return 1;
    const diff = ta[i].localeCompare(tb[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const MODE_LABEL = {
  cash: 'Cash',
  upi: 'UPI',
  split: 'Split',
};

/**
 * WHERE fragment for a report mode filter.
 * Cash/UPI filters include split payments (a split payment contains both
 * cash and UPI money); 'all' has no filter.
 */
function modeClause(mode) {
  if (mode === 'cash') return { where: " AND p.payment_mode IN ('cash','split')", params: [] };
  if (mode === 'upi') return { where: " AND p.payment_mode IN ('upi','split')", params: [] };
  return { where: '', params: [] };
}

/**
 * Monthly stats. `mode` decides which money is counted:
 *   all  → total = SUM(amount), cash = SUM(cash_amount), upi = SUM(upi_amount)
 *   cash → total = cash money only (SUM(cash_amount) over cash+split rows)
 *   upi  → total = UPI money only
 * `paid` always counts distinct ACTIVE households with a payment in the month
 * (inactive households are never counted as paid and never as pending).
 */
function monthlyStats(month, year, mode = 'all') {
  const { where, params } = modeClause(mode);
  const money = mode === 'cash' ? 'SUM(p.cash_amount)' : mode === 'upi' ? 'SUM(p.upi_amount)' : 'SUM(p.amount)';
  const cashSel = mode === 'upi' ? '0' : 'SUM(p.cash_amount)';
  const upiSel = mode === 'cash' ? '0' : 'SUM(p.upi_amount)';
  return db.prepare(
    `SELECT
       COUNT(*)                                                      AS transactions,
       COUNT(DISTINCT CASE WHEN h.status = 'active' THEN p.household_id END) AS paid,
       COALESCE(${money}, 0)                                         AS total_paise,
       COALESCE(${cashSel}, 0)                                       AS cash_paise,
       COALESCE(${upiSel}, 0)                                        AS upi_paise
      FROM payments p
      JOIN households h ON h.id = p.household_id
     WHERE p.month = ? AND p.year = ?${where}`
  ).get(month, year, ...params);
}

/**
 * Monthly report used by the Reports screen and CSV export.
 * filter: all | cash | upi | paid | pending  ·  search: house no / name.
 */
export function getMonthlyReport(month, year, filter, search) {
  const stats = monthlyStats(month, year, 'all');
  const activeHouseholds = db.prepare("SELECT COUNT(*) AS c FROM households WHERE status = 'active'").get().c;

  let rowsSql = `
    SELECT p.id, p.household_id, p.month, p.year, p.amount, p.payment_mode, p.cash_amount, p.upi_amount,
           p.payment_date, p.upi_reference, p.notes, h.house_no, h.name AS household_name
      FROM payments p
      JOIN households h ON h.id = p.household_id
     WHERE p.month = ? AND p.year = ?`;
  const rowsParams = [month, year];

  if (filter === 'cash') {
    rowsSql += " AND p.payment_mode IN ('cash','split')";
  } else if (filter === 'upi') {
    rowsSql += " AND p.payment_mode IN ('upi','split')";
  }
  if (search) {
    rowsSql += ' AND (h.house_no LIKE ? OR h.name LIKE ?)';
    const like = `%${search}%`;
    rowsParams.push(like, like);
  }
  rowsSql += ' ORDER BY h.house_no';
  const rows = db.prepare(rowsSql).all(...rowsParams);

  let pendingSql = `
    SELECT h.id AS household_id, h.house_no, h.name AS household_name,
           h.monthly_amount, h.phone
      FROM households h
     WHERE h.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM payments p
          WHERE p.household_id = h.id AND p.month = ? AND p.year = ?
       )`;
  const pendingParams = [month, year];
  if (filter === 'pending' && search) {
    pendingSql += ' AND (h.house_no LIKE ? OR h.name LIKE ?)';
    const like = `%${search}%`;
    pendingParams.push(like, like);
  }
  pendingSql += ' ORDER BY h.house_no';
  const pending = db.prepare(pendingSql).all(...pendingParams);

  return {
    month,
    year,
    month_label: monthLabel(month, year),
    total_collection_paise: stats.total_paise,
    cash_paise: stats.cash_paise,
    upi_paise: stats.upi_paise,
    households_paid: stats.paid,
    households_pending: Math.max(activeHouseholds - stats.paid, 0),
    active_households: activeHouseholds,
    filter,
    rows,
    pending,
  };
}

/**
 * Payment-mode summary (Mode | Transactions | Total Amount).
 * Cash total includes the cash portion of split payments, UPI total includes
 * the UPI portion — so Cash + UPI always equals Total. The split row shows
 * the full split amount as information (its money is already counted inside
 * Cash and UPI). `scopeSql` narrows the rows (month/year or year only).
 */
function modeSummary(scopeSql, scopeParams) {
  const cash = db.prepare(
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(p.cash_amount), 0) AS total_paise
       FROM payments p JOIN households h ON h.id = p.household_id
      WHERE ${scopeSql} AND p.payment_mode IN ('cash','split')`
  ).get(...scopeParams);
  const upi = db.prepare(
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(p.upi_amount), 0) AS total_paise
       FROM payments p JOIN households h ON h.id = p.household_id
      WHERE ${scopeSql} AND p.payment_mode IN ('upi','split')`
  ).get(...scopeParams);
  const split = db.prepare(
    `SELECT COUNT(*) AS transactions, COALESCE(SUM(p.amount), 0) AS total_paise
       FROM payments p JOIN households h ON h.id = p.household_id
      WHERE ${scopeSql} AND p.payment_mode = 'split'`
  ).get(...scopeParams);
  return [
    { mode: 'cash', transactions: cash.transactions, total_paise: cash.total_paise },
    { mode: 'upi', transactions: upi.transactions, total_paise: upi.total_paise },
    { mode: 'split', transactions: split.transactions, total_paise: split.total_paise },
  ];
}

/**
 * Full monthly report for the PDF / print preview.
 * mode: all | cash | upi — totals and the records table reflect the filter;
 * paid/pending counts always describe the whole month.
 */
export function getMonthlyPdfData(month, year, mode = 'all') {
  const stats = monthlyStats(month, year, mode);
  const fullStats = monthlyStats(month, year, 'all');

  const totalHouseholds = db.prepare('SELECT COUNT(*) AS c FROM households').get().c;
  const activeHouseholds = db.prepare("SELECT COUNT(*) AS c FROM households WHERE status = 'active'").get().c;

  const { where, params } = modeClause(mode);
  const rows = db.prepare(
    `SELECT p.id, p.household_id, p.month, p.year, p.amount, p.payment_mode, p.cash_amount, p.upi_amount,
            p.payment_date, p.upi_reference, p.notes, h.house_no, h.name AS household_name
       FROM payments p
       JOIN households h ON h.id = p.household_id
      WHERE p.month = ? AND p.year = ?${where}
      ORDER BY p.payment_date, p.id`
  ).all(month, year, ...params);
  rows.sort((a, b) => naturalCompare(a.house_no, b.house_no));

  const pending = db.prepare(
    `SELECT h.id AS household_id, h.house_no, h.name AS household_name, h.monthly_amount
       FROM households h
      WHERE h.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.household_id = h.id AND p.month = ? AND p.year = ?
        )`
  ).all(month, year);
  pending.sort((a, b) => naturalCompare(a.house_no, b.house_no));
  const expectedPendingPaise = pending.reduce((sum, p) => sum + p.monthly_amount, 0);

  return {
    type: 'monthly',
    month,
    year,
    label: monthLabel(month, year),
    generated_at: new Date().toISOString(),
    mode,
    summary: {
      total_households: totalHouseholds,
      active_households: activeHouseholds,
      households_paid: fullStats.paid,
      households_pending: Math.max(activeHouseholds - fullStats.paid, 0),
      total_collection_paise: stats.total_paise,
      cash_paise: stats.cash_paise,
      upi_paise: stats.upi_paise,
      transactions: stats.transactions,
      expected_pending_paise: expectedPendingPaise,
    },
    rows,
    pending,
    mode_summary: modeSummary('p.month = ? AND p.year = ?', [month, year]),
  };
}

/** Annual report for the PDF / print preview. mode: all | cash | upi. */
export function getAnnualReportData(year, mode = 'all') {
  const { where, params } = modeClause(mode);
  const money = mode === 'cash' ? 'SUM(p.cash_amount)' : mode === 'upi' ? 'SUM(p.upi_amount)' : 'SUM(p.amount)';
  const cashSel = mode === 'upi' ? '0' : 'SUM(p.cash_amount)';
  const upiSel = mode === 'cash' ? '0' : 'SUM(p.upi_amount)';

  const summary = db.prepare(
    `SELECT
       COUNT(*)                   AS transactions,
       COALESCE(${money}, 0)      AS total_paise,
       COALESCE(${cashSel}, 0)    AS cash_paise,
       COALESCE(${upiSel}, 0)     AS upi_paise
      FROM payments p
      JOIN households h ON h.id = p.household_id
     WHERE p.year = ?${where}`
  ).get(year, ...params);

  const monthly = MONTHS.map((monthName, i) => {
    const month = i + 1;
    const s = db.prepare(
      `SELECT
         COUNT(*) AS transactions,
         COUNT(DISTINCT CASE WHEN h.status = 'active' THEN p.household_id END) AS paid,
         COALESCE(${money}, 0)   AS total_paise,
         COALESCE(${cashSel}, 0) AS cash_paise,
         COALESCE(${upiSel}, 0)  AS upi_paise
        FROM payments p
        JOIN households h ON h.id = p.household_id
       WHERE p.year = ? AND p.month = ?${where}`
    ).get(year, month, ...params);
    return {
      month,
      month_name: monthName,
      transactions: s.transactions,
      households_paid: s.paid,
      total_paise: s.total_paise,
      cash_paise: s.cash_paise,
      upi_paise: s.upi_paise,
    };
  });

  const monthPaidExpr = mode === 'cash'
    ? 'CASE WHEN p.cash_amount > 0 THEN p.month END'
    : mode === 'upi'
      ? 'CASE WHEN p.upi_amount > 0 THEN p.month END'
      : 'p.month';

  const households = db.prepare(
    `SELECT h.id, h.house_no, h.name,
            COUNT(DISTINCT ${monthPaidExpr}) AS months_paid,
            COALESCE(${money}, 0) AS total_paise
       FROM payments p
       JOIN households h ON h.id = p.household_id
      WHERE p.year = ?${where}
      GROUP BY h.id
     HAVING COUNT(DISTINCT ${monthPaidExpr}) > 0`
  ).all(year, ...params);
  households.sort((a, b) => naturalCompare(a.house_no, b.house_no));

  return {
    type: 'annual',
    year,
    label: `Calendar Year: ${year}`,
    generated_at: new Date().toISOString(),
    mode,
    summary: {
      total_collection_paise: summary.total_paise,
      transactions: summary.transactions,
      cash_paise: summary.cash_paise,
      upi_paise: summary.upi_paise,
    },
    monthly,
    households,
    mode_summary: modeSummary('p.year = ?', [year]),
  };
}
