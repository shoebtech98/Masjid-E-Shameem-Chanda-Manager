import { Router } from 'express';
import { db, monthLabel } from '../db.js';
import { requireAuth } from '../auth.js';
import { parseMonthYear } from '../lib/validate.js';
import { getMonthlyPdfData, getAnnualReportData } from '../lib/report-data.js';
import {
  buildMonthlyPdf,
  buildAnnualPdf,
  renderPdf,
  monthlyFileName,
  annualFileName,
} from '../lib/pdf.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

/**
 * Build the full monthly report payload: KPIs, payment rows (filtered +
 * searched), and the pending-households list. Shared by the JSON endpoint
 * and the CSV export so the two never drift apart.
 */
function buildReport(month, year, filter, search) {
  const stats = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN h.status = 'active' THEN p.household_id END) AS paid,
       COALESCE(SUM(p.amount), 0)      AS total_paise,
       COALESCE(SUM(p.cash_amount), 0) AS cash_paise,
       COALESCE(SUM(p.upi_amount), 0)  AS upi_paise
      FROM payments p
      JOIN households h ON h.id = p.household_id
     WHERE p.month = ? AND p.year = ?`
  ).get(month, year);

  const activeHouseholds = db.prepare("SELECT COUNT(*) AS c FROM households WHERE status = 'active'").get().c;

  let rowsSql = `
    SELECT p.id, p.household_id, p.month, p.year, p.amount, p.payment_mode, p.cash_amount, p.upi_amount,
           p.payment_date, p.upi_reference, p.notes, h.house_no, h.name AS household_name
      FROM payments p
      JOIN households h ON h.id = p.household_id
     WHERE p.month = ? AND p.year = ?`;
  const rowsParams = [month, year];

  if (filter === 'cash') {
    rowsSql += " AND p.payment_mode IN ('cash','split')"; // split payments contain cash
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

const VALID_FILTERS = ['cash', 'upi', 'paid', 'pending'];

function resolveFilter(value) {
  return VALID_FILTERS.includes(value) ? value : 'all';
}

// GET /api/reports?month=&year=&filter=all|cash|upi|paid|pending&search=
reportsRouter.get('/', (req, res) => {
  const { month, year } = parseMonthYear(req);
  const report = buildReport(month, year, resolveFilter(req.query.filter), String(req.query.search ?? '').trim());
  res.json(report);
});

/* ---------------- CSV export ---------------- */

function csvEscape(value) {
  const text = String(value ?? '');
  // CSV quoting does not prevent spreadsheets from interpreting formulas.
  const s = /^[\s\u0000-\u001f]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY' (Excel-friendly for Indian users). */
function csvDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

function rupees(paise) {
  return (Number(paise) / 100).toFixed(2);
}

// GET /api/reports/export/monthly-csv?month=&year=&filter=&search=
// Exports exactly what the Monthly Reports screen shows, plus the
// summary KPIs and the pending-households list.
reportsRouter.get('/export/monthly-csv', (req, res) => {
  const { month, year } = parseMonthYear(req);
  const filter = resolveFilter(req.query.filter);
  const search = String(req.query.search ?? '').trim();
  const report = buildReport(month, year, filter, search);

  const lines = [];
  lines.push('Masjid E Shameem - Monthly Chanda Collection Report');
  lines.push(`Month: ${report.month_label}`);
  lines.push('');
  lines.push(`Total Collection (Rs),${rupees(report.total_collection_paise)}`);
  lines.push(`Cash (Rs),${rupees(report.cash_paise)}`);
  lines.push(`UPI (Rs),${rupees(report.upi_paise)}`);
  lines.push(`Households Paid,${report.households_paid}`);
  lines.push(`Households Pending,${report.households_pending}`);
  lines.push(`Active Households,${report.active_households}`);
  lines.push('');

  lines.push('Records,');
  lines.push('House No,Name,Amount (Rs),Mode,Payment Date,UPI Reference,Notes');
  if (filter === 'pending') {
    for (const p of report.pending) {
      lines.push([p.house_no, p.household_name, rupees(p.monthly_amount), 'Pending', '', '', ''].map(csvEscape).join(','));
    }
  } else {
    for (const p of report.rows) {
      lines.push([
        p.house_no,
        p.household_name,
        rupees(p.amount),
        p.payment_mode === 'cash' ? 'Cash' : p.payment_mode === 'upi' ? 'UPI' : `Split (Cash ${rupees(p.cash_amount)} + UPI ${rupees(p.upi_amount)})`,
        csvDate(p.payment_date),
        p.upi_reference,
        p.notes,
      ].map(csvEscape).join(','));
    }
  }

  // Only repeat the pending list when it isn't already the Records block.
  if (filter !== 'pending') {
    lines.push('');
    lines.push('Pending Households (no payment recorded for this month),');
    lines.push('House No,Name,Expected Monthly Amount (Rs)');
    for (const p of report.pending) {
      lines.push([p.house_no, p.household_name, rupees(p.monthly_amount)].map(csvEscape).join(','));
    }
  }

  const csv = lines.map((l) => `${l}\r\n`).join('');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="masjid-chanda-${year}-${String(month).padStart(2, '0')}.csv"`);
  res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 correctly
});

/* ---------------- PDF reports (monthly + annual) ---------------- */

const VALID_MODES = ['all', 'cash', 'upi'];

function resolveMode(value) {
  return VALID_MODES.includes(value) ? value : 'all';
}

function resolveReportType(value) {
  return value === 'annual' ? 'annual' : 'monthly';
}

/** Shared month/year validation for the PDF endpoints (strict: no silent defaults). */
function parsePdfParams(req) {
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { error: 'Valid year required.' };
  }
  if (req.query.type === 'annual') return { month, year };
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { error: 'Valid month required.' };
  }
  return { month, year };
}

// GET /api/reports/data?type=monthly|annual&month=&year=&mode=all|cash|upi
// Aggregated data for the Reports & Printouts preview — same data the PDF uses.
reportsRouter.get('/data', (req, res) => {
  const type = resolveReportType(req.query.type);
  const mode = resolveMode(req.query.mode);
  const { month, year, error } = parsePdfParams(req);
  if (error) return res.status(400).json({ error });

  const data = type === 'annual'
    ? getAnnualReportData(year, mode)
    : getMonthlyPdfData(month, year, mode);
  res.json(data);
});

// GET /api/reports/pdf?type=monthly|annual&month=&year=&mode=all|cash|upi
// Downloads the generated A4 PDF. Auth-protected like every other route.
reportsRouter.get('/pdf', async (req, res) => {
  try {
    const type = resolveReportType(req.query.type);
    const mode = resolveMode(req.query.mode);
    const { month, year, error } = parsePdfParams(req);
    if (error) return res.status(400).json({ error });

    const data = type === 'annual'
      ? getAnnualReportData(year, mode)
      : getMonthlyPdfData(month, year, mode);
    const doc = type === 'annual' ? buildAnnualPdf(data) : buildMonthlyPdf(data);
    const buf = await renderPdf(doc);
    const filename = type === 'annual' ? annualFileName(data) : monthlyFileName(data);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'Could not generate the PDF report. Please try again.' });
  }
});
