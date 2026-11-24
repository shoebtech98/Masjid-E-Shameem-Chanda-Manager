import type {
  AnnualReport,
  HouseholdDetail,
  MonthlyReport,
  Payment,
  PaymentModeSummary,
} from './api';
import { formatInrFromPaise } from './money';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function istDateTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function dateLabel(value: string) {
  const calendarDate = value.slice(0, 10);
  const date = new Date(`${calendarDate}T12:00:00+05:30`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(date);
}

function contributionPeriod(month: number, year: number) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function reportPdfTitle(report: MonthlyReport | AnnualReport) {
  if (report.type === 'annual') return `Masjid E Shameem-${report.year}-Annual report`;
  const period = contributionPeriod(report.month, report.year).replace(' ', '-');
  return `Masjid E Shameem-${period}-Monthly report`;
}

export function receiptPdfTitle(payment: Payment) {
  const period = contributionPeriod(payment.month, payment.year).replace(' ', '-');
  return `Masjid E Shameem-Payment Received- ${period}`;
}

function documentPage(title: string, subtitle: string, body: string, generatedAt?: string, variant?: 'receipt' | 'collection-report', printTitle = title) {
  const receipt = variant === 'receipt';
  const collectionReport = variant === 'collection-report';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(printTitle)}</title>
    <style>
      @page {
        size: A4;
        margin: 16mm 13mm 20mm;
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          color: #52675f;
          font: 9px Arial, sans-serif;
        }
      }
      * { box-sizing: border-box; }
      body { margin: 0; color: #192c25; background: #fff; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      header { border-top: 4px solid #203c32; border-bottom: 1px solid #c3d0c8; padding: 14px 0 12px; margin-bottom: 16px; }
      .brand { color: #203c32; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; }
      .brand-mark { display: inline-block; width: 14px; height: 2px; margin-left: 5px; background: #c49a45; vertical-align: middle; }
      h1 { margin: 7px 0 4px; font-size: 25px; line-height: 1.2; }
      .subtitle { color: #52675f; font-size: 11px; }
      h2 { margin: 16px 0 6px; color: #203c32; font-size: 12px; break-after: avoid; page-break-after: avoid; }
      p { margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; table-layout: fixed; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      th, td { padding: 6px 7px; border-bottom: 1px solid #d3ddd6; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
      th { background: #eef1eb; font-size: 10px; }
      th.amount { white-space: normal; }
      tbody th { width: 44%; }
      .amount { text-align: right; white-space: nowrap; overflow-wrap: normal; font-variant-numeric: tabular-nums; }
      .total { background: #203c32; color: #fff; font-weight: 700; }
      .total td { border-color: #52675f; }
      .receipt .total td { padding-block: 12px; font-size: 14px; }
      .note, .method-note { white-space: pre-wrap; overflow-wrap: anywhere; }
      .method-note { color: #52675f; font-size: 9px; }
      .no-break, tr { break-inside: avoid; page-break-inside: avoid; }
      .page-footer { margin-top: 14px; padding-top: 5px; border-top: 1px solid #d3ddd6; color: #52675f; font-size: 9px; break-inside: avoid; }
      .receipt-page header { border: 0; text-align: center; padding: 0; margin-bottom: 25px; }
      .receipt-page .brand { background: #19342a; color: #fff; border-bottom: 4px solid #b69a4d; padding: 20px 12px; font-size: 17px; }
      .receipt-greeting { display: block; color: #ead58f; font-weight: 400; font-style: italic; font-size: 12px; letter-spacing: 0; margin-top: 4px; }
      .receipt-page h1 { margin: 22px 0 5px; font: 34px Georgia, serif; }
      .receipt-page .subtitle { font-size: 14px; }
      .receipt-details { border: 1px solid #a9b5af; border-radius: 9px; overflow: hidden; }
      .receipt-details h2 { padding: 12px 14px; margin: 0; font-size: 15px; border-bottom: 1px solid #a9b5af; }
      .receipt-details table { margin: 0; }
      .receipt-details th, .receipt-details td { padding: 7px 14px; border-color: #c3ccc6; }
      .receipt-details tbody th { width: 49%; background: #fff; font-weight: 400; font-size: inherit; border-right: 1px solid #c3ccc6; }
      .receipt-details .total { background: #d3eee2; color: #19342a; }
      .receipt-details .total td { border: 0; }
      .receipt-blessing { background: #f4eedb; border-left: 4px solid #b69a4d; border-radius: 5px; padding: 10px 12px; margin: 13px 0; font-style: italic; break-inside: avoid; }
      .receipt-signature { width: 170px; margin: 30px 0 0 auto; padding-top: 4px; border-top: 1px solid #a9b5af; text-align: center; color: #52675f; font-size: 10px; break-inside: avoid; }
      .receipt-page .page-footer { text-align: center; border: 0; }
      .collection-report-page { color: #142239; }
      .collection-report-page header { padding: 0; border: 0; margin-bottom: 8px; }
      .report-greeting { background: #edfbf3; border: 1px solid #a7e3be; border-radius: 4px; color: #10542d; text-align: center; padding: 6px; margin: 0 0 8px; font-style: italic; font-size: 10px; }
      .report-greeting span { display: block; font-size: 14px; font-style: normal; }
      .report-banner { display: table; width: 100%; background: #1d347d; color: white; padding: 8px 12px; }
      .report-banner .brand, .report-banner h1 { display: table-cell; vertical-align: middle; color: white; margin: 0; }
      .report-banner .brand { font-size: 16px; letter-spacing: .4px; }
      .report-banner h1 { text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
      .collection-report-page .subtitle { background: #edf4fd; border: 1px solid #9aaed2; color: #1d347d; padding: 5px 10px; }
      .collection-report-page h2 { color: #1d347d; font-size: 12px; text-transform: uppercase; border-bottom: 1px solid #ccd7e9; padding-bottom: 4px; margin: 9px 0 5px; }
      .collection-report-page table { margin: 4px 0 6px; }
      .collection-report-page th, .collection-report-page td { border: 1px solid #bdcce0; padding: 5px 7px; }
      .collection-report-page th { background: #eff3f9; }
      .collection-report-page .total { background: #edf4fd; color: #1d347d; }
      .collection-report-page .total td { border-color: #bdcce0; border-top: 2px solid #79aaff; }
      .collection-report-page tfoot { display: table-row-group; }
      .report-metrics { border-collapse: separate; border-spacing: 5px 0; text-align: center; }
      .report-metrics td { text-align: center; border-radius: 3px; border-top: 3px solid #168043; }
      .report-metrics td:nth-child(2) { border-top-color: #3157bd; }
      .report-metrics td:nth-child(3) { border-top-color: #168079; }
      .report-metrics strong { display: block; color: #1d347d; font-size: 13px; margin: 3px 0; }
      .report-status, .report-note { padding: 7px 10px; border: 1px solid #a7e3be; border-left: 3px solid #168043; border-radius: 4px; background: #edfbf3; color: #10542d; break-inside: avoid; }
      .report-note { border-color: #e9cf91; border-left-color: #c57716; background: #fff8e8; color: #713905; }
      .statement-balance-note { padding: 7px 10px; border: 1px solid #cbd5e0; border-left: 3px solid #52657d; border-radius: 4px; background: #f4f7fa; break-inside: avoid; }
      .statement-method-detail { display: block; font-size: 9px; color: #415470; }
      .report-signatures td { border: 0; text-align: center; padding: 10px 0 4px; }
      .report-signatures span { display: inline-block; width: 70%; border-top: 1px solid #142239; padding-top: 4px; }
      .annual-households-heading { break-before: page; page-break-before: always; }
      @media screen {
        body { max-width: 210mm; margin: 0 auto; padding: 14mm; }
      }
    </style>
  </head>
  <body${variant ? ` class="${variant}-page"` : ''}>
    <header>
      ${collectionReport ? `<p class="report-greeting"><span lang="ar" dir="rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ</span>
        Assalamu Alaikum Wa Rahmatullahi Wa Barakatuh — Peace, Mercy, and Blessings of Allah be upon you</p>
        <div class="report-banner"><div class="brand">MASJID E SHAMEEM</div><h1>${escapeHtml(title)}</h1></div>` : `
      <div class="brand">MASJID E SHAMEEM ${receipt
        ? '<span class="receipt-greeting">Assalamu Alaikum Wa Rahmatullahi Wa Barakatuh</span>'
        : '<span class="brand-mark"></span>'}</div>
      <h1>${escapeHtml(title)}</h1>`}
      <div class="subtitle">${escapeHtml(subtitle)}</div>
    </header>
    ${body}
    <footer class="page-footer">
      <span>Generated ${escapeHtml(istDateTime(generatedAt))} · Asia/Kolkata</span>
    </footer>
  </body>
</html>`;
}

function paymentModeLabel(mode: Payment['payment_mode']) {
  return mode === 'upi' ? 'UPI' : mode === 'split' ? 'Split' : 'Cash';
}

function modeTotal(summary: PaymentModeSummary[], mode: Payment['payment_mode']) {
  return summary.find((entry) => entry.mode === mode)?.total_paise;
}

function methodBreakdown(summary: PaymentModeSummary[], annual = false) {
  const measures = [
    ['cash', 'Cash received, including split cash portions'],
    ['upi', 'UPI received, including split UPI portions'],
    ['split', 'Split payment total (included in cash and UPI portions above)'],
  ] as const;
  const rows = measures.map(([mode, label]) => {
    const entry = summary.find((item) => item.mode === mode);
    const amount = `<td class="amount">${entry ? escapeHtml(formatInrFromPaise(entry.total_paise)) : '—'}</td>`;
    const count = `<td class="amount">${entry?.transactions ?? '—'}</td>`;
    return `<tr><td>${label}</td>${count}${amount}</tr>`;
  }).join('');
  const amountHeading = '<th class="amount">Amount</th>';
  const countHeading = '<th class="amount">Transactions</th>';
  return `
    <h2>1. ${annual ? 'Annual collection' : 'Collection'} by payment method</h2>
    <table>
      <colgroup><col style="width:64%"><col style="width:16%"><col style="width:20%"></colgroup>
      <thead><tr><th>Payment measure</th>${countHeading}${amountHeading}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="method-note">Cash and UPI are component totals. Split is a subset of the grand total and is not added again.</p>
  `;
}

export function reportPaymentAmount(payment: Payment, mode: string) {
  if (mode === 'cash') return payment.cash_amount;
  if (mode === 'upi') return payment.upi_amount;
  return payment.amount;
}

function monthlyReportBody(report: MonthlyReport) {
  const { summary } = report;
  const money = (paise: number) => escapeHtml(formatInrFromPaise(paise));
  const participation = summary.active_households
    ? ` (${Math.round(summary.households_paid / summary.active_households * 100)}%)`
    : '';
  const paymentRows = report.rows.map((payment) => {
    const breakdown = payment.payment_mode === 'split'
      ? `Split · Cash ${formatInrFromPaise(payment.cash_amount)} + UPI ${formatInrFromPaise(payment.upi_amount)}`
      : paymentModeLabel(payment.payment_mode);
    return `<tr>
      <td>${escapeHtml(payment.house_no)}</td>
      <td>${escapeHtml(payment.household_name)}</td>
      <td>${escapeHtml(dateLabel(payment.payment_date))}</td>
      <td>${escapeHtml(breakdown)}</td>
      <td class="amount">${money(reportPaymentAmount(payment, report.mode))}</td>
    </tr>`;
  }).join('');
  const pendingRows = report.pending.map((household) => `<tr>
    <td>${escapeHtml(household.house_no)} · ${escapeHtml(household.household_name)}</td>
    <td class="amount">${escapeHtml(formatInrFromPaise(household.monthly_amount))}</td>
  </tr>`).join('');
  return `
    <table class="report-metrics" aria-label="Collection summary"><tbody><tr>
      <td>Total collection<strong>${money(summary.total_collection_paise)}</strong>${escapeHtml(summary.transactions)} transactions</td>
      <td>Cash / UPI split<strong>Cash: ${money(summary.cash_paise)}<br>UPI: ${money(summary.upi_paise)}</strong></td>
      <td>Household participation<strong>${escapeHtml(summary.households_paid)} / ${escapeHtml(summary.active_households)} paid${participation}</strong>${escapeHtml(summary.households_pending)} pending households</td>
    </tr></tbody></table>
    ${methodBreakdown(report.mode_summary)}
    <h2>2. Household collections</h2>
    <table>
      <colgroup><col style="width:15%"><col style="width:26%"><col style="width:19%"><col style="width:24%"><col style="width:16%"></colgroup>
      <thead><tr><th>House no.</th><th>Resident name</th><th>Payment date</th><th>Method / split</th><th class="amount">Amount (₹)</th></tr></thead>
      <tbody>${paymentRows || '<tr><td colspan="5">No payments in this period.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="4">Total monthly collection</td><td class="amount">${money(summary.total_collection_paise)}</td></tr></tfoot>
    </table>
    <h2>3. Pending contributions</h2>
    <p class="report-status"><strong>Status:</strong> ${summary.households_pending ? 'Some households have pending contributions.' : 'No pending households.'}<br>
      <strong>Pending households:</strong> ${escapeHtml(summary.households_pending)} &nbsp; | &nbsp; <strong>Expected pending amount:</strong> ${money(summary.expected_pending_paise)}</p>
    ${pendingRows ? `<table>
      <thead><tr><th>Household</th><th class="amount">Expected monthly amount</th></tr></thead>
      <tbody>${pendingRows}</tbody>
    </table>` : ''}
    <p class="report-note"><strong>JazakAllahu Khairan — Community Note &amp; Dua</strong><br>
      May Allah (SWT) accept the generous contributions of every household, place barakah in their wealth, health, and families, and reward them abundantly in this world and the Hereafter. Your timely support sustains the upkeep and daily services of Masjid E Shameem. Wassalamu Alaikum Wa Rahmatullahi Wa Barakatuh.</p>
    <table class="report-signatures"><tbody><tr><td><span>Prepared By (Secretary)</span></td><td><span>Verified By (Treasurer)</span></td></tr></tbody></table>
  `;
}

export function reconcileAnnualMonthlyReports(
  annual: AnnualReport,
  months: MonthlyReport[],
) {
  if (months.length !== 12) return false;
  const ordered = [...months].sort((a, b) => a.month - b.month);
  if (ordered.some((month, index) => month.year !== annual.year || month.month !== index + 1)) return false;

  const selectedTotalsMatch = ordered.every((month, index) => (
    month.summary.total_collection_paise === annual.monthly[index]?.total_paise
    && month.summary.transactions === annual.monthly[index]?.transactions
  ));
  if (!selectedTotalsMatch) return false;

  const modes: Payment['payment_mode'][] = ['cash', 'upi', 'split'];
  return modes.every((mode) => {
    const annualTotal = modeTotal(annual.mode_summary, mode);
    const monthTotal = ordered.reduce((total, month) => total + (modeTotal(month.mode_summary, mode) ?? 0), 0);
    return annualTotal !== undefined && annualTotal === monthTotal;
  });
}

function annualReportBody(report: AnnualReport) {
  const { summary } = report;
  const amount = (paise: number) => `<td class="amount">${escapeHtml(formatInrFromPaise(paise))}</td>`;
  const monthlyRows = [...report.monthly].sort((left, right) => left.month - right.month).map((month) => `<tr>
    <td>${escapeHtml(contributionPeriod(month.month, report.year))}</td>
    <td class="amount">${escapeHtml(month.households_paid)}</td>
    ${amount(month.cash_paise)}
    ${amount(month.upi_paise)}
    ${amount(month.total_paise)}
  </tr>`).join('');
  const householdRows = report.households.map((household) => `<tr>
    <td>${escapeHtml(household.house_no)}</td>
    <td>${escapeHtml(household.name)}</td>
    <td class="amount">${escapeHtml(household.months_paid)} / 12</td>
    ${amount(household.total_paise)}
    <td class="amount">—</td>
  </tr>`).join('');
  return `
    <table class="report-metrics" aria-label="Annual collection summary"><tbody><tr>
      <td>Annual total collection<strong>${escapeHtml(formatInrFromPaise(summary.total_collection_paise))}</strong>${escapeHtml(summary.transactions)} annual transactions</td>
      <td>Annual cash / UPI split<strong>Cash: ${escapeHtml(formatInrFromPaise(summary.cash_paise))}<br>UPI: ${escapeHtml(formatInrFromPaise(summary.upi_paise))}</strong></td>
      <td>Annual household status<strong>${escapeHtml(report.households.length)} households paid</strong>Pending balance unavailable</td>
    </tr></tbody></table>
    ${methodBreakdown(report.mode_summary, true)}
    <h2>2. Month-by-month collection breakdown</h2>
    <table>
      <colgroup><col style="width:25%"><col style="width:15%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup>
      <thead><tr><th>Month</th><th class="amount">Households paid</th><th class="amount">Cash (₹)</th><th class="amount">UPI (₹)</th><th class="amount">Monthly total (₹)</th></tr></thead>
      <tbody>${monthlyRows || '<tr><td colspan="5">No monthly data available.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td>Annual grand total</td><td class="amount">—</td>${amount(summary.cash_paise)}${amount(summary.upi_paise)}${amount(summary.total_collection_paise)}</tr></tfoot>
    </table>
    <h2 class="annual-households-heading">3. Household annual contribution summary</h2>
    <table>
      <colgroup><col style="width:14%"><col style="width:30%"><col style="width:16%"><col style="width:20%"><col style="width:20%"></colgroup>
      <thead><tr><th>House no.</th><th>Resident name</th><th class="amount">Months paid</th><th class="amount">Annual paid (₹)</th><th class="amount">Pending balance (₹)</th></tr></thead>
      <tbody>${householdRows || '<tr><td colspan="5">No payments in this year.</td></tr>'}</tbody>
      <tfoot><tr class="total"><td colspan="3">Total household contributions</td>${amount(summary.total_collection_paise)}<td class="amount">—</td></tr></tfoot>
    </table>
    <h2>4. Annual pending contributions &amp; reconciliation</h2>
    <p class="report-status"><strong>Annual reconciliation status:</strong> Annual pending balances are unavailable.<br>
      <strong>Households with pending balance:</strong> — &nbsp; | &nbsp; <strong>Total pending annual amount:</strong> —</p>
    <p class="report-note"><strong>JazakAllahu Khairan — Annual Note of Gratitude &amp; Dua</strong><br>
      Alhamdulillah, with the grace of Allah (SWT) and the steadfast support of our community, Masjid E Shameem has completed another year of service and upkeep. May Allah (SWT) accept every rupee contributed by each household, bless your families with health, peace, and barakah in sustenance, and grant us all continuous success in serving His House. Wassalamu Alaikum Wa Rahmatullahi Wa Barakatuh.</p>
    <table class="report-signatures"><tbody><tr><td><span>Prepared By (Secretary)</span></td><td><span>Verified By (Treasurer)</span></td><td><span>Approved By (President)</span></td></tr></tbody></table>
  `;
}

export function buildReportHtml(report: MonthlyReport | AnnualReport, monthReports: MonthlyReport[] = []) {
  const body = report.type === 'monthly'
    ? monthlyReportBody(report)
    : annualReportBody(report);
  return documentPage(
    report.type === 'monthly' ? 'Monthly collection report' : 'Annual collection report',
    report.type === 'monthly'
      ? `Period: ${report.label} | Payment method: ${report.mode.toUpperCase()} | Active households: ${report.summary.active_households}`
      : `Annual period: January–December ${report.year} | Payment method: ${report.mode.toUpperCase()}${monthReports.length ? ` | Active households: ${monthReports[0].summary.active_households}` : ''}`,
    body,
    report.generated_at,
    'collection-report',
    reportPdfTitle(report),
  );
}

export function buildHouseholdStatementHtml(detail: HouseholdDetail) {
  const { household, payments, summary } = detail;
  const monthlyRate = escapeHtml(formatInrFromPaise(household.monthly_amount));
  const total = escapeHtml(formatInrFromPaise(summary.total_amount_paise));
  const resident = escapeHtml(household.name);
  const historyRows = payments.map((payment) => `<tr>
    <td>${escapeHtml(contributionPeriod(payment.month, payment.year))}</td>
    <td>${escapeHtml(dateLabel(payment.payment_date))}</td>
    <td>${escapeHtml(paymentModeLabel(payment.payment_mode))}${payment.payment_mode === 'split'
      ? ` <span class="statement-method-detail">Cash ${escapeHtml(formatInrFromPaise(payment.cash_amount))} + UPI ${escapeHtml(formatInrFromPaise(payment.upi_amount))}</span>`
      : ''}</td>
    <td>${escapeHtml(payment.upi_reference || '—')}</td>
    <td class="amount">${escapeHtml(formatInrFromPaise(payment.amount))}</td>
  </tr>`).join('');
  return documentPage(
    'Household account statement',
    `Household no.: ${household.house_no} | Resident name: ${household.name} | Monthly rate: ${formatInrFromPaise(household.monthly_amount)}`,
    `
      <table class="report-metrics" aria-label="Household contribution summary"><tbody><tr>
        <td>Total contributions<strong>${total}</strong>${escapeHtml(summary.total_payments)} recorded payments</td>
        <td>Months paid<strong>${escapeHtml(summary.months_paid)}</strong>Monthly contribution: ${monthlyRate}</td>
        <td>Pending months<strong>${escapeHtml(summary.months_pending)}</strong></td>
      </tr></tbody></table>
      <h2>1. Account summary</h2>
      <table>
        <thead><tr><th>Account detail</th><th>Recorded value</th></tr></thead>
        <tbody>
          <tr><td>Household number</td><td>${escapeHtml(household.house_no)}</td></tr>
          <tr><td>Household name</td><td>${resident}</td></tr>
          <tr><td>Monthly contribution</td><td>${monthlyRate}</td></tr>
          <tr><td>Payments recorded</td><td>${escapeHtml(summary.total_payments)}</td></tr>
          <tr><td>Months paid</td><td>${escapeHtml(summary.months_paid)}</td></tr>
          <tr><td>Pending months</td><td>${escapeHtml(summary.months_pending)}</td></tr>
        </tbody>
        <tfoot><tr class="total"><td>Total contributions</td><td>${total}</td></tr></tfoot>
      </table>
      <h2>2. Payment history</h2>
      <table>
        <colgroup><col style="width:21%"><col style="width:22%"><col style="width:24%"><col style="width:17%"><col style="width:16%"></colgroup>
        <thead><tr><th>Period</th><th>Date</th><th>Method</th><th>UPI reference</th><th class="amount">Amount (₹)</th></tr></thead>
        <tbody>${historyRows || '<tr><td colspan="5">No payments recorded for this household.</td></tr>'}</tbody>
        <tfoot><tr class="total"><td colspan="4">Total recorded contributions</td><td class="amount">${total}</td></tr></tfoot>
      </table>
      <h2>3. Balance note</h2>
      <p class="statement-balance-note"><strong>Note:</strong> An outstanding balance is not shown because the backend does not provide an authoritative balance amount.</p>
      <p class="report-note"><strong>JazakAllahu Khairan — Household Appreciation &amp; Dua</strong><br>
        Dear ${resident} and family, thank you for supporting Masjid E Shameem. May Allah (SWT) accept your charity, place abundant barakah in your sustenance, grant health and peace to your household, and reward you in both worlds. Wassalamu Alaikum Wa Rahmatullahi Wa Barakatuh.</p>
      <table class="report-signatures"><tbody><tr><td><span>Prepared By (Secretary)</span></td><td><span>Verified By (Treasurer)</span></td><td><span>Approved By (President)</span></td></tr></tbody></table>
    `,
    undefined,
    'collection-report',
  );
}

export function buildReceiptHtml(payment: Payment) {
  const household = [payment.house_no, payment.household_name].filter(Boolean).join(' · ');
  const mode = paymentModeLabel(payment.payment_mode);
  const rows = [
    ['Receipt number', String(payment.id)],
    ['Household', household || `Household ${payment.household_id}`],
    ['Contribution period', contributionPeriod(payment.month, payment.year)],
    ['Contribution type', 'Monthly Masjid Subscription'],
    ['Payment date', dateLabel(payment.payment_date)],
    ['Payment method', mode],
  ];
  if (payment.payment_mode === 'split') {
    rows.push(['Cash portion', formatInrFromPaise(payment.cash_amount)]);
    rows.push(['UPI portion', formatInrFromPaise(payment.upi_amount)]);
  }
  if (payment.upi_reference) rows.push(['UPI reference', payment.upi_reference]);
  if (payment.recorded_by) rows.push(['Recorded by', payment.recorded_by]);
  const detailRows = rows.map(([label, value]) => (
    `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
  )).join('');
  const notes = payment.notes
    ? `<h2>Notes</h2><p class="note">${escapeHtml(payment.notes)}</p>`
    : '';
  return documentPage(
    'Payment Receipt',
    `Receipt #${payment.id} · ${contributionPeriod(payment.month, payment.year)}`,
    `<section class="receipt">
      <div class="receipt-details">
      <h2>Payment Details</h2>
      <table><tbody>${detailRows}
        <tr class="total"><td>Amount received</td><td class="amount">${escapeHtml(formatInrFromPaise(payment.amount))}</td></tr>
      </tbody></table>
      </div>
      ${notes}
      <p class="receipt-blessing">JazakAllahu Khairan for your generous contribution. May Allah (SWT) accept your charity, bless your household with health, barakah, and prosperity, and reward you immensely.</p>
      <p class="receipt-signature">Authorized Signatory / Cashier</p>
    </section>`,
    undefined,
    'receipt',
    receiptPdfTitle(payment),
  );
}
