require('dotenv').config();
const { Pool, types } = require('pg');

// Parse PostgreSQL NUMERIC/DECIMAL as float (type id 1700)
types.setTypeParser(1700, val => (val === null ? null : parseFloat(val)));
// Parse PostgreSQL BIGINT as integer (type id 20)
types.setTypeParser(20, val => (val === null ? null : parseInt(val, 10)));

let activePool = null;
function createPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined.');
  }

  const fs = require('fs');
  const path = require('path');

  const ca = process.env.DB_CA_CERT ||
    fs.readFileSync(path.join(__dirname, 'ca.pem'), 'utf8');

  return new Pool({
    connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true
    },
    max: process.env.NODE_ENV === 'production' ? 10 : 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

function getPool() {
  if (!activePool) {
    activePool = createPool();
  }
  return activePool;
}

function setPool(customPool) {
  activePool = customPool;
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK(type IN ('income', 'expense')),
    amount NUMERIC(12, 2) NOT NULL CHECK(amount > 0),
    category VARCHAR(50) NOT NULL,
    description VARCHAR(255) DEFAULT '',
    date VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    monthly_limit NUMERIC(12, 2) NOT NULL CHECK(monthly_limit > 0),
    month VARCHAR(7) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_category_month UNIQUE(user_id, category, month)
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);
  CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);
`;

let initPromise = null;

async function initDb() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const p = getPool();
    if (!p) {
      throw new Error('Database pool not initialized. Please verify DATABASE_URL in your environment variables.');
    }
    await p.query(SCHEMA_SQL);
  })();

  return initPromise;
}

async function query(text, params) {
  const p = getPool();
  if (!p) {
    throw new Error('Database pool not initialized. Please set DATABASE_URL.');
  }
  return p.query(text, params);
}

// Auto-initialize schema in background if DATABASE_URL is present
if (process.env.DATABASE_URL) {
  initDb().catch(err => {
    console.error('Initial database schema sync warning:', err.message);
  });
}

module.exports = {
  get pool() {
    return getPool();
  },
  query,
  initDb,
  setPool,
  SCHEMA_SQL,
};
