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
  console.warn('⚠️  WARNING: Set a strong, private JWT_SECRET in .env or your deployment environment.');
}

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// Input validation helpers
const emailValid = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const validAmount = value => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100000000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected', message: 'Expense Tracker API is running.' });
  } catch (err) {
    res.status(200).json({
      status: 'degraded',
      database: 'disconnected',
      error: err.message,
      message: 'Expense Tracker API is running, but database is not reachable.',
    });
  }
});

// Register user
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      return res.status(400).json({ error: 'Name must contain 2–60 characters.' });
    }
    if (!emailValid(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must contain 8–72 characters.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name.trim(), email.trim().toLowerCase(), hash]
    );

    const user = { id: Number(rows[0].id), name: rows[0].name, email: rows[0].email };
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (error) {
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Could not create account.' });
  }
});

// Login user
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!emailValid(email) || typeof password !== 'string') {
      return res.status(400).json({ error: 'Enter your email and password.' });
    }

    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const userRow = rows[0];

    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash))) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const user = { id: Number(userRow.id), name: userRow.name, email: userRow.email };
    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Could not log in.' });
  }
});

// Current user profile
app.get('/api/me', auth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, name, email FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: { id: Number(user.id), name: user.name, email: user.email } });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Could not fetch user profile.' });
  }
});

// Dashboard statistics
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : new Date().toISOString().slice(0, 7);

    const start = `${month}-01`;
    const end = `${month}-31`;

    const totalsResult = await db.query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
      FROM transactions WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
      [req.user.id, start, end]
    );

    const totals = totalsResult.rows[0] || { income: 0, expense: 0 };
    const income = Number(totals.income) || 0;
    const expense = Number(totals.expense) || 0;

    const recentResult = await db.query(
      'SELECT id, user_id, type, amount, category, description, date, created_at FROM transactions WHERE user_id = $1 ORDER BY date DESC, id DESC LIMIT 6',
      [req.user.id]
    );
    const recent = recentResult.rows.map(r => ({ ...r, id: Number(r.id), amount: Number(r.amount) }));

    const categoriesResult = await db.query(
      `SELECT category, SUM(amount) AS total FROM transactions
      WHERE user_id = $1 AND type = 'expense' AND date BETWEEN $2 AND $3
      GROUP BY category ORDER BY total DESC`,
      [req.user.id, start, end]
    );
    const categories = categoriesResult.rows.map(r => ({ ...r, total: Number(r.total) }));

    res.json({
      month,
      income,
      expense,
      balance: income - expense,
      recent,
      categories,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Could not load dashboard data.' });
  }
});

// List and search transactions
app.get('/api/transactions', auth, async (req, res) => {
  try {
    const { type, search, month } = req.query;
    let sql = 'SELECT id, user_id, type, amount, category, description, date, created_at FROM transactions WHERE user_id = $1';
    const params = [req.user.id];
    let paramIndex = 2;

    if (type === 'income' || type === 'expense') {
      sql += ` AND type = $${paramIndex++}`;
      params.push(type);
    }
    if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) {
      sql += ` AND SUBSTR(date, 1, 7) = $${paramIndex++}`;
      params.push(month);
    }
    if (typeof search === 'string' && search.trim()) {
      sql += ` AND (category ILIKE $${paramIndex} OR description ILIKE $${paramIndex + 1})`;
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      paramIndex += 2;
    }

    sql += ' ORDER BY date DESC, id DESC LIMIT 500';

    const { rows } = await db.query(sql, params);
    const transactions = rows.map(r => ({ ...r, id: Number(r.id), amount: Number(r.amount) }));
    res.json({ transactions });
  } catch (error) {
    console.error('Fetch transactions error:', error);
    res.status(500).json({ error: 'Could not fetch transactions.' });
  }
});

// Create transaction
app.post('/api/transactions', auth, async (req, res) => {
  try {
    const { type, amount, category, description = '', date } = req.body || {};
    if (!['income', 'expense'].includes(type)) return res.status(400).json({ error: 'Choose income or expense.' });
    if (!validAmount(amount)) return res.status(400).json({ error: 'Amount must be greater than zero.' });
    if (typeof category !== 'string' || !category.trim() || category.trim().length > 40) {
      return res.status(400).json({ error: 'Enter a category (up to 40 characters).' });
    }
    if (typeof description !== 'string' || description.length > 200) {
      return res.status(400).json({ error: 'Description must be 200 characters or fewer.' });
    }
    if (!validDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });

    const { rows } = await db.query(
      `INSERT INTO transactions (user_id, type, amount, category, description, date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, type, amount, category, description, date, created_at`,
      [req.user.id, type, Number(amount), category.trim(), description.trim(), date]
    );

    const transaction = { ...rows[0], id: Number(rows[0].id), amount: Number(rows[0].amount) };
    res.status(201).json({ transaction });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ error: 'Could not create transaction.' });
  }
});

// Update transaction
app.put('/api/transactions/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { type, amount, category, description = '', date } = req.body || {};

    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid transaction ID.' });
    if (
      !['income', 'expense'].includes(type) ||
      !validAmount(amount) ||
      typeof category !== 'string' ||
      !category.trim() ||
      category.trim().length > 40 ||
      typeof description !== 'string' ||
      description.length > 200 ||
      !validDate(date)
    ) {
      return res.status(400).json({ error: 'Check all transaction fields.' });
    }

    const { rows } = await db.query(
      `UPDATE transactions
       SET type = $1, amount = $2, category = $3, description = $4, date = $5
       WHERE id = $6 AND user_id = $7
       RETURNING id, user_id, type, amount, category, description, date, created_at`,
      [type, Number(amount), category.trim(), description.trim(), date, id, req.user.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Transaction not found.' });

    const transaction = { ...rows[0], id: Number(rows[0].id), amount: Number(rows[0].amount) };
    res.json({ transaction });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ error: 'Could not update transaction.' });
  }
});

// Delete transaction
app.delete('/api/transactions/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid transaction ID.' });

    const result = await db.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Transaction not found.' });

    res.json({ message: 'Transaction deleted.' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ error: 'Could not delete transaction.' });
  }
});

// List budgets with spent amounts
app.get('/api/budgets', auth, async (req, res) => {
  try {
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
      ? req.query.month
      : new Date().toISOString().slice(0, 7);

    const { rows } = await db.query(
      `SELECT
        b.id, b.user_id, b.category, b.monthly_limit, b.month, b.created_at,
        COALESCE(SUM(t.amount), 0) AS spent
      FROM budgets b
      LEFT JOIN transactions t
        ON t.user_id = b.user_id
        AND t.category = b.category
        AND t.type = 'expense'
        AND SUBSTR(t.date, 1, 7) = b.month
      WHERE b.user_id = $1 AND b.month = $2
      GROUP BY b.id, b.user_id, b.category, b.monthly_limit, b.month, b.created_at
      ORDER BY b.category`,
      [req.user.id, month]
    );

    const budgets = rows.map(b => ({
      ...b,
      id: Number(b.id),
      monthly_limit: Number(b.monthly_limit),
      spent: Number(b.spent),
    }));

    res.json({ budgets });
  } catch (error) {
    console.error('Fetch budgets error:', error);
    res.status(500).json({ error: 'Could not fetch budgets.' });
  }
});

// Create budget
app.post('/api/budgets', auth, async (req, res) => {
  try {
    const { category, monthly_limit, month } = req.body || {};
    if (
      typeof category !== 'string' ||
      !category.trim() ||
      category.trim().length > 40 ||
      !validAmount(monthly_limit) ||
      typeof month !== 'string' ||
      !/^\d{4}-\d{2}$/.test(month)
    ) {
      return res.status(400).json({ error: 'Enter a category, positive limit and month.' });
    }

    const { rows } = await db.query(
      `INSERT INTO budgets (user_id, category, monthly_limit, month)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, category, monthly_limit, month, created_at`,
      [req.user.id, category.trim(), Number(monthly_limit), month]
    );

    // Calculate initial spent
    const spentResult = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS spent FROM transactions
       WHERE user_id = $1 AND category = $2 AND type = 'expense' AND SUBSTR(date, 1, 7) = $3`,
      [req.user.id, category.trim(), month]
    );

    const budget = {
      ...rows[0],
      id: Number(rows[0].id),
      monthly_limit: Number(rows[0].monthly_limit),
      spent: Number(spentResult.rows[0]?.spent || 0),
    };

    res.status(201).json({ budget });
  } catch (error) {
    if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A budget for this category and month already exists.' });
    }
    console.error('Create budget error:', error);
    res.status(500).json({ error: 'Could not create budget.' });
  }
});

// Delete budget
app.delete('/api/budgets/:id', auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid budget ID.' });

    const result = await db.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Budget not found.' });

    res.json({ message: 'Budget deleted.' });
  } catch (error) {
    console.error('Delete budget error:', error);
    res.status(500).json({ error: 'Could not delete budget.' });
  }
});

// Export CSV
app.get('/api/export/csv', auth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT date, type, category, description, amount FROM transactions WHERE user_id = $1 ORDER BY date DESC, id DESC',
      [req.user.id]
    );

    const quote = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'Date,Type,Category,Description,Amount',
      ...rows.map(r => [r.date, r.type, r.category, r.description, r.amount].map(quote).join(',')),
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="expense-report.csv"');
    res.send('\uFEFF' + csv);
  } catch (error) {
    console.error('CSV export error:', error);
    res.status(500).json({ error: 'Could not export CSV data.' });
  }
});

// Catch-all API 404
app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

// Frontend static fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Only start the HTTP listener if executed directly (e.g., node server.js or npm start)
if (require.main === module) {
  app.listen(PORT, () => console.log(`Simple Expense Tracker running at http://localhost:${PORT}`));
}

module.exports = app;
