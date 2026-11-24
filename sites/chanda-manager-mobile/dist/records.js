const records = document.getElementById('record-panel');
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const months = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, index, 1))));
let recordVersion = 0;
const money = (paise) => rupees.format(Number(paise || 0) / 100);
const asRupees = (paise) => paise == null ? '' : (Number(paise) / 100).toFixed(2);
const safe = (value) => escapeHtml(value);
const title = (text, actions = '') => `<div class="work-heading"><h2>${safe(text)}</h2>${actions}</div>`;
const action = (label, command, value) =>
  `<button class="quiet" type="button" data-${command}="${safe(value)}">${safe(label)}</button>`;
const linkButton = (label, section) => action(label, 'go', section);
const field = (label, name, value = '', attributes = '') =>
  `<label>${safe(label)}<input name="${name}" value="${safe(value)}" ${attributes}></label>`;
const select = (label, name, choices, value) =>
  `<label>${safe(label)}<select name="${name}">${choices.map(([key, caption]) =>
    `<option value="${safe(key)}"${String(key) === String(value) ? ' selected' : ''}>${safe(caption)}</option>`).join('')}</select></label>`;
const primary = (label) => `<button class="button" type="submit">${safe(label)}</button>`;
const dated = (year, month) => `${months[Number(month) - 1] || ''} ${year ?? ''}`.trim();

function businessDay() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format();
}

function table(headers, rows, empty) {
  if (!rows.length) return `<p class="work-empty">${safe(empty)}</p>`;
  return `<div class="work-table" tabindex="0" role="region" aria-label="${safe(headers.join(', '))}"><table><thead><tr>${headers
    .map((item) => `<th scope="col">${safe(item)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function paymentTable(items, includeHouse = true) {
  const columns = ['Payment date', 'For month', 'Method', 'Amount', ''];
  if (includeHouse) columns.unshift('House');
  return table(columns, items.map((item) => {
    const values = [safe(item.payment_date), safe(dated(item.year, item.month)), safe(item.payment_mode), safe(money(item.amount)),
      action('View payment', 'payment', item.id)];
    if (includeHouse) values.unshift(`<strong>${safe(item.house_no)}</strong> ${safe(item.household_name)}`);
    return values;
  }), 'No payments to show.');
}

function clearRecords() {
  ++recordVersion;
  records.replaceChildren();
}

async function openRecords(section, detail) {
  const ticket = ++recordVersion;
  records.innerHTML = '<p role="status">Loading records…</p>';
  const render = (html) => {
    if (ticket === recordVersion && currentUser) records.innerHTML = html;
  };
  try {
    await recordViews[section](render, detail);
  } catch (error) {
    if (ticket === recordVersion && currentUser) render(`<p role="alert">${safe(error.message)}</p>`);
  }
}

async function dashboard(render) {
  const data = await request('/api/dashboard');
  render(title('Home', linkButton('Record payment', 'collect')) +
    `<p class="muted">${safe(data.month_label)}</p>
    <dl class="work-metrics">
      <div><dt>Collected</dt><dd>${money(data.total_collection_paise)}</dd></div>
      <div><dt>Homes paid</dt><dd>${safe(data.households_paid)} of ${safe(data.active_households)}</dd></div>
      <div><dt>Homes pending</dt><dd>${safe(data.households_pending)}</dd></div>
      <div><dt>Cash</dt><dd>${money(data.cash_paise)}</dd></div>
      <div><dt>UPI</dt><dd>${money(data.upi_paise)}</dd></div>
    </dl><h3>Recent payments</h3>` + paymentTable(data.recent));
}

async function homes(render, { search = '', status = 'all', offset = 0 } = {}) {
  const limit = 40;
  const { total, items } = await request('/api/households?' + new URLSearchParams({ search, status, offset, limit }));
  render(title('Homes', action('Add household', 'homeedit', 'new')) + `
    <form class="filters" data-form="homes">
      ${field('Search homes', 'search', search, 'type="search"')}
      ${select('Status', 'status', [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']], status)}
      ${primary('Search')}
    </form>
    <p class="muted">${safe(total)} matching households</p>` +
    table(['House', 'Name', 'Monthly chanda', 'Status', ''], items.map((item) => [
      safe(item.house_no), safe(item.name), money(item.monthly_amount), safe(item.status), action('View household', 'house', item.id),
    ]), 'No matching households.') + `<div class="actions work-pages">
      ${offset > 0 ? action('Previous', 'homepage', Math.max(0, offset - limit)) : ''}
      ${offset + items.length < total ? action('Next', 'homepage', offset + items.length) : ''}
    </div>`);
}

async function house(render, id) {
  const { household, payments, summary } = await request('/api/households/' + id);
  render(title(`${household.house_no} · ${household.name}`, linkButton('Back to homes', 'homes')) +
    `<dl class="work-metrics"><div><dt>Monthly chanda</dt><dd>${money(household.monthly_amount)}</dd></div>
       <div><dt>Total recorded</dt><dd>${money(summary.total_amount_paise)}</dd></div>
       <div><dt>Contact</dt><dd>${safe(household.phone || '—')}</dd></div>
       <div><dt>Status</dt><dd>${safe(household.status)}</dd></div></dl>
    <div class="actions">${action('Edit household', 'homeedit', id)}${action('Record payment', 'collect', id)}</div>
    <h3>Payment history</h3>` + paymentTable(payments, false));
}

async function homeEditor(render, id) {
  const household = id ? (await request('/api/households/' + id)).household : {};
  render(title(id ? 'Edit household' : 'Add household', id ? action('Cancel', 'house', id) : linkButton('Cancel', 'homes')) + `
    <form class="admin-form work-form" data-form="household" data-id="${safe(id || '')}">
      ${field('House number', 'house_no', household.house_no, 'required maxlength="50"')}
      ${field('Name', 'name', household.name, 'required maxlength="100"')}
      ${field('Phone', 'phone', household.phone, 'type="tel" maxlength="30"')}
      ${field('Monthly chanda (₹)', 'monthly_amount', asRupees(household.monthly_amount), 'type="number" min="0" step=".01" required')}
      ${select('Status', 'status', [['active', 'Active'], ['inactive', 'Inactive']], household.status || 'active')}
      ${primary('Save household')}<p class="form-status" role="alert"></p>
    </form>`);
}

async function collect(render, { householdId, paymentId } = {}) {
  const current = paymentId ? (await request('/api/payments/' + paymentId)).payment : null;
  const selected = current?.household_id ?? householdId;
  const today = businessDay();
  const [year, month] = today.split('-').map(Number);
  const { items, total } = await request('/api/households?status=active&limit=500');
  if (selected && !items.some((item) => item.id === Number(selected))) {
    const { household } = await request('/api/households/' + selected);
    items.unshift(household);
  }
  const selectedHome = items.find((home) => home.id === Number(selected));
  const options = items.map(({ id, house_no, name, monthly_amount }) =>
    `<option value="${Number(id)}" data-amount="${safe(asRupees(monthly_amount))}"${id === Number(selected) ? ' selected' : ''}>${safe(house_no)} · ${safe(name)}</option>`).join('');
  const mode = current?.payment_mode || 'cash';
  render(title(paymentId ? 'Edit payment' : 'Collect', paymentId ? action('Cancel', 'payment', paymentId) : '') + `
    ${total > 500 ? '<p>For a household outside this list, find it under Homes and choose Record payment.</p>' : ''}
    <form class="admin-form work-form" data-form="payment" data-id="${safe(paymentId || '')}">
      <label>Household <select name="household_id" required><option value="">Select household</option>${options}</select></label>
      <div class="work-fields">
        ${select('Month', 'month', months.map((label, index) => [index + 1, label]), current?.month ?? month)}
        ${field('Year', 'year', current?.year ?? year, 'type="number" min="2000" max="2100" required')}
        ${field('Payment date', 'payment_date', current?.payment_date ?? today, `type="date" max="${today}" required`)}
        ${field('Total (₹)', 'amount', asRupees(current?.amount ?? selectedHome?.monthly_amount), 'type="number" min=".01" step=".01" required')}
      </div>
      ${select('Payment method', 'payment_mode', [['cash', 'Cash'], ['upi', 'UPI'], ['split', 'Cash and UPI']], mode)}
      <div class="work-fields" data-split ${mode !== 'split' ? 'hidden' : ''}>
        ${field('Cash (₹)', 'cash_amount', asRupees(current?.cash_amount), 'type="number" min="0" step=".01"')}
        ${field('UPI (₹)', 'upi_amount', asRupees(current?.upi_amount), 'type="number" min="0" step=".01"')}
      </div>
      ${field('UPI reference', 'upi_reference', current?.upi_reference, 'maxlength="100"')}
      <label>Notes <textarea name="notes" maxlength="500">${safe(current?.notes)}</textarea></label>
      ${primary(paymentId ? 'Save changes' : 'Record payment')}<p class="form-status" role="alert"></p>
    </form>`);
}

async function payment(render, id) {
  const { payment: item } = await request('/api/payments/' + id);
  render(title('Payment record', action('View household', 'house', item.household_id)) + `
    <div class="work-print">
      <h3>Masjid E Shameem · Chanda receipt</h3>
      <dl class="work-metrics">
        <div><dt>Household</dt><dd>${safe(item.house_no)} · ${safe(item.household_name)}</dd></div>
        <div><dt>Amount</dt><dd>${money(item.amount)}</dd></div>
        <div><dt>Contribution month</dt><dd>${safe(dated(item.year, item.month))}</dd></div>
        <div><dt>Payment date</dt><dd>${safe(item.payment_date)}</dd></div>
        <div><dt>Method</dt><dd>${safe(item.payment_mode)}</dd></div>
        ${item.payment_mode === 'split' ? `<div><dt>Cash / UPI</dt><dd>${money(item.cash_amount)} / ${money(item.upi_amount)}</dd></div>` : ''}
        ${item.upi_reference ? `<div><dt>UPI reference</dt><dd>${safe(item.upi_reference)}</dd></div>` : ''}
        ${item.notes ? `<div><dt>Notes</dt><dd>${safe(item.notes)}</dd></div>` : ''}
      </dl>
    </div>
    <div class="actions">
      ${action('Edit payment', 'editpayment', id)}
      ${action('Print receipt', 'print', 'receipt')}
      <form data-form="deletepayment" data-id="${safe(id)}" data-house="${safe(item.household_id)}">
        <button class="quiet danger" type="submit">Delete payment</button><p class="form-status" role="alert"></p>
      </form>
    </div>`);
}

async function reports(render, values = {}) {
  const [year, month] = businessDay().split('-').map(Number);
  const criteria = { type: 'monthly', mode: 'all', year, month, ...values };
  const data = await request('/api/reports/data?' + new URLSearchParams(criteria));
  const summary = data.summary;
  const monthly = data.type === 'monthly';
  render(title('Reports', action('Print / Save PDF', 'print', 'report')) + `
    <form class="filters" data-form="reports">
      ${select('Report', 'type', [['monthly', 'Monthly'], ['annual', 'Annual']], criteria.type)}
      ${select('Month', 'month', months.map((label, index) => [index + 1, label]), criteria.month)}
      ${field('Year', 'year', criteria.year, 'type="number" min="2000" max="2100" required')}
      ${select('Method', 'mode', [['all', 'All'], ['cash', 'Cash'], ['upi', 'UPI']], criteria.mode)}
      ${primary('View report')}
    </form>
    <div class="work-print">
    <h3>${safe(data.label || (monthly ? dated(criteria.year, criteria.month) : criteria.year))}</h3>
    <dl class="work-metrics">
      <div><dt>Total collected</dt><dd>${money(summary.total_collection_paise)}</dd></div>
      <div><dt>Cash</dt><dd>${money(summary.cash_paise)}</dd></div>
      <div><dt>UPI</dt><dd>${money(summary.upi_paise)}</dd></div>
      <div><dt>Transactions</dt><dd>${safe(summary.transactions)}</dd></div>
    </dl>
    ${monthly ? '<h3>Payments</h3>' + paymentTable(data.rows) + '<h3>Pending households</h3>' +
      table(['House', 'Name', 'Expected chanda'], data.pending.map((item) =>
        [safe(item.house_no), safe(item.household_name), money(item.monthly_amount)]), 'No pending households.') :
      '<h3>Monthly totals</h3>' + table(['Month', 'Homes paid', 'Total'], data.monthly.map((item) =>
        [safe(item.month_label || months[item.month - 1]), safe(item.households_paid), money(item.total_paise)]), 'No payments for this year.') +
      '<h3>Household totals</h3>' + table(['House', 'Name', 'Total'], (data.households || []).map((item) =>
        [safe(item.house_no), safe(item.name || item.household_name), money(item.total_paise)]), 'No household totals.')}
    </div>`);
}

async function settings(render) {
  const { user } = await request('/api/settings');
  render(title('Settings') + `<div class="work-fields">
    <form class="admin-form work-form" data-form="profile">
      <h3>Profile</h3><p class="muted">${safe(user.email)}</p>
      ${field('Name', 'name', user.name, 'required maxlength="100"')}
      ${primary('Save profile')}<p class="form-status" role="alert"></p>
    </form>
    <form class="admin-form work-form" method="post" data-form="password">
      <h3>Change password</h3>
      ${field('Current password', 'current_password', '', 'type="password" autocomplete="current-password" required')}
      ${field('New password', 'new_password', '', 'type="password" autocomplete="new-password" minlength="15" required')}
      ${primary('Change password')}<p class="form-status" role="alert"></p>
    </form>
  </div>`);
}

const recordViews = { home: dashboard, homes, house, homeEditor, collect, payment, reports, settings };
records.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  const { go, house, homeedit, payment, collect, editpayment, homepage, print } = button.dataset;
  if (go) selectSection(go);
  else if (house) void openRecords('house', Number(house));
  else if (homeedit) void openRecords('homeEditor', homeedit === 'new' ? null : Number(homeedit));
  else if (payment) void openRecords('payment', Number(payment));
  else if (collect) { selectRecordTab('collect'); void openRecords('collect', { householdId: Number(collect) }); }
  else if (editpayment) void openRecords('collect', { paymentId: Number(editpayment) });
  else if (homepage) void openRecords('homes', { ...formValues(records.querySelector('form[data-form="homes"]')), offset: Number(homepage) });
  else if (print) window.print();
});

function selectRecordTab(section) {
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.section === section));
  });
}

records.addEventListener('change', (event) => {
  const field = event.target;
  const form = field.closest('[data-form="payment"]');
  if (!form) return;
  if (field.name === 'household_id' && !form.dataset.id) {
    form.elements.amount.value = field.selectedOptions[0]?.dataset.amount || '';
  }
  if (field.name === 'payment_mode') form.querySelector('[data-split]').hidden = field.value !== 'split';
});

async function saveRecord(form, type, data) {
  const { id, house } = form.dataset;
  if (type === 'household') {
    const { household } = await request('/api/households' + (id ? '/' + id : ''), id ? 'PUT' : 'POST', data);
    if (!form.isConnected) return;
    message('Household saved.');
    return openRecords('house', household.id);
  }
  if (type === 'payment') {
    if (data.payment_mode === 'split') {
      const paise = (amount) => Math.round(Number(amount) * 100);
      if (!data.cash_amount || !data.upi_amount || paise(data.cash_amount) + paise(data.upi_amount) !== paise(data.amount)) {
        throw new Error('Enter cash and UPI amounts that add up to the total.');
      }
    } else {
      delete data.cash_amount;
      delete data.upi_amount;
    }
    const path = '/api/payments' + (id ? '/' + id : '');
    const verb = id ? 'PUT' : 'POST';
    let result;
    try {
      result = await request(path, verb, data);
    } catch (error) {
      if (!form.isConnected || error.status !== 409 || !error.data?.duplicate ||
          !window.confirm(`${error.message} ${id ? 'Save this change anyway?' : 'Save an additional payment?'}`)) throw error;
      result = await request(path, verb, { ...data, force: true });
    }
    if (!result.payment?.id) throw new Error('The server did not confirm the saved payment.');
    if (!form.isConnected) return;
    message('Payment saved.');
    return openRecords('payment', result.payment.id);
  }
  if (type === 'deletepayment') {
    if (!window.confirm('Delete this payment record? This cannot be undone.')) return;
    await request('/api/payments/' + id, 'DELETE');
    if (!form.isConnected) return;
    message('Payment deleted.');
    return openRecords('house', Number(house));
  }
  await request('/api/settings/' + type, 'PUT', data);
  if (!form.isConnected) return;
  if (type === 'password') form.reset();
  message(type === 'password' ? 'Password changed.' : 'Profile saved.');
}

records.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const type = form.dataset.form;
  const data = type === 'password' ? takeCredentials(form) : formValues(form);
  message();
  if (type === 'homes' || type === 'reports') {
    void openRecords(type, data);
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.form-status');
  if (!button || button.disabled) return;
  button.disabled = true;
  status.textContent = '';
  try {
    await saveRecord(form, type, data);
  } catch (error) {
    if (form.isConnected) status.textContent = error.message;
    else if (!currentUser) message(error.message, true);
  } finally {
    button.disabled = false;
  }
});
