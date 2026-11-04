/**
 * Simple Expense Tracker - SQLite to PostgreSQL Data Migration Script
 *
 * This script exports existing data from expenses.db (if present)
 * and inserts it safely into your Neon PostgreSQL database.
 *
 * Usage:
 *   node scripts/migrate-sqlite-to-pg.js
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

async function migrate() {
  const dbPath = path.join(__dirname, '..', 'expenses.db');

  if (!fs.existsSync(dbPath)) {
    console.log('ℹ️  No existing expenses.db SQLite file found in project root.');
    console.log('   Nothing to migrate. Your PostgreSQL database will start fresh.');
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is not defined.');
    console.error('   Please set DATABASE_URL in your .env file before running migration.');
    process.exit(1);
  }

  let sqlite;
  try {
    const Database = require('better-sqlite3');
    sqlite = new Database(dbPath);
  } catch {
    console.log('⚠️  better-sqlite3 is not installed locally. If you need to migrate old SQLite data,');
    console.log('   install better-sqlite3 temporarily (npm i -D better-sqlite3) and re-run this script.');
    return;
  }

  console.log('🔌 Connecting to PostgreSQL...');
  const isLocalhost = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalhost ? false : { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    console.log('⏳ Ensuring PostgreSQL schema exists...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'init-db.sql'), 'utf-8');
    await client.query(schemaSql);

    console.log('📦 Reading SQLite data...');
    const users = sqlite.prepare('SELECT * FROM users').all();
    const transactions = sqlite.prepare('SELECT * FROM transactions').all();
    const budgets = sqlite.prepare('SELECT * FROM budgets').all();

    console.log(`Found: ${users.length} users, ${transactions.length} transactions, ${budgets.length} budgets.`);

    await client.query('BEGIN');

    // 1. Migrate Users
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, name, email, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash`,
        [u.id, u.name, u.email, u.password_hash, u.created_at || new Date().toISOString()]
      );
    }
    if (users.length > 0) {
      await client.query(`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 1) FROM users))`);
    }
    console.log(`✅ Migrated ${users.length} users.`);

    // 2. Migrate Transactions
    for (const t of transactions) {
      await client.query(
        `INSERT INTO transactions (id, user_id, type, amount, category, description, date, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.user_id, t.type, t.amount, t.category, t.description || '', t.date, t.created_at || new Date().toISOString()]
      );
    }
    if (transactions.length > 0) {
      await client.query(`SELECT setval('transactions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM transactions))`);
    }
    console.log(`✅ Migrated ${transactions.length} transactions.`);

    // 3. Migrate Budgets
    for (const b of budgets) {
      await client.query(
        `INSERT INTO budgets (id, user_id, category, monthly_limit, month, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [b.id, b.user_id, b.category, b.monthly_limit, b.month, b.created_at || new Date().toISOString()]
      );
    }
    if (budgets.length > 0) {
      await client.query(`SELECT setval('budgets_id_seq', (SELECT COALESCE(MAX(id), 1) FROM budgets))`);
    }
    console.log(`✅ Migrated ${budgets.length} budgets.`);

    await client.query('COMMIT');
    console.log('🎉 SQLite to PostgreSQL migration finished successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
    if (sqlite) sqlite.close();
  }
}

migrate();
