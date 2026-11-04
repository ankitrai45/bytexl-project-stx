require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./database');
const auth = require('./middleware/auth');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('replace_this')) {
  console.warn('WARNING: Set a strong, private JWT_SECRET in .env before deployment.');
}

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const emailValid = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validAmount = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100000000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'Expense Tracker API is running.' }));

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60)
      return res.status(400).json({ error: 'Name must contain 2–60 characters.' });
    if (!emailValid(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (typeof password !== 'string' || password.length < 8 || password.length > 72)
      return res.status(400).json({ error: 'Password must contain 8–72 characters.' });

    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run(name.trim(), email.trim().toLowerCase(), hash);
    const user = { id: Number(result.lastInsertRowid), name: name.trim(), email: email.trim().toLowerCase() };
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'An account with this email already exists.' });
    console.error(error);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!emailValid(email) || typeof password !== 'string') return res.status(400).json({ error: 'Enter your email and password.' });
    const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash)))
      return res.status(401).json({ error: 'Incorrect email or password.' });
    const user = { id: userRow.id, name: userRow.name, email: userRow.email };
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

app.get('/api/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

app.get('/api/dashboard', auth, (req, res) => {
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month : new Date().toISOString().slice(0, 7);
  const start = `${month}-01`;
  const end = `${month}-31`;
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
    FROM transactions WHERE user_id=? AND date BETWEEN ? AND ?
  `).get(req.user.id, start, end);
  const recent = db.prepare('SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC LIMIT 6').all(req.user.id);
  const categories = db.prepare(`
    SELECT category, SUM(amount) AS total FROM transactions
    WHERE user_id=? AND type='expense' AND date BETWEEN ? AND ?
    GROUP BY category ORDER BY total DESC
  `).all(req.user.id, start, end);
  res.json({ month, income: totals.income, expense: totals.expense, balance: totals.income - totals.expense, recent, categories });
});

app.get('/api/transactions', auth, (req, res) => {
  const { type, search, month } = req.query;
  let sql = 'SELECT * FROM transactions WHERE user_id=?';
  const params = [req.user.id];
  if (type === 'income' || type === 'expense') { sql += ' AND type=?'; params.push(type); }
  if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) { sql += ' AND substr(date,1,7)=?'; params.push(month); }
  if (typeof search === 'string' && search.trim()) {
    sql += ' AND (category LIKE ? OR description LIKE ?)';
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }
  sql += ' ORDER BY date DESC, id DESC LIMIT 500';
  res.json({ transactions: db.prepare(sql).all(...params) });
});

app.post('/api/transactions', auth, (req, res) => {
  const { type, amount, category, description = '', date } = req.body || {};
  if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Choose income or expense.' });
  if (!validAmount(amount)) return res.status(400).json({ error: 'Amount must be greater than zero.' });
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 40) return res.status(400).json({ error: 'Enter a category (up to 40 characters).' });
  if (typeof description !== 'string' || description.length > 200) return res.status(400).json({ error: 'Description must be 200 characters or fewer.' });
  if (!validDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });
  const result = db.prepare('INSERT INTO transactions (user_id,type,amount,category,description,date) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, type, Number(amount), category.trim(), description.trim(), date);
  res.status(201).json({ transaction: db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(result.lastInsertRowid, req.user.id) });
});

app.put('/api/transactions/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const { type, amount, category, description = '', date } = req.body || {};
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid transaction ID.' });
  if (!['income', 'expense'].includes(type) || !validAmount(amount) || typeof category !== 'string' || !category.trim() || category.trim().length > 40 || typeof description !== 'string' || description.length > 200 || !validDate(date))
    return res.status(400).json({ error: 'Check all transaction fields.' });
  const result = db.prepare(`UPDATE transactions SET type=?,amount=?,category=?,description=?,date=? WHERE id=? AND user_id=?`)
    .run(type, Number(amount), category.trim(), description.trim(), date, id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Transaction not found.' });
  res.json({ transaction: db.prepare('SELECT * FROM transactions WHERE id=? AND user_id=?').get(id, req.user.id) });
});

app.delete('/api/transactions/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Transaction not found.' });
  res.json({ message: 'Transaction deleted.' });
});

app.get('/api/budgets', auth, (req, res) => {
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const budgets = db.prepare(`
    SELECT b.*, COALESCE((
      SELECT SUM(t.amount) FROM transactions t
      WHERE t.user_id=b.user_id AND t.category=b.category AND t.type='expense' AND substr(t.date,1,7)=b.month
    ),0) AS spent
    FROM budgets b WHERE b.user_id=? AND b.month=? ORDER BY b.category
  `).all(req.user.id, month);
  res.json({ budgets });
});

app.post('/api/budgets', auth, (req, res) => {
  const { category, monthly_limit, month } = req.body || {};
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 40 || !validAmount(monthly_limit) || typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month))
    return res.status(400).json({ error: 'Enter a category, positive limit and month.' });
  try {
    const result = db.prepare('INSERT INTO budgets (user_id,category,monthly_limit,month) VALUES (?,?,?,?)')
      .run(req.user.id, category.trim(), Number(monthly_limit), month);
    res.status(201).json({ budget: db.prepare('SELECT * FROM budgets WHERE id=? AND user_id=?').get(result.lastInsertRowid, req.user.id) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A budget for this category and month already exists.' });
    throw error;
  }
});

app.delete('/api/budgets/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM budgets WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Budget not found.' });
  res.json({ message: 'Budget deleted.' });
});

app.get('/api/export/csv', auth, (req, res) => {
  const rows = db.prepare('SELECT date,type,category,description,amount FROM transactions WHERE user_id=? ORDER BY date DESC')
    .all(req.user.id);
  const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = ['Date,Type,Category,Description,Amount', ...rows.map(r =>
    [r.date, r.type, r.category, r.description, r.amount].map(quote).join(',')
  )].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expense-report.csv"');
  res.send('\uFEFF' + csv);
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Simple Expense Tracker running at http://localhost:${PORT}`));
