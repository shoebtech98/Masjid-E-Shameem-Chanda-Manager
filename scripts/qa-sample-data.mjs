// QA sample-data exercise:
//  1. Create 24 QA households (QA-1 … QA-24) with varied monthly amounts
//  2. Record 39 payments across June/July/August 2026 — cash, UPI, and split
//  3. Edit 3 payments (amount/mode changes)
//  4. Delete 2 payments
//  5. Reconcile dashboard, household history, monthly reports, annual report,
//     and PDFs against independently computed expected totals
//  6. (Cleanup happens in a separate script after verification)
//
// Baseline (captured before this run — existing seed data, unchanged by QA):
//   households: 12 total / 11 active
//   June 2026:   total 560000, cash 235000, upi 325000, paid 8, pending 3, txn 8,  expected_pending 90000
//   July 2026:   total 525000, cash 250000, upi 275000, paid 8, pending 3, txn 8,  expected_pending 125000
//   August 2026: total 535000, cash 335000, upi 200000, paid 9, pending 2, txn 9,  expected_pending 115000
//   Annual 2026: total 1620000, txn 25, cash 820000, upi 800000
// All paise values are integer (rupees * 100).

const BASE = 'http://localhost:3000';
const ADMIN = { email: 'admin@shameem.example', password: 'admin123' };

// ---------------------------------------------------------------- helpers
let cookie = null;
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie').split(';')[0];
}
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { cookie, 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const results = [];
function check(name, ok, actual, expected) {
  results.push({ name, ok: Boolean(ok), actual, expected });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${ok ? '' : `\n         expected: ${JSON.stringify(expected)}\n         actual:   ${JSON.stringify(actual)}`}`);
}

// ---------------------------------------------------------------- the plan
// house_no -> monthly amount (rupees)
const HOUSEHOLDS = [
  ['QA-1', 'Abdul Rahman', 500], ['QA-2', 'Mohammed Imran', 750], ['QA-3', 'Farhan Ahmed', 1000],
  ['QA-4', 'Yusuf Khan', 400], ['QA-5', 'Ayesha Siddiqua', 600], ['QA-6', 'Zubair Ahmed', 800],
  ['QA-7', 'Naseem Fatima', 1200], ['QA-8', 'Khalid Hussain', 500], ['QA-9', 'Sirajuddin Qureshi', 1000],
  ['QA-10', 'Sana Begum', 350], ['QA-11', 'Irfan Ali', 700], ['QA-12', 'Rubina Shaikh', 900],
  ['QA-13', 'Adnan Siddiqui', 1500], ['QA-14', 'Tabassum Khan', 450], ['QA-15', 'Faisal Ansari', 550],
  ['QA-16', 'Rehana Parveen', 650], ['QA-17', 'Javed Akhtar', 2000], ['QA-18', 'Salma Khatoon', 400],
  ['QA-19', 'Danish Raza', 600], ['QA-20', 'Hina Sultana', 800], ['QA-21', 'Omar Farooq', 300],
  ['QA-22', 'Waseem Khan', 1000], ['QA-23', 'Bushra Fatima', 750], ['QA-24', 'Arif Hussain', 500],
];

// payment plan: [house_no, month, day, amount, mode, cash, upi]
const PAYMENTS = [
  // June 2026 — 13 payments (6 cash, 5 upi, 2 split)
  ['QA-1', 6, 2, 500, 'cash', 500, 0], ['QA-2', 6, 3, 750, 'upi', 0, 750],
  ['QA-3', 6, 4, 1000, 'cash', 1000, 0], ['QA-5', 6, 5, 600, 'upi', 0, 600],
  ['QA-6', 6, 6, 800, 'cash', 800, 0], ['QA-8', 6, 7, 500, 'cash', 500, 0],
  ['QA-10', 6, 8, 350, 'split', 200, 150], ['QA-11', 6, 9, 700, 'upi', 0, 700],
  ['QA-13', 6, 10, 1500, 'split', 900, 600], ['QA-15', 6, 11, 550, 'cash', 550, 0],
  ['QA-17', 6, 12, 2000, 'upi', 0, 2000], ['QA-21', 6, 13, 300, 'cash', 300, 0],
  ['QA-24', 6, 14, 500, 'upi', 0, 500],
  // July 2026 — 11 payments (5 cash, 4 upi, 2 split)
  ['QA-4', 7, 3, 400, 'cash', 400, 0], ['QA-7', 7, 4, 1200, 'upi', 0, 1200],
  ['QA-9', 7, 5, 1000, 'cash', 1000, 0], ['QA-12', 7, 6, 900, 'cash', 900, 0],
  ['QA-14', 7, 7, 450, 'upi', 0, 450], ['QA-16', 7, 8, 650, 'cash', 650, 0],
  ['QA-18', 7, 9, 400, 'upi', 0, 400], ['QA-19', 7, 10, 600, 'split', 300, 300],
  ['QA-20', 7, 11, 800, 'cash', 800, 0], ['QA-22', 7, 12, 1000, 'upi', 0, 1000],
  ['QA-23', 7, 13, 750, 'split', 250, 500],
  // August 2026 — 15 payments (7 cash, 5 upi, 3 split)
  ['QA-1', 8, 1, 500, 'cash', 500, 0], ['QA-2', 8, 2, 750, 'upi', 0, 750],
  ['QA-4', 8, 3, 400, 'cash', 400, 0], ['QA-5', 8, 4, 600, 'split', 250, 350],
  ['QA-6', 8, 5, 800, 'cash', 800, 0], ['QA-8', 8, 6, 500, 'upi', 0, 500],
  ['QA-9', 8, 7, 1000, 'cash', 1000, 0], ['QA-11', 8, 8, 700, 'split', 500, 200],
  ['QA-13', 8, 9, 1500, 'split', 1000, 500], ['QA-14', 8, 10, 450, 'upi', 0, 450],
  ['QA-15', 8, 11, 550, 'cash', 550, 0], ['QA-17', 8, 12, 2000, 'upi', 0, 2000],
  ['QA-21', 8, 13, 300, 'cash', 300, 0], ['QA-22', 8, 14, 1000, 'upi', 0, 1000],
  ['QA-24', 8, 15, 500, 'cash', 500, 0],
];

// edits: [house_no, month, {new fields}]
const EDITS = [
  // QA-8 August: UPI ₹500 -> SPLIT ₹500 (₹200 cash + ₹300 UPI)
  ['QA-8', 8, { amount: 500, payment_mode: 'split', cash_amount: 200, upi_amount: 300 }],
  // QA-24 August: cash ₹500 -> cash ₹600
  ['QA-24', 8, { amount: 600, payment_mode: 'cash', cash_amount: 600, upi_amount: 0 }],
  // QA-10 June: split ₹350 (200+150) -> split ₹500 (300+200)
  ['QA-10', 6, { amount: 500, payment_mode: 'split', cash_amount: 300, upi_amount: 200 }],
];

// deletes: [house_no, month]
const DELETES = [
  ['QA-15', 6], // June cash ₹550
  ['QA-7', 7],  // July UPI ₹1,200
];

// ---------------------------------------------------------------- expected (manually computed)
const BASELINE = {
  6: { total: 560000, cash: 235000, upi: 325000, paid: 8, pending: 3, txn: 8, exp_pending: 90000 },
  7: { total: 525000, cash: 250000, upi: 275000, paid: 8, pending: 3, txn: 8, exp_pending: 125000 },
  8: { total: 535000, cash: 335000, upi: 200000, paid: 9, pending: 2, txn: 9, exp_pending: 115000 },
};
// QA deltas per month after edits + deletes (computed by hand in the plan)
const QA_DELTA = {
  6: { total: 965000, cash: 430000, upi: 535000, paid: 12, pending: 12, txn: 12, exp_pending: 870000 },
  7: { total: 695000, cash: 430000, upi: 265000, paid: 10, pending: 14, txn: 10, exp_pending: 1125000 },
  8: { total: 1165000, cash: 610000, upi: 555000, paid: 15, pending: 9, txn: 15, exp_pending: 665000 },
};
const ANNUAL_BASELINE = { total: 1620000, txn: 25, cash: 820000, upi: 800000 };
const ANNUAL_QA = { total: 2825000, txn: 37, cash: 1470000, upi: 1355000 };

// QA pending house sets per month (after deletes)
const QA_PENDING = {
  6: ['QA-4', 'QA-7', 'QA-9', 'QA-12', 'QA-14', 'QA-15', 'QA-16', 'QA-18', 'QA-19', 'QA-20', 'QA-22', 'QA-23'],
  7: ['QA-1', 'QA-2', 'QA-3', 'QA-5', 'QA-6', 'QA-7', 'QA-8', 'QA-10', 'QA-11', 'QA-13', 'QA-15', 'QA-17', 'QA-21', 'QA-24'],
  8: ['QA-3', 'QA-7', 'QA-10', 'QA-12', 'QA-16', 'QA-18', 'QA-19', 'QA-20', 'QA-23'],
};
// expected mode_summary per month: { mode: [txn, totalPaise] }
// Note: the summary covers the WHOLE month, so baseline seed rows are included
// (each payment counts once per mode it touches; cash+upi = total always).
const MODE_SUMMARY = {
  6: { cash: [11, 665000], upi: [11, 860000], split: [2, 200000] },
  7: { cash: [11, 680000], upi: [9, 540000], split: [2, 135000] },
  8: { cash: [17, 945000], upi: [11, 755000], split: [4, 330000] },
};
// annual monthly breakdown for Jun/Jul/Aug: { txn, total, cash, upi, paid }
// (whole-month values: baseline + QA)
const ANNUAL_MONTHLY = {
  6: { txn: 20, total: 1525000, cash: 665000, upi: 860000, paid: 20 },
  7: { txn: 18, total: 1220000, cash: 680000, upi: 540000, paid: 18 },
  8: { txn: 24, total: 1700000, cash: 945000, upi: 755000, paid: 24 },
};

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

// ---------------------------------------------------------------- phase 1: households
console.log('\n=== Phase 1: create households ===');
await login();
const houseIds = {};
let created = 0;
for (const [houseNo, name, monthly] of HOUSEHOLDS) {
  const { status, body } = await api('/api/households', {
    method: 'POST',
    body: JSON.stringify({ house_no: houseNo, name, phone: null, monthly_amount: monthly, status: 'active' }),
  });
  if (status !== 201) throw new Error(`household ${houseNo} failed: ${status} ${JSON.stringify(body)}`);
  houseIds[houseNo] = body.household.id;
  created++;
}
check(`created ${created} households (expect 24)`, created === 24, created, 24);

// ---------------------------------------------------------------- phase 2: payments
console.log('\n=== Phase 2: record payments ===');
const paymentIds = {}; // key: `${houseNo}|${month}`
let payCreated = 0;
for (const [houseNo, month, day, amount, mode, cash, upi] of PAYMENTS) {
  const { status, body } = await api('/api/payments', {
    method: 'POST',
    body: JSON.stringify({
      household_id: houseIds[houseNo],
      month, year: 2026,
      amount, payment_mode: mode,
      cash_amount: cash, upi_amount: upi,
      payment_date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      upi_reference: mode === 'upi' ? `QAUPI-${houseNo}` : null,
      notes: 'QA sample',
    }),
  });
  if (status !== 201) throw new Error(`payment ${houseNo}/${month} failed: ${status} ${JSON.stringify(body)}`);
  paymentIds[`${houseNo}|${month}`] = body.payment.id;
  payCreated++;
}
check(`created ${payCreated} payments (expect 39)`, payCreated === 39, payCreated, 39);

// ---------------------------------------------------------------- phase 3: edits
console.log('\n=== Phase 3: edit payments ===');
let edited = 0;
for (const [houseNo, month, fields] of EDITS) {
  const id = paymentIds[`${houseNo}|${month}`];
  const orig = PAYMENTS.find((p) => p[0] === houseNo && p[1] === month);
  const { status } = await api(`/api/payments/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      household_id: houseIds[houseNo],
      month, year: 2026,
      payment_date: `2026-${String(month).padStart(2, '0')}-${String(orig[2]).padStart(2, '0')}`,
      upi_reference: orig[4] === 'upi' ? `QAUPI-${houseNo}` : null,
      notes: 'QA sample',
      ...fields,
    }),
  });
  if (status !== 200) throw new Error(`edit ${houseNo}/${month} failed: ${status}`);
  edited++;
}
check(`edited ${edited} payments (expect 3)`, edited === 3, edited, 3);

// ---------------------------------------------------------------- phase 4: deletes
console.log('\n=== Phase 4: delete payments ===');
let deleted = 0;
for (const [houseNo, month] of DELETES) {
  const id = paymentIds[`${houseNo}|${month}`];
  const { status } = await api(`/api/payments/${id}`, { method: 'DELETE' });
  if (status !== 200) throw new Error(`delete ${houseNo}/${month} failed: ${status}`);
  deleted++;
}
check(`deleted ${deleted} payments (expect 2)`, deleted === 2, deleted, 2);

// ---------------------------------------------------------------- phase 5: reconcile
console.log('\n=== Phase 5: reconciliation ===');

// 5a. Dashboard per month
for (const m of [6, 7, 8]) {
  const { body } = await api(`/api/dashboard?month=${m}&year=2026`);
  const exp = { total: BASELINE[m].total + QA_DELTA[m].total, cash: BASELINE[m].cash + QA_DELTA[m].cash, upi: BASELINE[m].upi + QA_DELTA[m].upi, paid: BASELINE[m].paid + QA_DELTA[m].paid, pending: BASELINE[m].pending + QA_DELTA[m].pending, active: 35 };
  check(`dashboard ${m}/2026 total`, body.total_collection_paise === exp.total, body.total_collection_paise, exp.total);
  check(`dashboard ${m}/2026 cash`, body.cash_paise === exp.cash, body.cash_paise, exp.cash);
  check(`dashboard ${m}/2026 upi`, body.upi_paise === exp.upi, body.upi_paise, exp.upi);
  check(`dashboard ${m}/2026 paid+pending+active`, body.households_paid === exp.paid && body.households_pending === exp.pending && body.active_households === exp.active, `${body.households_paid}/${body.households_pending}/${body.active_households}`, `${exp.paid}/${exp.pending}/${exp.active}`);
}

// 5b. Monthly report data (shared by preview + PDF)
for (const m of [6, 7, 8]) {
  const { body } = await api(`/api/reports/data?type=monthly&month=${m}&year=2026&mode=all`);
  const exp = { total: BASELINE[m].total + QA_DELTA[m].total, cash: BASELINE[m].cash + QA_DELTA[m].cash, upi: BASELINE[m].upi + QA_DELTA[m].upi, paid: BASELINE[m].paid + QA_DELTA[m].paid, pending: BASELINE[m].pending + QA_DELTA[m].pending, txn: BASELINE[m].txn + QA_DELTA[m].txn, exp_pending: BASELINE[m].exp_pending + QA_DELTA[m].exp_pending };
  const s = body.summary;
  check(`monthly ${m} summary total`, s.total_collection_paise === exp.total, s.total_collection_paise, exp.total);
  check(`monthly ${m} summary cash/upi`, s.cash_paise === exp.cash && s.upi_paise === exp.upi, `${s.cash_paise}/${s.upi_paise}`, `${exp.cash}/${exp.upi}`);
  check(`monthly ${m} paid/pending/txn`, s.households_paid === exp.paid && s.households_pending === exp.pending && s.transactions === exp.txn, `${s.households_paid}/${s.households_pending}/${s.transactions}`, `${exp.paid}/${exp.pending}/${exp.txn}`);
  check(`monthly ${m} expected pending`, s.expected_pending_paise === exp.exp_pending, s.expected_pending_paise, exp.exp_pending);
  check(`monthly ${m} row count`, body.rows.length === exp.txn, body.rows.length, exp.txn);

  // QA pending set matches exactly
  const qaPending = body.pending.filter((p) => p.house_no.startsWith('QA-')).map((p) => p.house_no).sort(naturalCompare);
  const expQa = [...QA_PENDING[m]].sort(naturalCompare);
  check(`monthly ${m} QA pending set`, JSON.stringify(qaPending) === JSON.stringify(expQa), qaPending, expQa);

  // mode summary
  for (const mode of ['cash', 'upi', 'split']) {
    const row = body.mode_summary.find((x) => x.mode === mode);
    const [et, ea] = MODE_SUMMARY[m][mode];
    check(`monthly ${m} mode_summary ${mode}`, row && row.transactions === et && row.total_paise === ea, row ? `${row.transactions}/${row.total_paise}` : null, `${et}/${ea}`);
  }

  // rows sorted naturally by house_no
  const qaRows = body.rows.filter((r) => r.house_no.startsWith('QA-')).map((r) => r.house_no);
  const sorted = [...qaRows].sort(naturalCompare);
  check(`monthly ${m} natural sort`, JSON.stringify(qaRows) === JSON.stringify(sorted), qaRows, sorted);
}

// 5c. Mode filters (August) — whole month: cash money ₹9,450, UPI money ₹7,550
{
  const cash = await api('/api/reports/data?type=monthly&month=8&year=2026&mode=cash');
  check('aug mode=cash total', cash.body.summary.total_collection_paise === 945000 && cash.body.summary.cash_paise === 945000 && cash.body.summary.upi_paise === 0, `${cash.body.summary.total_collection_paise}/${cash.body.summary.cash_paise}/${cash.body.summary.upi_paise}`, '945000/945000/0');
  const upi = await api('/api/reports/data?type=monthly&month=8&year=2026&mode=upi');
  check('aug mode=upi total', upi.body.summary.total_collection_paise === 755000 && upi.body.summary.cash_paise === 0 && upi.body.summary.upi_paise === 755000, `${upi.body.summary.total_collection_paise}/${upi.body.summary.cash_paise}/${upi.body.summary.upi_paise}`, '755000/0/755000');
}

// 5d. Monthly Reports page (buildReport — the CSV source)
{
  const { body } = await api('/api/reports?month=8&year=2026&filter=all&search=');
  check('reports page Aug total', body.total_collection_paise === 1700000, body.total_collection_paise, 1700000);
  check('reports page Aug cash/upi', body.cash_paise === 945000 && body.upi_paise === 755000, `${body.cash_paise}/${body.upi_paise}`, '945000/755000');
  check('reports page Aug paid/pending', body.households_paid === 24 && body.households_pending === 11, `${body.households_paid}/${body.households_pending}`, '24/11');
  check('reports page Aug rows', body.rows.length === 24, body.rows.length, 24);
}

// 5e. Annual report
{
  const { body } = await api('/api/reports/data?type=annual&year=2026&mode=all');
  const exp = { total: ANNUAL_BASELINE.total + ANNUAL_QA.total, txn: ANNUAL_BASELINE.txn + ANNUAL_QA.txn, cash: ANNUAL_BASELINE.cash + ANNUAL_QA.cash, upi: ANNUAL_BASELINE.upi + ANNUAL_QA.upi };
  check('annual total', body.summary.total_collection_paise === exp.total, body.summary.total_collection_paise, exp.total);
  check('annual transactions', body.summary.transactions === exp.txn, body.summary.transactions, exp.txn);
  check('annual cash/upi', body.summary.cash_paise === exp.cash && body.summary.upi_paise === exp.upi, `${body.summary.cash_paise}/${body.summary.upi_paise}`, `${exp.cash}/${exp.upi}`);
  for (const m of [6, 7, 8]) {
    const row = body.monthly.find((x) => x.month === m);
    const e = ANNUAL_MONTHLY[m];
    check(`annual monthly ${m}`, row && row.transactions === e.txn && row.total_paise === e.total && row.cash_paise === e.cash && row.upi_paise === e.upi && row.households_paid === e.paid, row ? `${row.transactions}/${row.total_paise}/${row.cash_paise}/${row.upi_paise}/${row.households_paid}` : null, `${e.txn}/${e.total}/${e.cash}/${e.upi}/${e.paid}`);
  }
  // months with no data stay zero
  const emptyMonths = [1, 2, 3, 4, 5, 9, 10, 11, 12];
  const zeros = emptyMonths.every((m) => body.monthly.find((x) => x.month === m).total_paise === 0);
  check('annual empty months zero', zeros, true, true);
  // household-wise summary: 11 baseline + 24 QA - 1 (QA-7 has zero payments after
  // its only payment was deleted, so it is correctly absent) = 34
  const qaHh = body.households.filter((h) => h.house_no.startsWith('QA-'));
  check('annual households count', body.households.length === 34, body.households.length, 34);
  check('annual QA-7 absent (payment deleted)', !qaHh.some((h) => h.house_no === 'QA-7'), true, true);
  // QA-1: 2 months (Jun + Aug), ₹1,000 total
  const qa1 = qaHh.find((h) => h.house_no === 'QA-1');
  check('annual QA-1 months paid/total', qa1 && qa1.months_paid === 2 && qa1.total_paise === 100000, qa1 ? `${qa1.months_paid}/${qa1.total_paise}` : null, '2/100000');
  // QA-24: 2 months, ₹1,100 (Jun upi 500 + Aug cash 600)
  const qa24 = qaHh.find((h) => h.house_no === 'QA-24');
  check('annual QA-24 months paid/total', qa24 && qa24.months_paid === 2 && qa24.total_paise === 110000, qa24 ? `${qa24.months_paid}/${qa24.total_paise}` : null, '2/110000');
  // QA-5: 2 months (Jun upi 600 + Aug split 600), ₹1,200 total
  const qa5 = qaHh.find((h) => h.house_no === 'QA-5');
  check('annual QA-5 months paid/total', qa5 && qa5.months_paid === 2 && qa5.total_paise === 120000, qa5 ? `${qa5.months_paid}/${qa5.total_paise}` : null, '2/120000');
}

// 5f. Household histories
{
  const detail = async (houseNo) => (await api(`/api/households/${houseIds[houseNo]}`)).body;
  const qa1 = await detail('QA-1');
  check('hist QA-1 total/2 payments/months', qa1.summary.total_payments === 2 && qa1.summary.total_amount_paise === 100000 && qa1.summary.months_paid === 2, `${qa1.summary.total_payments}/${qa1.summary.total_amount_paise}/${qa1.summary.months_paid}`, '2/100000/2');
  check('hist QA-1 current month paid', qa1.summary.current_month.paid && qa1.summary.current_month.amount_paise === 50000, JSON.stringify(qa1.summary.current_month), 'paid 50000');
  const qa5 = await detail('QA-5');
  const qa5Aug = qa5.payments.find((p) => p.month === 8);
  check('hist QA-5 split row', qa5.summary.total_payments === 2 && qa5.summary.total_amount_paise === 120000 && qa5Aug && qa5Aug.payment_mode === 'split' && qa5Aug.cash_amount === 25000 && qa5Aug.upi_amount === 35000, JSON.stringify(qa5Aug), 'split 25000/35000');
  const qa7 = await detail('QA-7'); // payment deleted — history must show none
  check('hist QA-7 deleted payment gone', qa7.summary.total_payments === 0 && qa7.summary.total_amount_paise === 0 && qa7.payments.length === 0 && qa7.summary.current_month.paid === false, `${qa7.summary.total_payments}/${qa7.payments.length}`, '0/0');
  const qa10 = await detail('QA-10'); // edited split
  check('hist QA-10 edited split', qa10.payments[0].amount === 50000 && qa10.payments[0].payment_mode === 'split' && qa10.payments[0].cash_amount === 30000 && qa10.payments[0].upi_amount === 20000, JSON.stringify(qa10.payments[0]), '50000 split 30000/20000');
  const qa24 = await detail('QA-24');
  check('hist QA-24 two months', qa24.summary.total_payments === 2 && qa24.summary.total_amount_paise === 110000 && qa24.payments.some((p) => p.month === 8 && p.payment_mode === 'cash' && p.amount === 60000), `${qa24.summary.total_payments}/${qa24.summary.total_amount_paise}`, '2/110000');
  // QA-8 edited: Aug payment is split 200/300
  const qa8 = await detail('QA-8');
  const aug = qa8.payments.find((p) => p.month === 8);
  check('hist QA-8 edited to split', aug && aug.payment_mode === 'split' && aug.cash_amount === 20000 && aug.upi_amount === 30000 && aug.amount === 50000, JSON.stringify(aug), 'split 20000/30000');
}

// 5g. PDFs — valid binaries with expected filenames and content-derived totals
{
  for (const [label, path, minBytes] of [
    ['June', '/api/reports/pdf?type=monthly&month=6&year=2026', 15000],
    ['July', '/api/reports/pdf?type=monthly&month=7&year=2026', 15000],
    ['August', '/api/reports/pdf?type=monthly&month=8&year=2026', 15000],
    ['Annual', '/api/reports/pdf?type=annual&year=2026', 20000],
  ]) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
    const buf = Buffer.from(await res.arrayBuffer());
    const header = buf.slice(0, 8).toString('latin1');
    const pages = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
    const cd = res.headers.get('content-disposition') || '';
    check(`PDF ${label} valid`, header.startsWith('%PDF-1.') && buf.length >= minBytes && pages >= 1, `${JSON.stringify(header)} ${buf.length}B ${pages}p`, `%PDF-1.x >=${minBytes}B >=1p`);
    check(`PDF ${label} filename`, /filename="[^"]+\.pdf"/.test(cd), cd, 'attachment; filename="….pdf"');
  }
  // The annual PDF must contain all 12 months in its data (spot check via its data endpoint)
  const an = await api('/api/reports/data?type=annual&year=2026&mode=all');
  check('annual monthly rows = 12', an.body.monthly.length === 12, an.body.monthly.length, 12);
}

// ---------------------------------------------------------------- tally
const failed = results.filter((r) => !r.ok);
console.log(`\n=== RESULT: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
if (failed.length) {
  console.log('Failed checks:');
  failed.forEach((f) => console.log(`  - ${f.name}`));
  process.exit(1);
}
console.log('ALL RECONCILED ✓');
