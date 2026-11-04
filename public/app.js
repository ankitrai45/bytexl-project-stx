const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { token: localStorage.getItem('expense_token'), user: null, chart: null, editingId: null };
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}
async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...options.headers };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && state.token) logout(false);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new Error('Request failed. Please try again.');
    return response;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function showAuth() { $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function showApp() { $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden'); }
function setAuthTab(tab) {
  $$('.tab').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
  $('#loginForm').classList.toggle('hidden', tab !== 'login');
  $('#registerForm').classList.toggle('hidden', tab !== 'register');
}
function setUser(user) {
  state.user = user;
  $('#userName').textContent = user.name; $('#userEmail').textContent = user.email;
  $('#userAvatar').textContent = user.name.charAt(0).toUpperCase();
  $('#welcomeText').textContent = `Welcome back, ${user.name.split(' ')[0]} 👋`;
}
async function enterApp(user) {
  setUser(user); showApp(); $('#monthPicker').value = currentMonth(); await loadDashboard(); await loadTransactions(); await loadBudgets();
}
async function authSubmit(form, mode) {
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const data = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
    state.token = data.token; localStorage.setItem('expense_token', data.token);
    form.reset(); await enterApp(data.user); toast(mode === 'login' ? 'Welcome back!' : 'Account created successfully!');
  } catch (error) { toast(error.message); }
}
function logout(showMessage = true) {
  state.token = null; state.user = null; localStorage.removeItem('expense_token');
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  showAuth(); if (showMessage) toast('You have logged out.');
}
function page(name) {
  ['overview', 'transactions', 'budgets'].forEach(key => {
    $(`#${key}Page`).classList.toggle('hidden', key !== name);
    const nav = $(`.nav-link[data-page="${key}"]`); if (nav) nav.classList.toggle('active', key === name);
  });
  $('#pageTitle').textContent = name === 'overview' ? 'Overview' : name[0].toUpperCase() + name.slice(1);
}
function selectedMonth() { return $('#monthPicker').value || currentMonth(); }

async function loadDashboard() {
  try {
    const data = await api(`/api/dashboard?month=${encodeURIComponent(selectedMonth())}`);
    $('#balanceValue').textContent = money(data.balance); $('#incomeValue').textContent = money(data.income);
    $('#expenseValue').textContent = money(data.expense); $('#transactionCount').textContent = data.recent.length;
    const savings = data.income > 0 ? Math.round((data.income - data.expense) / data.income * 100) : 0;
    $('#savingsRate').textContent = `${savings}%`;
    $('#insightText').textContent = data.income === 0 && data.expense === 0
      ? 'No activity for this month yet. Add your first income or expense to get started.'
      : data.expense > data.income
        ? `Your expenses are ${money(data.expense - data.income)} higher than your income this month. Review your categories to find room to save.`
        : `Great work! You have ${money(data.income - data.expense)} remaining from this month's recorded income. Keep tracking consistently.`;
    renderChart(data.categories); renderRecent(data.recent);
  } catch (error) { toast(error.message); }
}
function renderChart(categories) {
  const canvas = $('#categoryChart'); const empty = $('#chartEmpty');
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  if (!categories.length) { canvas.classList.add('hidden'); empty.classList.remove('hidden'); return; }
  canvas.classList.remove('hidden'); empty.classList.add('hidden');
  state.chart = new Chart(canvas, {
    type: 'doughnut',
    data: { labels: categories.map(x => x.category), datasets: [{ data: categories.map(x => x.total), backgroundColor: ['#61d8d1','#a99bff','#ffad70','#63d6a0','#6ca9ed','#f17d9c','#d6c46b'], borderColor: '#121a2d', borderWidth: 4, hoverOffset: 7 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: '#b8c5da', padding: 16, usePointStyle: true, pointStyle: 'circle', font: { family: 'DM Sans', size: 11 } } } } }
  });
}
function transactionRow(item, actions = false) {
  const sign = item.type === 'income' ? '+' : '−';
  return `<div class="transaction-row">
    <div class="transaction-main"><div class="category-dot">${item.type === 'income' ? '↗' : '↘'}</div><div><strong>${escapeHTML(item.category)}</strong><small>${escapeHTML(item.description || item.date)} · ${escapeHTML(item.date)}</small></div></div>
    <span class="amount ${item.type}">${sign}${money(item.amount)}</span>
    ${actions ? `<div class="row-actions"><button class="small-btn" data-edit="${item.id}">Edit</button><button class="small-btn" data-delete="${item.id}">Delete</button></div>` : ''}
  </div>`;
}
function renderRecent(items) {
  $('#recentList').innerHTML = items.length ? items.map(item => transactionRow(item)).join('') : '<div class="empty-state"><strong>No transactions yet</strong>Add your first transaction to see it here.</div>';
}
function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
}
async function loadTransactions() {
  try {
    const params = new URLSearchParams({ month: selectedMonth() });
    if ($('#typeFilter').value) params.set('type', $('#typeFilter').value);
    if ($('#searchInput').value.trim()) params.set('search', $('#searchInput').value.trim());
    const data = await api(`/api/transactions?${params}`);
    const rows = data.transactions;
    $('#transactionTable').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Type</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${rows.map(item => `<tr><td>${escapeHTML(item.date)}</td><td>${escapeHTML(item.category)}</td><td>${escapeHTML(item.description || '—')}</td><td><span class="pill ${item.type}">${item.type}</span></td><td class="amount ${item.type}">${money(item.amount)}</td><td><button class="small-btn" data-edit="${item.id}">Edit</button> <button class="small-btn" data-delete="${item.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><strong>No matching transactions</strong>Try another search or add a transaction.</div>';
  } catch (error) { toast(error.message); }
}
function openModal(item = null) {
  const form = $('#transactionForm'); form.reset();
  $('#modalTitle').textContent = item ? 'Edit transaction' : 'Add transaction';
  form.elements.id.value = item?.id || '';
  form.elements.type.value = item?.type || 'expense';
  form.elements.amount.value = item?.amount || '';
  form.elements.category.value = item?.category || 'Food';
  form.elements.date.value = item?.date || today();
  form.elements.description.value = item?.description || '';
  $('#transactionDialog').showModal();
}
async function editTransaction(id) {
  try {
    const data = await api('/api/transactions');
    const item = data.transactions.find(row => row.id === Number(id));
    if (item) openModal(item); else toast('Transaction not found.');
  } catch (error) { toast(error.message); }
}
async function saveTransaction(event) {
  event.preventDefault();
  const form = event.currentTarget; const data = Object.fromEntries(new FormData(form).entries());
  const id = data.id; delete data.id;
  try {
    await api(id ? `/api/transactions/${id}` : '/api/transactions', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    $('#transactionDialog').close(); toast(id ? 'Transaction updated.' : 'Transaction added.');
    await loadDashboard(); await loadTransactions(); await loadBudgets();
  } catch (error) { toast(error.message); }
}
async function deleteTransaction(id) {
  if (!confirm('Delete this transaction? This cannot be undone.')) return;
  try { await api(`/api/transactions/${id}`, { method: 'DELETE' }); toast('Transaction deleted.'); await loadDashboard(); await loadTransactions(); await loadBudgets(); }
  catch (error) { toast(error.message); }
}
async function loadBudgets() {
  try {
    const data = await api(`/api/budgets?month=${encodeURIComponent(selectedMonth())}`);
    $('#budgetList').innerHTML = data.budgets.length ? data.budgets.map(budget => {
      const percent = Math.min(100, budget.spent / budget.monthly_limit * 100);
      const over = budget.spent > budget.monthly_limit;
      return `<article class="budget-card"><div class="panel-heading"><div><h3>${escapeHTML(budget.category)}</h3><p>${money(budget.spent)} spent of ${money(budget.monthly_limit)}</p></div><button class="small-btn" data-budget-delete="${budget.id}">Remove</button></div><div class="progress"><span style="width:${percent}%"></span></div><div class="budget-meta"><span class="${over ? 'danger-text' : ''}">${over ? 'Over budget' : `${Math.round(percent)}% used`}</span><span>${money(Math.max(0, budget.monthly_limit - budget.spent))} left</span></div></article>`;
    }).join('') : '<div class="panel empty-state"><strong>No budgets set for this month</strong>Create a category budget to start planning your spending.</div>';
  } catch (error) { toast(error.message); }
}
async function saveBudget(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.month = selectedMonth();
  try { await api('/api/budgets', { method: 'POST', body: JSON.stringify(payload) }); event.currentTarget.reset(); toast('Budget created.'); await loadBudgets(); }
  catch (error) { toast(error.message); }
}
async function deleteBudget(id) {
  if (!confirm('Remove this budget?')) return;
  try { await api(`/api/budgets/${id}`, { method: 'DELETE' }); toast('Budget removed.'); await loadBudgets(); }
  catch (error) { toast(error.message); }
}
async function exportCSV() {
  try {
    const response = await api('/api/export/csv');
    const blob = await response.blob(); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'expense-report.csv';
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    toast('CSV report downloaded.');
  } catch (error) { toast(error.message); }
}

$$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
$('#loginForm').addEventListener('submit', event => { event.preventDefault(); authSubmit(event.currentTarget, 'login'); });
$('#registerForm').addEventListener('submit', event => { event.preventDefault(); authSubmit(event.currentTarget, 'register'); });
$$('.nav-link[data-page]').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));
$$('[data-go]').forEach(button => button.addEventListener('click', () => page(button.dataset.go)));
$('#logoutBtn').addEventListener('click', () => logout());
$('#addTopBtn').addEventListener('click', () => openModal());
$('#closeModal').addEventListener('click', () => $('#transactionDialog').close());
$('#cancelModal').addEventListener('click', () => $('#transactionDialog').close());
$('#transactionForm').addEventListener('submit', saveTransaction);
$('#budgetForm').addEventListener('submit', saveBudget);
$('#monthPicker').addEventListener('change', async () => { await loadDashboard(); await loadTransactions(); await loadBudgets(); });
$('#searchInput').addEventListener('input', () => { clearTimeout(loadTransactions.timer); loadTransactions.timer = setTimeout(loadTransactions, 250); });
$('#typeFilter').addEventListener('change', loadTransactions);
$('#exportBtn').addEventListener('click', exportCSV);
document.addEventListener('click', event => {
  const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]');
  const budgetRemove = event.target.closest('[data-budget-delete]');
  if (edit) editTransaction(edit.dataset.edit);
  if (remove) deleteTransaction(remove.dataset.delete);
  if (budgetRemove) deleteBudget(budgetRemove.dataset.budgetDelete);
});

(async function init() {
  if (!state.token) return showAuth();
  try {
    const data = await api('/api/me'); await enterApp(data.user);
  } catch { logout(false); }
})();
