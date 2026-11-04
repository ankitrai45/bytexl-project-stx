# 💰 Simple Expense Tracker

A full-stack JavaScript personal finance application designed for tracking daily income, expenses, and monthly category budgets. Built with a responsive frontend, a Node.js/Express REST API, secure JWT authentication, and a hosted PostgreSQL database (via [Neon](https://neon.tech/)) ready for seamless serverless deployment on [Vercel](https://vercel.com/).

---

## 🚀 Features

- **User Authentication**: Secure user registration and login with `bcryptjs` password hashing (salt rounds: 12) and 7-day expiration JSON Web Tokens (`jsonwebtoken`).
- **Dashboard & Analytics**: Monthly income, expense, and net balance overview, savings rate calculation, financial health insights, and an interactive Doughnut chart (Chart.js).
- **Transaction Management**: Add, view, edit, and delete income and expense records with customizable dates, amounts, categories, and descriptions.
- **Search & Filters**: Instant keyword search, category filtering, and month-by-month navigation.
- **Budget Tracking**: Set monthly spending limits per category, with live progress bars and alert indicators when exceeding limits.
- **CSV Data Export**: One-click download of all user transactions in UTF-8 formatted CSV for spreadsheet analysis.
- **Complete Data Isolation**: Multi-tenant architecture ensuring users can only read, update, or delete their own transactions and budgets.
- **Vercel Serverless Compatible**: Fully stateless architecture using connection-pooled PostgreSQL with SSL, compatible with Vercel Serverless Functions.

---

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Vanilla HTML5, Modern CSS3, JavaScript (ES6+), Chart.js |
| **Backend** | Node.js, Express.js, CORS, Express Rate Limit |
| **Database** | PostgreSQL (Neon serverless Postgres), `pg` connection pool with SSL |
| **Security** | JSON Web Tokens (JWT), bcryptjs password hashing, parameterized SQL queries |
| **Testing** | In-memory PostgreSQL integration test suite (`npm test`) |
| **Deployment** | Vercel Serverless Functions + Vercel Edge Static CDN |

---

## 📁 Project Structure

```text
Simple-Expense-Tracker/
├── api/
│   └── index.js             # Vercel serverless function entry point
├── middleware/
│   └── auth.js              # JWT authentication & session verification middleware
├── public/
│   ├── app.js               # Frontend application logic, chart rendering, API client
│   ├── index.html           # Single-page application HTML structure
│   └── style.css            # Responsive dark-theme styling
├── scripts/
│   ├── init-db.sql          # Raw PostgreSQL DDL schema & indexes
│   └── migrate-sqlite-to-pg.js # Migration script from SQLite (expenses.db) to PostgreSQL
├── test/
│   └── test-suite.js        # Automated integration test suite (53 passing tests)
├── .env.example             # Template for required environment variables
├── .gitignore               # Git exclusions (node_modules, .env, *.db)
├── database.js              # PostgreSQL connection pool, types parser, schema auto-init
├── package.json             # NPM dependencies, scripts, engines
├── server.js                # Express app, REST API routes, validation, local entry point
├── vercel.json              # Vercel routing and serverless rewrite configuration
├── README.md                # Project documentation and quickstart
├── DEPLOYMENT.md            # Step-by-step Vercel and Neon deployment guide
└── DATABASE_MIGRATION.md    # Guide for migrating SQLite data to PostgreSQL
```

---

## ⚙️ Quick Start (Local Development)

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher ([Download Node.js](https://nodejs.org/))
- **PostgreSQL Connection String**: A free database from [Neon](https://neon.tech/) (or local PostgreSQL)

### 2. Installation
Open your terminal (Command Prompt, PowerShell, or VS Code integrated terminal):

```cmd
cd Simple-Expense-Tracker
npm install
```

### 3. Environment Configuration
Create a `.env` file in the project root:

```cmd
copy .env.example .env
```

Open `.env` in VS Code or Notepad and set your variables:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://neondb_owner:your_password@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
JWT_SECRET=use_a_long_random_secret_with_at_least_32_characters
```

> 💡 **Tip:** If you haven't created a Neon database yet, see the step-by-step guide in [DEPLOYMENT.md](DEPLOYMENT.md).

### 4. Run Automated Tests
Verify all API routes, database models, security checks, and calculations:

```cmd
npm test
```

### 5. Start the Application
```cmd
npm start
```

Open your browser and visit:
```text
http://localhost:3000
```

---

## 🗄️ Database Architecture

The PostgreSQL schema consists of three relational tables:

```
┌────────────────────────┐       ┌─────────────────────────────────┐
│         users          │       │          transactions           │
├────────────────────────┤       ├─────────────────────────────────┤
│ id (PK, SERIAL)        │───┐   │ id (PK, SERIAL)                 │
│ name (VARCHAR)         │   └──<│ user_id (FK -> users.id)        │
│ email (UNIQUE, VARCHAR)│       │ type (income / expense)         │
│ password_hash (VARCHAR)│       │ amount (NUMERIC 12,2)           │
│ created_at (TIMESTAMPTZ│       │ category (VARCHAR)              │
└────────────────────────┘       │ description (VARCHAR)           │
            │                    │ date (VARCHAR YYYY-MM-DD)       │
            │                    │ created_at (TIMESTAMPTZ)        │
            │                    └─────────────────────────────────┘
            │                    ┌─────────────────────────────────┐
            │                    │             budgets             │
            │                    ├─────────────────────────────────┤
            │                    │ id (PK, SERIAL)                 │
            └───────────────────<│ user_id (FK -> users.id)        │
                                 │ category (VARCHAR)              │
                                 │ monthly_limit (NUMERIC 12,2)    │
                                 │ month (VARCHAR YYYY-MM)         │
                                 │ created_at (TIMESTAMPTZ)        │
                                 │ UNIQUE(user_id, category, month)│
                                 └─────────────────────────────────┘
```

The database tables and indexes are automatically created on initial connection via [`database.js`](database.js). You can also run [`scripts/init-db.sql`](scripts/init-db.sql) manually in the Neon SQL Editor.

---

## ☁️ Deployment on Vercel

For complete, beginner-friendly instructions on linking Neon and deploying to Vercel, read:
👉 **[DEPLOYMENT.md](DEPLOYMENT.md)**

Summary of environment variables to add in **Vercel Dashboard → Project → Settings → Environment Variables**:
- `DATABASE_URL`: Your Neon PostgreSQL pooled connection string.
- `JWT_SECRET`: A secure random string (at least 32 characters).
- `NODE_ENV`: `production`

---

## 📜 License
MIT License. Built for educational and portfolio demonstration.
