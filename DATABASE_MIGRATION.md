# 🔄 SQLite to PostgreSQL Database Migration Guide

This document describes the schema migration from SQLite (`better-sqlite3`) to PostgreSQL (`pg`), along with instructions for safely transferring any existing data from an `expenses.db` SQLite file to your Neon PostgreSQL database.

---

## 1. Why the Migration Was Required

| Factor | Old Approach (SQLite) | New Approach (PostgreSQL via Neon) |
|---|---|---|
| **Storage Model** | Local disk file (`expenses.db`) | Remote cloud-hosted relational database |
| **Vercel Compatibility** | ❌ Fails (`SQLITE_CANTOPEN`, read-only lambda filesystem) | ✅ Native connection pooling over SSL |
| **Concurrency** | Single-writer lock | Multi-client connection pooling |
| **Data Persistence** | Lost on serverless instance termination | 100% persistent in the cloud |
| **Native Bindings** | Requires C++ build tools (`node-gyp`) | Pure JavaScript PostgreSQL client (`pg`) |

---

## 2. Schema Comparison & Data Mapping

### Users Table
| Field | SQLite Type | PostgreSQL Type | Notes |
|---|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` | Auto-incrementing primary key |
| `name` | `TEXT NOT NULL` | `VARCHAR(100) NOT NULL` | User full name |
| `email` | `TEXT NOT NULL UNIQUE` | `VARCHAR(255) NOT NULL UNIQUE` | Lowercased unique email |
| `password_hash` | `TEXT NOT NULL` | `VARCHAR(255) NOT NULL` | bcrypt-hashed password (cost 12) |
| `created_at` | `TEXT DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` | Timestamp with timezone |

### Transactions Table
| Field | SQLite Type | PostgreSQL Type | Notes |
|---|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` | Auto-incrementing primary key |
| `user_id` | `INTEGER NOT NULL (FK)` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Cascade delete on user removal |
| `type` | `TEXT CHECK(type IN ('income','expense'))` | `VARCHAR(10) CHECK(type IN ('income','expense'))` | Transaction type |
| `amount` | `REAL CHECK(amount > 0)` | `NUMERIC(12, 2) CHECK(amount > 0)` | High precision financial decimal |
| `category` | `TEXT NOT NULL` | `VARCHAR(50) NOT NULL` | Spending/income category |
| `description` | `TEXT DEFAULT ''` | `VARCHAR(255) DEFAULT ''` | Optional note |
| `date` | `TEXT NOT NULL` | `VARCHAR(10) NOT NULL` | `YYYY-MM-DD` string |
| `created_at` | `TEXT DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` | Timestamp with timezone |

### Budgets Table
| Field | SQLite Type | PostgreSQL Type | Notes |
|---|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` | Auto-incrementing primary key |
| `user_id` | `INTEGER NOT NULL (FK)` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | Cascade delete on user removal |
| `category` | `TEXT NOT NULL` | `VARCHAR(50) NOT NULL` | Budget category |
| `monthly_limit` | `REAL CHECK(monthly_limit > 0)` | `NUMERIC(12, 2) CHECK(monthly_limit > 0)` | Positive monthly spending limit |
| `month` | `TEXT NOT NULL` | `VARCHAR(7) NOT NULL` | `YYYY-MM` string |
| `created_at` | `TEXT DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` | Timestamp with timezone |
| Constraint | `UNIQUE(user_id, category, month)` | `CONSTRAINT unique_user_category_month UNIQUE(user_id, category, month)` | One budget per category per month |

---

## 3. How to Migrate Existing SQLite Data

If you have an existing `expenses.db` file from previous local testing and you want to import all users, transactions, and budgets into your Neon PostgreSQL database:

### Step 1: Ensure your `.env` contains your Neon `DATABASE_URL`
```env
DATABASE_URL=postgresql://neondb_owner:your_password@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
```

### Step 2: Run the migration script
From your terminal:
```cmd
node scripts/migrate-sqlite-to-pg.js
```

### What the script does:
1. Detects `expenses.db` in the project root.
2. Connects to your PostgreSQL database.
3. Automatically creates all tables and indexes if not already present.
4. Reads all users, transactions, and budgets from SQLite.
5. Inserts them using transactions (`BEGIN` ... `COMMIT`).
6. Synchronizes PostgreSQL auto-increment sequences (`users_id_seq`, `transactions_id_seq`, `budgets_id_seq`) so future insertions do not produce ID collisions.
7. Preserves existing password hashes and user IDs so all passwords and relationships remain 100% valid.

---

## 4. Manual Schema Creation (Neon SQL Editor)

If you are starting fresh without an existing `expenses.db`, the application will automatically create the tables when the server first runs.

Alternatively, you can manually execute [`scripts/init-db.sql`](scripts/init-db.sql) directly in the Neon SQL Editor console:

```sql
-- Run this in the Neon SQL Editor:
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
  type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category VARCHAR(50) NOT NULL,
  description VARCHAR(255) DEFAULT '',
  date VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS budgets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  monthly_limit NUMERIC(12, 2) NOT NULL CHECK (monthly_limit > 0),
  month VARCHAR(7) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_category_month UNIQUE (user_id, category, month)
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON budgets(user_id, month);
```
