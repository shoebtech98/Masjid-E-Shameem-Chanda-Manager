const byId = (id) => document.getElementById(id);
const login = byId('login');
const workspace = byId('workspace');
const notice = byId('notice');
const dialog = byId('account-dialog');
const accountForm = byId('account-form');
const auditSearch = byId('audit-search');
const userSearch = byId('user-search');
const more = byId('audit-more');
const pageSize = 30;
let currentUser;
let userRows = [];
let auditOffset = 0;
let auditVersion = 0;
let usersVersion = 0;
let saveAccount;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const dateLabel = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
});

function date(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? dateLabel.format(parsed) : '';
}

function message(text = '', error = false) {
  notice.textContent = text;
  notice.toggleAttribute('data-error', error);
}

function showUser(user) {
  currentUser = user;
  login.hidden = Boolean(user);
  workspace.hidden = !user;
  byId('logout').hidden = !user;
  if (!user) {
    ++auditVersion;
    ++usersVersion;
    userRows = [];
    ['user-list', 'audit-list', 'audit-summary', 'audit-count'].forEach((id) => byId(id).replaceChildren());
    clearRecords();
    more.hidden = true;
    if (dialog.open) dialog.close();
  }
}

async function request(path, method = 'GET', data) {
  const response = await fetch(path, {
    method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (currentUser && [401, 403].includes(response.status) && !(path === '/api/settings/password' && result.error === 'Current password is incorrect.')) showUser();
    throw Object.assign(new Error(result.error || 'The request failed. Please try again.'), { status: response.status, data: result });
  }
  return result;
}

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

function takeCredentials(form) {
  const values = formValues(form);
  for (const input of form.querySelectorAll('input[type="password"]')) input.value = '';
  return values;
}

async function loadUsers() {
  const version = ++usersVersion;
  const list = byId('user-list');
  list.textContent = 'Loading user accounts…';
  try {
    const { users } = await request('/api/users?' + new URLSearchParams(formValues(userSearch)));
    if (version !== usersVersion) return;
    userRows = users;
    list.innerHTML = users.length ? users.map((user, index) => {
      const self = user.id === currentUser.id;
      return `<article class="record">
        <div><h3>${escapeHtml(user.name)}${self ? ' (you)' : ''}</h3>
          <p class="muted">${escapeHtml(user.email)}</p>
          <p class="record-meta">${escapeHtml(user.role)} · ${escapeHtml(user.status)}</p>
        </div>
        <div class="actions">
          ${self ? '' : `<button class="quiet" type="button" data-action="edit" data-index="${index}">Edit access</button>`}
          <button class="quiet" type="button" data-action="password" data-index="${index}">Reset password</button>
          ${self ? '' : `<button class="quiet danger" type="button" data-action="delete" data-index="${index}">Delete user</button>`}
        </div>
      </article>`;
    }).join('') : '<p>No users match this search.</p>';
  } catch (error) {
    if (version === usersVersion) list.replaceChildren();
    message(error.message, true);
  }
}

async function loadAudit(append = false) {
  const version = ++auditVersion;
  const list = byId('audit-list');
  if (!append) {
    auditOffset = 0;
    list.replaceChildren();
    byId('audit-summary').replaceChildren();
  }
  more.disabled = true;
  const offset = auditOffset;
  const params = new URLSearchParams({ ...formValues(auditSearch), offset, limit: pageSize });
  byId('audit-count').textContent = 'Loading audit records…';
  try {
    const [records, stats] = await Promise.all([
      request('/api/audit?' + params),
      append ? null : request('/api/audit/stats'),
    ]);
    if (version !== auditVersion) return;
    if (stats) {
      byId('audit-summary').textContent = [`${stats.total} total records`, ...stats.by_entity.map(({ c, entity }) => `${c} ${entity}`)].join(' · ');
    }
    list.insertAdjacentHTML('beforeend', records.items.map((item) => `<article class="record">
      <div><h3>${escapeHtml(item.action)} · ${escapeHtml(item.entity)}</h3><p>${escapeHtml(item.description)}</p></div>
      <p class="muted">${escapeHtml(item.user_name || 'System')} · ${escapeHtml(date(item.created_at))}</p>
    </article>`).join(''));
    auditOffset = offset + records.items.length;
    byId('audit-count').textContent = records.total ? `Showing ${auditOffset} of ${records.total} matching records` : 'No audit records match these filters.';
    more.hidden = !records.items.length || auditOffset >= records.total;
  } catch (error) {
    if (version === auditVersion) {
      byId('audit-count').textContent = '';
      message(error.message, true);
    }
  } finally {
    if (version === auditVersion) more.disabled = false;
  }
}

function selectSection(section) {
  document.querySelectorAll('[data-section]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.section === section));
  });
  byId('users').hidden = section !== 'users';
  byId('audit').hidden = section !== 'audit';
  const isRecords = section !== 'users' && section !== 'audit';
  byId('record-panel').hidden = !isRecords;
  if (!isRecords) clearRecords();
  message();
  if (section === 'users') void loadUsers();
  else if (section === 'audit') void loadAudit();
  else void openRecords(section);
}

function openAccount(action, user) {
  if (!currentUser) return;
  let title;
  let submit = 'Save';
  let fields;
  const role = (value = 'treasurer') => `<label>Role <select name="role"><option value="treasurer"${value === 'treasurer' ? ' selected' : ''}>Treasurer</option><option value="admin"${value === 'admin' ? ' selected' : ''}>Admin</option></select></label>`;
  const password = '<label>New password <input name="password" type="password" autocomplete="new-password" minlength="15" required></label>';
  if (action === 'add') {
    title = 'Add user';
    fields = '<label>Name <input name="name" maxlength="100" required></label><label>Email <input name="email" type="email" maxlength="254" required></label>' + role() + password;
    saveAccount = (data) => request('/api/users', 'POST', data);
  } else {
    if (!user || !Number.isInteger(user.id)) return;
    const path = '/api/users/' + user.id;
    if (action === 'edit' && user.id !== currentUser.id) {
      title = 'Edit access';
      fields = `<p>${escapeHtml(user.name)}</p>` + role(user.role) + `<label>Access <select name="status"><option value="active">Active</option><option value="inactive"${user.status === 'inactive' ? ' selected' : ''}>Inactive</option></select></label>`;
      saveAccount = (data) => request(path, 'PUT', data);
    } else if (action === 'password') {
      title = 'Reset password';
      fields = `<p>${escapeHtml(user.name)}</p>` + password;
      saveAccount = ({ password: new_password }) => request(path + '/password', 'PUT', { new_password });
    } else if (action === 'delete' && user.id !== currentUser.id) {
      title = 'Delete user';
      submit = 'Delete user';
      fields = `<p>Delete ${escapeHtml(user.name)}’s account? This action cannot be undone.</p>`;
      saveAccount = () => request(path, 'DELETE');
    } else return;
  }
  byId('dialog-title').textContent = title;
  byId('dialog-submit').textContent = submit;
  byId('dialog-error').textContent = '';
  byId('dialog-fields').innerHTML = fields;
  dialog.showModal();
}

login.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = login.querySelector('button');
  button.disabled = true;
  message('Signing in…');
  try {
    const { user } = await request('/api/session', 'POST', takeCredentials(login));
    login.reset();
    showUser(user);
    selectSection('home');
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});

byId('logout').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request('/api/session', 'DELETE');
    showUser();
    message('Signed out.');
  } catch (error) {
    message(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('.admin-tabs').addEventListener('click', (event) => {
  const section = event.target.closest('[data-section]')?.dataset.section;
  if (section) selectSection(section);
});
userSearch.addEventListener('submit', (event) => { event.preventDefault(); message(); void loadUsers(); });
auditSearch.addEventListener('submit', (event) => { event.preventDefault(); message(); void loadAudit(); });
more.addEventListener('click', () => { message(); void loadAudit(true); });
byId('add-user').addEventListener('click', () => openAccount('add'));
byId('user-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) openAccount(button.dataset.action, userRows[Number(button.dataset.index)]);
});
byId('dialog-cancel').addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', (event) => {
  if (byId('dialog-submit').disabled) event.preventDefault();
});
dialog.addEventListener('close', () => { byId('dialog-fields').replaceChildren(); saveAccount = undefined; });
accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('dialog-submit');
  const cancel = byId('dialog-cancel');
  if (!saveAccount || button.disabled) return;
  button.disabled = cancel.disabled = true;
  byId('dialog-error').textContent = '';
  try {
    await saveAccount(takeCredentials(accountForm));
    dialog.close();
    message('Account updated.');
    await loadUsers();
  } catch (error) {
    if (dialog.open) byId('dialog-error').textContent = error.message;
    else message(error.message, true);
  } finally {
    button.disabled = cancel.disabled = false;
  }
});

request('/api/session').then(({ user }) => {
  showUser(user);
  selectSection('home');
}).catch((error) => {
  showUser();
  if (error.message !== 'Sign in as an administrator.') message(error.message, true);
});
