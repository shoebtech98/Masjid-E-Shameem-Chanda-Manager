import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/documents.ts', import.meta.url), 'utf8');
const moneySource = await readFile(new URL('../src/money.ts', import.meta.url), 'utf8');
const { outputText: moneyOutput } = ts.transpileModule(moneySource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const moneyUrl = `data:text/javascript;base64,${Buffer.from(moneyOutput).toString('base64')}`;
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const documentsOutput = outputText.replace("from './money';", `from '${moneyUrl}';`);
const documents = await import(`data:text/javascript;base64,${Buffer.from(documentsOutput).toString('base64')}`);

const payment = {
  id: 21,
  household_id: 4,
  house_no: 'A-1 <script>',
  household_name: 'Resident & family',
  month: 11,
  year: 2026,
  amount: 10000,
  payment_mode: 'split',
  cash_amount: 4000,
  upi_amount: 6000,
  payment_date: '2026-11-14',
  upi_reference: 'UPI-<123>',
  notes: 'Received <in person>',
};

const monthly = {
  type: 'monthly',
  month: 11,
  year: 2026,
  generated_at: '2026-11-14T18:30:00+00:00',
  label: 'November 2026',
  mode: 'all',
  summary: {
    total_households: 2,
    active_households: 2,
    households_paid: 1,
    households_pending: 1,
    total_collection_paise: 10000,
    cash_paise: 4000,
    upi_paise: 6000,
    transactions: 1,
    expected_pending_paise: 5000,
  },
  mode_summary: [
    { mode: 'cash', transactions: 1, total_paise: 4000 },
    { mode: 'upi', transactions: 1, total_paise: 6000 },
    { mode: 'split', transactions: 1, total_paise: 10000 },
  ],
  rows: [payment],
  pending: [{
    household_id: 8,
    house_no: 'B-1',
    household_name: 'Pending resident',
    monthly_amount: 5000,
  }],
};

const receipt = documents.buildReceiptHtml(payment);
assert.match(receipt, /<h1>Payment Receipt<\/h1>/);
assert.match(receipt, /Monthly Masjid Subscription/);
assert.match(receipt, /Authorized Signatory \/ Cashier/);
assert.match(receipt, /A-1 &lt;script&gt;/);
assert.match(receipt, /Cash portion/);
assert.match(receipt, /UPI portion/);
assert.match(receipt, /UPI-&lt;123&gt;/);
assert.match(receipt, /14 November 2026/);
assert.doesNotMatch(receipt, /<script>/);
console.log('  ✓ split receipt includes ID, payment details, IST-safe date, and escaped household/payment text');

const monthlyHtml = documents.buildReportHtml(monthly);
assert.equal(documents.reportPdfTitle(monthly), 'Masjid E Shameem-November-2026-Monthly report');
assert.equal(documents.receiptPdfTitle(payment), 'Masjid E Shameem-Payment Received- November-2026');
assert.match(monthlyHtml, /<body class="collection-report-page">/);
assert.match(monthlyHtml, /Total monthly collection/);
assert.match(monthlyHtml, /Verified By \(Treasurer\)/);
assert.match(monthlyHtml, /^<!doctype html>/i);
assert.doesNotMatch(monthlyHtml, /<nav\b|navigation|document-action-sheet/i);
assert.match(monthlyHtml, /Total collection/);
assert.match(monthlyHtml, /₹100\.00/);
assert.match(monthlyHtml, /₹40\.00/);
assert.match(monthlyHtml, /₹60\.00/);
assert.match(monthlyHtml, /₹50\.00/);
assert.match(monthlyHtml, /Pending resident/);
assert.match(monthlyHtml, /Split payment total/);
assert.match(monthlyHtml, /not added again/);
assert.match(monthlyHtml, /15 Nov 2026/);
for (const [mode, amount] of [['cash', '40.00'], ['upi', '60.00']]) {
  const filteredHtml = documents.buildReportHtml({ ...monthly, mode });
  const collections = filteredHtml.split('2. Household collections')[1].split('</tbody>')[0];
  assert.ok(collections.includes(`<td class="amount">₹${amount}</td>`));
}
console.log('  ✓ monthly report reconciles backend totals, split components, pending households, and IST generation time');

const annualMonths = Array.from({ length: 12 }, (_value, index) => {
  const monthNumber = index + 1;
  const hasPayment = monthNumber === 11;
  return {
    ...monthly,
    month: monthNumber,
    label: new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2026, index, 1))) + ' 2026',
    summary: {
      ...monthly.summary,
      households_pending: hasPayment ? 1 : 2,
      total_collection_paise: hasPayment ? 10000 : 0,
      cash_paise: hasPayment ? 4000 : 0,
      upi_paise: hasPayment ? 6000 : 0,
      transactions: hasPayment ? 1 : 0,
      expected_pending_paise: hasPayment ? 5000 : 10000,
    },
    mode_summary: [
      { mode: 'cash', transactions: hasPayment ? 1 : 0, total_paise: hasPayment ? 4000 : 0 },
      { mode: 'upi', transactions: hasPayment ? 1 : 0, total_paise: hasPayment ? 6000 : 0 },
      { mode: 'split', transactions: hasPayment ? 1 : 0, total_paise: hasPayment ? 10000 : 0 },
    ],
    rows: hasPayment ? [payment] : [],
    pending: hasPayment ? monthly.pending : [],
  };
});

const annual = {
  type: 'annual',
  year: 2026,
  generated_at: '2026-11-14T18:30:00+00:00',
  label: 'Calendar Year: 2026',
  mode: 'all',
  summary: {
    total_collection_paise: 10000,
    transactions: 1,
    cash_paise: 4000,
    upi_paise: 6000,
  },
  monthly: annualMonths.map((month) => ({
    month: month.month,
    month_name: month.label.split(' ')[0],
    transactions: month.summary.transactions,
    households_paid: month.summary.households_paid,
    total_paise: month.summary.total_collection_paise,
    cash_paise: month.summary.cash_paise,
    upi_paise: month.summary.upi_paise,
  })),
  households: [{
    id: 4,
    house_no: 'A-1',
    name: 'Resident',
    months_paid: 1,
    total_paise: 10000,
  }],
  mode_summary: [
    { mode: 'cash', transactions: 1, total_paise: 4000 },
    { mode: 'upi', transactions: 1, total_paise: 6000 },
    { mode: 'split', transactions: 1, total_paise: 10000 },
  ],
};

assert.equal(documents.reconcileAnnualMonthlyReports(annual, annualMonths), true);
assert.equal(documents.reportPdfTitle(annual), 'Masjid E Shameem-2026-Annual report');
const annualHtml = documents.buildReportHtml(annual, annualMonths);
assert.match(annualHtml, /Annual grand total/);
assert.match(annualHtml, /Annual pending balances are unavailable/);
assert.match(annualHtml, /Approved By \(President\)/);
assert.equal(documents.reconcileAnnualMonthlyReports(annual, annualMonths.slice(1)), false);
assert.match(
  documents.buildReportHtml(annual, annualMonths),
  /November 2026[\s\S]*₹40\.00[\s\S]*₹60\.00[\s\S]*₹100\.00/,
);
console.log('  ✓ annual cash, UPI and split totals reconcile with all twelve monthly API reports');

const statement = documents.buildHouseholdStatementHtml({
  household: {
    id: 4,
    house_no: 'A-1',
    name: 'Resident',
    phone: null,
    monthly_amount: 5000,
    status: 'active',
    created_at: '2026-01-01T00:00:00+05:30',
    updated_at: '2026-01-01T00:00:00+05:30',
  },
  payments: [payment],
  summary: {
    total_payments: 1,
    total_amount_paise: 10000,
    current_year_paise: 10000,
    current_month: { paid: true, amount_paise: 10000, payment_mode: 'split' },
    last_payment_date: '2026-11-14',
    months_paid: 1,
    months_pending: 10,
    current_month_label: 'November 2026',
  },
});
assert.match(statement, /Household account statement/);
assert.match(statement, /<h2>1\. Account summary<\/h2>/);
assert.match(statement, /Total recorded contributions/);
assert.match(statement, /Cash ₹40\.00 \+ UPI ₹60\.00/);
assert.match(statement, /Approved By \(President\)/);
assert.match(statement, /November 2026/);
assert.match(statement, /class="total"><td>Total contributions/);
assert.match(statement, /₹50\.00/);
assert.match(statement, /Total contributions/);
assert.match(statement, /₹100\.00/);
assert.match(statement, /UPI-&lt;123&gt;/);
assert.match(statement, /outstanding balance is not shown/i);
console.log('  ✓ household statement uses canonical totals and does not invent an outstanding balance');

const emptyReport = documents.buildReportHtml({
  ...monthly,
  summary: {
    ...monthly.summary,
    total_collection_paise: 0,
    cash_paise: 0,
    upi_paise: 0,
    transactions: 0,
    households_paid: 0,
    households_pending: 0,
    expected_pending_paise: 0,
  },
  mode_summary: [
    { mode: 'cash', transactions: 0, total_paise: 0 },
    { mode: 'upi', transactions: 0, total_paise: 0 },
    { mode: 'split', transactions: 0, total_paise: 0 },
  ],
  rows: [],
  pending: [],
});
assert.match(emptyReport, /No payments in this period/);
assert.match(emptyReport, /No pending households/);
console.log('  ✓ empty report states are explicit');

const multiPageReport = documents.buildReportHtml({
  ...monthly,
  rows: Array.from({ length: 120 }, (_value, index) => ({
    ...payment,
    id: index + 1,
    house_no: `A-${index + 1}`,
  })),
});
assert.match(multiPageReport, /size: A4/);
assert.match(multiPageReport, /display: table-header-group/);
assert.match(multiPageReport, /break-inside: avoid/);
assert.match(multiPageReport, /counter\(page\)/);
assert.equal((multiPageReport.match(/<tr>/g) ?? []).length >= 120, true);
console.log('  ✓ long tables retain repeated headers, row boundaries, and page numbering rules');
