// lib/pdf.js — Professional A4 PDF reports for Masjid E Shameem.
//
// Responsibilities are split so they can evolve independently:
//   - lib/report-data.js  → aggregates report data from the database
//   - this module         → renders pdfmake document definitions + buffers
//   - routes/reports.js   → wires the two together, handles download/print
//
// The document builders take the aggregated data object (never query the
// database themselves), so the preview JSON, the CSV and the PDF always
// describe the same numbers.
import pdfMake from 'pdfmake/build/pdfmake.js';
import vfs from 'pdfmake/build/vfs_fonts.js';
import { formatReportDate } from './report-data.js';

pdfMake.addVirtualFileSystem(vfs);

/* ---------- palette (mirrors the app theme) ---------- */
const GREEN_DARK = '#07281d';
const GREEN = '#0b3d2e';
const GOLD = '#b8860b';
const INK = '#2b2b26';
const GREY = '#6b6b63';
const BORDER = '#d9d2bf';
const CREAM_ALT = '#f3ecdc';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/* ---------- formatting ---------- */

/**
 * Indian-grouping currency: 4250000 → "₹42,500", 125075 → "₹1,250.75",
 * 51000000 → "₹5,10,000". Whole amounts render without decimal zeros.
 */
export function formatINR(paise, { symbol = true, forcePaise = false } = {}) {
  const n = Number(paise ?? 0) / 100;
  const s = n.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    ...(forcePaise ? { minimumFractionDigits: 2 } : {}),
  });
  return symbol ? `₹${s}` : s;
}

/** ISO timestamp (UTC or local) → "16 August 2026" in the server's local time. */
export function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/* ---------- shared layout ---------- */

const page = { pageSize: 'A4', pageMargins: [44, 46, 44, 62] };

function masthead(title, subtitle, generatedAt) {
  return [
    { text: 'MASJID E SHAMEEM', style: 'mastheadTitle' },
    { text: title, style: 'mastheadSub' },
    { text: subtitle, style: 'reportTitle' },
    { text: `Generated on: ${longDate(generatedAt)}`, style: 'generatedOn' },
    {
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 507, y2: 0, lineWidth: 0.9, lineColor: GOLD },
      ],
      margin: [0, 8, 0, 0],
    },
  ];
}

function sectionHeading(text) {
  return { text, style: 'section' };
}

/** Two-column Metric | Value table used for summary blocks. */
function keyValueTable(rows, { lastBold = false } = {}) {
  const body = rows.map(([k, v], i) => [
    { text: k, style: 'kvKey' },
    {
      text: v,
      style: lastBold && i === rows.length - 1 ? 'kvValueTotal' : 'kvValue',
    },
  ]);
  return {
    table: { widths: ['50%', '50%'], body },
    layout: {
      hLineWidth: (i) => (i === 0 || i === rows.length ? 0.9 : 0),
      vLineWidth: () => 0,
      paddingLeft: () => 2,
      paddingRight: () => 6,
      paddingTop: () => 3.5,
      paddingBottom: () => 3.5,
      hLineColor: () => BORDER,
    },
    margin: [0, 4, 0, 4],
  };
}

/** Repeating-header data table with borders. */
function dataTable(headers, rows, widths) {
  const headerRow = headers.map((h) => ({ text: h, style: 'th' }));
  const body = [headerRow, ...rows];
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: true,
      widths,
      body,
    },
    layout: {
      hLineWidth: (i) => (i === 0 ? 0.9 : i === body.length - 1 ? 0.9 : 0.4),
      vLineWidth: () => 0.4,
      hLineColor: () => BORDER,
      vLineColor: () => BORDER,
      paddingLeft: () => 5,
      paddingRight: () => 5,
      paddingTop: () => 3.5,
      paddingBottom: () => 3.5,
    },
  };
}

/** Payment-mode summary: Mode | Transactions | Total Amount (+ Total row).
 * Cash includes split cash portions and UPI includes split UPI portions, so
 * Cash + UPI always reconciles to Total. The split row's amount is
 * informational — that money is already counted inside Cash and UPI. */
function modeSummaryTable(modeSummary, totalTransactions, totalPaise) {
  const label = (m) => (m.mode === 'cash' ? 'Cash' : m.mode === 'upi' ? 'UPI' : 'Split (Cash + UPI)');
  const rows = modeSummary
    .filter((m) => m.mode !== 'split' || m.transactions > 0)
    .map((m) => [
      { text: label(m), style: 'cell' },
      { text: String(m.transactions), style: 'cellNum' },
      { text: formatINR(m.total_paise), style: 'cellNum' },
    ]);
  rows.push([
    { text: 'Total', style: 'totalCell' },
    { text: String(totalTransactions), style: 'totalCell' },
    { text: formatINR(totalPaise), style: 'totalCell' },
  ]);
  return dataTable(
    ['Payment Mode', 'Transactions', 'Total Amount'],
    rows,
    [180, 140, 187]
  );
}

/** Signature block — appears once, at the end of the report. */
function signatureBlock() {
  return {
    table: {
      widths: ['100%'],
      body: [
        [{ text: 'Prepared By:  Treasurer, Masjid E Shameem', style: 'signatureText' }],
        [{ text: ' ', style: 'signatureText' }],
        [{ text: 'Signature:  ______________________________', style: 'signatureText' }],
        [{ text: 'Date:  ______________________________', style: 'signatureText' }],
      ],
    },
    layout: 'noBorders',
    margin: [0, 26, 0, 0],
  };
}

/** Running footer on every page: record name left, page numbers right. */
function footer(currentPage, pageCount) {
  return {
    margin: [44, 12, 44, 0],
    columns: [
      { text: 'Masjid E Shameem – Chanda Collection Record', fontSize: 7.5, color: GREY, alignment: 'left' },
      { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7.5, color: GREY, alignment: 'right' },
    ],
  };
}

/** Slim running header on pages 2+ (page 1 carries the full masthead). */
function runningHeader(currentPage) {
  if (currentPage === 1) return {};
  return {
    margin: [44, 14, 44, 0],
    columns: [
      { text: 'MASJID E SHAMEEM', fontSize: 7.5, bold: true, color: GREEN, alignment: 'left' },
      { text: 'Chanda Collection Record', fontSize: 7.5, color: GREY, alignment: 'right' },
    ],
  };
}

function baseDoc(content) {
  return {
    ...page,
    header: runningHeader,
    footer,
    content,
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: INK, lineHeight: 1.3 },
    styles: {
      mastheadTitle: { fontSize: 17, bold: true, color: GREEN_DARK, alignment: 'center', letterSpacing: 1 },
      mastheadSub: { fontSize: 11, bold: true, color: GREEN, alignment: 'center', margin: [0, 3, 0, 0] },
      reportTitle: { fontSize: 13, bold: true, color: GREEN_DARK, alignment: 'center', margin: [0, 7, 0, 0] },
      generatedOn: { fontSize: 8.5, color: GREY, alignment: 'center', margin: [0, 4, 0, 0] },
      section: { fontSize: 11.5, bold: true, color: GREEN_DARK, margin: [0, 18, 0, 7] },
      th: { fontSize: 8.5, bold: true, color: '#ffffff', fillColor: GREEN, alignment: 'left' },
      cell: { fontSize: 8.5 },
      cellNum: { fontSize: 8.5, alignment: 'right' },
      totalCell: { fontSize: 8.5, bold: true, fillColor: CREAM_ALT },
      kvKey: { fontSize: 9.5, color: INK },
      kvValue: { fontSize: 9.5, bold: true, color: GREEN_DARK, alignment: 'right' },
      kvValueTotal: { fontSize: 10, bold: true, color: GREEN_DARK, alignment: 'right' },
      signatureText: { fontSize: 10, color: INK },
      emptyNote: { fontSize: 10, italics: true, color: GREY, margin: [0, 6, 0, 6] },
      filterNote: { fontSize: 8, color: GREY, margin: [0, 0, 0, 8] },
    },
  };
}

/* ---------- monthly report ---------- */

/** data: result of getMonthlyPdfData() */
export function buildMonthlyPdf(data) {
  const { summary } = data;
  const content = [];

  content.push(...masthead('Monthly Chanda Collection Report', data.label, data.generated_at));

  if (data.mode !== 'all') {
    content.push({ text: `Report filtered to ${data.mode === 'cash' ? 'Cash' : 'UPI'} payments only.`, style: 'filterNote' });
  }

  content.push(sectionHeading('Monthly Summary'));
  content.push(keyValueTable([
    ['Total Households', String(summary.total_households)],
    ['Households Paid', String(summary.households_paid)],
    ['Households Pending', String(summary.households_pending)],
    ['Total Collection', formatINR(summary.total_collection_paise)],
    ['Cash Collection', formatINR(summary.cash_paise)],
    ['UPI Collection', formatINR(summary.upi_paise)],
  ], { lastBold: true }));

  /* ---- detailed collection table ---- */
  content.push(sectionHeading('Detailed Collection'));
  if (data.rows.length === 0) {
    content.push({
      text: data.mode === 'all'
        ? `No chanda collection records found for ${data.label}.`
        : `No ${data.mode === 'cash' ? 'Cash' : 'UPI'} payments recorded for ${data.label}.`,
      style: 'emptyNote',
    });
  } else {
    const rows = data.rows.map((p, i) => [
      { text: String(i + 1), style: 'cellNum' },
      { text: p.house_no, style: 'cell' },
      { text: p.household_name, style: 'cell' },
      { text: formatINR(p.amount), style: 'cellNum' },
      { text: p.payment_mode === 'cash' ? 'Cash' : p.payment_mode === 'upi' ? 'UPI' : 'Split', style: 'cell' },
      { text: formatReportDate(p.payment_date), style: 'cell' },
      { text: p.payment_mode === 'split' ? `Cash ${formatINR(p.cash_amount)} + UPI ${formatINR(p.upi_amount)}${p.upi_reference ? ` (${p.upi_reference})` : ''}` : (p.upi_reference || '—'), style: 'cell' },
    ]);
    content.push(dataTable(
      ['S.No', 'House No', 'Name', 'Amount', 'Payment Mode', 'Payment Date', 'UPI Ref'],
      rows,
      [26, 50, '*', 58, 48, 56, 92]
    ));
  }

  /* ---- pending chanda ---- */
  content.push(sectionHeading('Pending Chanda'));
  if (data.pending.length === 0) {
    content.push({ text: 'All active households have paid for this month. No pending households.', style: 'emptyNote' });
  } else {
    const rows = data.pending.map((p, i) => [
      { text: String(i + 1), style: 'cellNum' },
      { text: p.house_no, style: 'cell' },
      { text: p.household_name, style: 'cell' },
      { text: formatINR(p.monthly_amount), style: 'cellNum' },
    ]);
    content.push(dataTable(
      ['S.No', 'House No', 'Name', 'Expected Amount'],
      rows,
      [26, 52, '*', 80]
    ));
    content.push({
      columns: [
        { text: `Total Pending Households: ${data.pending.length}`, bold: true, fontSize: 9, color: GREEN_DARK, width: '*', margin: [0, 8, 0, 0] },
        { text: `Expected Pending Amount: ${formatINR(summary.expected_pending_paise)}`, bold: true, fontSize: 9, color: GREEN_DARK, width: '*', alignment: 'right', margin: [0, 8, 0, 0] },
      ],
      margin: [0, 0, 0, 4],
    });
  }

  /* ---- payment mode summary ---- */
  content.push(sectionHeading('Payment Mode Summary'));
  content.push(modeSummaryTable(
    data.mode_summary,
    summary.transactions,
    summary.total_collection_paise
  ));

  content.push(signatureBlock());
  return baseDoc(content);
}

/* ---------- annual report ---------- */

/** data: result of getAnnualReportData() */
export function buildAnnualPdf(data) {
  const { summary } = data;
  const content = [];

  content.push(...masthead('Annual Chanda Collection Report', `Financial Year / Calendar Year: ${data.year}`, data.generated_at));

  if (data.mode !== 'all') {
    content.push({ text: `Report filtered to ${data.mode === 'cash' ? 'Cash' : 'UPI'} payments only.`, style: 'filterNote' });
  }

  content.push(sectionHeading('Annual Summary'));
  content.push(keyValueTable([
    ['Total Collection', formatINR(summary.total_collection_paise)],
    ['Total Transactions', String(summary.transactions)],
    ['Cash Collection', formatINR(summary.cash_paise)],
    ['UPI Collection', formatINR(summary.upi_paise)],
  ], { lastBold: true }));

  /* ---- monthly breakdown ---- */
  content.push(sectionHeading('Monthly Breakdown'));
  if (summary.transactions === 0) {
    content.push({ text: `No chanda collection records found for ${data.year}.`, style: 'emptyNote' });
  } else {
    const rows = data.monthly.map((m) => [
      { text: m.month_name, style: 'cell' },
      { text: String(m.households_paid), style: 'cellNum' },
      { text: formatINR(m.total_paise), style: 'cellNum' },
      { text: formatINR(m.cash_paise), style: 'cellNum' },
      { text: formatINR(m.upi_paise), style: 'cellNum' },
    ]);
    rows.push([
      { text: 'Annual Total', style: 'totalCell' },
      { text: String(data.monthly.reduce((s, m) => s + m.households_paid, 0)), style: 'totalCell' },
      { text: formatINR(summary.total_collection_paise), style: 'totalCell' },
      { text: formatINR(summary.cash_paise), style: 'totalCell' },
      { text: formatINR(summary.upi_paise), style: 'totalCell' },
    ]);
    content.push(dataTable(
      ['Month', 'Households Paid', 'Total Collection', 'Cash', 'UPI'],
      rows,
      ['*', 62, 82, 82, 82]
    ));
  }

  /* ---- household-wise annual summary ---- */
  content.push(sectionHeading('Household-wise Annual Summary'));
  if (data.households.length === 0) {
    content.push({ text: `No household payments recorded for ${data.year}.`, style: 'emptyNote' });
  } else {
    const rows = data.households.map((h, i) => [
      { text: String(i + 1), style: 'cellNum' },
      { text: h.house_no, style: 'cell' },
      { text: h.name, style: 'cell' },
      { text: String(h.months_paid), style: 'cellNum' },
      { text: formatINR(h.total_paise), style: 'cellNum' },
    ]);
    content.push(dataTable(
      ['S.No', 'House No', 'Name', 'Months Paid', 'Total Paid'],
      rows,
      [26, 60, '*', 58, 70]
    ));
  }

  /* ---- payment mode summary ---- */
  content.push(sectionHeading('Payment Mode Summary'));
  content.push(modeSummaryTable(
    data.mode_summary,
    summary.transactions,
    summary.total_collection_paise
  ));

  content.push(signatureBlock());
  return baseDoc(content);
}

/* ---------- rendering + file names ---------- */

/** Render a docDefinition to a PDF Buffer (pdfmake 0.3.x promise API).
 * getBuffer() resolves to a Uint8Array — wrap it in a real Node Buffer so
 * Express streams it as binary instead of JSON-serializing it. */
export async function renderPdf(docDefinition) {
  const printer = pdfMake.createPdf(docDefinition);
  return Buffer.from(await printer.getBuffer());
}

export function monthlyFileName(data) {
  return `Masjid_E_Shameem_Chanda_${MONTH_NAMES[Number(data.month) - 1]}_${data.year}.pdf`;
}

export function annualFileName(data) {
  return `Masjid_E_Shameem_Chanda_Annual_${data.year}.pdf`;
}
