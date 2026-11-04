# 🚀 Vercel & Neon PostgreSQL Deployment Guide

This guide provides step-by-step instructions for deploying the **Simple Expense Tracker** to **Vercel** with a free hosted **Neon PostgreSQL** database.

---

## Table of Contents
1. [Create a Free Neon PostgreSQL Database](#1-create-a-free-neon-postgresql-database)
2. [Obtain Your Database Connection String](#2-obtain-your-database-connection-string)
3. [Initialize Database Schema (Automatic or Manual)](#3-initialize-database-schema)
4. [Configure Environment Variables in Vercel](#4-configure-environment-variables-in-vercel)
5. [Push Changes to GitHub](#5-push-changes-to-github)
6. [Redeploy on Vercel](#6-redeploy-on-vercel)
7. [Check Vercel Runtime Logs](#7-check-vercel-runtime-logs)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Create a Free Neon PostgreSQL Database

1. Visit **[https://neon.tech](https://neon.tech)** and click **Sign Up** (you can sign in with your GitHub account).
2. Once logged in, click **Create Project**.
3. Fill in the project details:
   - **Project name:** `simple-expense-tracker` (or any name you prefer)
   - **Postgres version:** `16` (or latest recommended)
   - **Region:** Choose the region closest to your users (e.g., `AWS US East (N. Virginia)` or `AWS Europe (Frankfurt)`)
4. Click **Create Project**.

---

## 2. Obtain Your Database Connection String

1. On your Neon Project Dashboard, navigate to the **Dashboard** or **Connection Details** section.
2. In the dropdown, ensure **Pooled connection** or **Direct connection** is selected.
3. Under connection string format, select **Node.js** or **Connection string**.
4. Your connection string will look like this:
   ```text
   postgresql://neondb_owner:npg_AbCdEf123456@ep-cool-cloud-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Click the **Copy** button to copy this connection string.

> ⚠️ **Important:** Keep your connection string private. Never commit it to GitHub.

---

## 3. Initialize Database Schema

The application automatically creates the required tables (`users`, `transactions`, `budgets`) and indexes when the server connects.

However, if you wish to run the migration manually upfront:
1. In your Neon console, click on **SQL Editor** in the left sidebar.
2. Open the file [`scripts/init-db.sql`](scripts/init-db.sql) in this project.
3. Copy its entire contents and paste it into the Neon SQL Editor.
4. Click **Run**.
5. You should see a confirmation message indicating `CREATE TABLE` and `CREATE INDEX` executed successfully.

---

## 4. Configure Environment Variables in Vercel

1. Log into your **[Vercel Dashboard](https://vercel.com/dashboard)**.
2. Click on your project: **`bytexl-project-stx`**.
3. Go to **Settings** → **Environment Variables**.
4. Add the following 3 variables:

| Key | Value | Target Environments |
|---|---|---|
| `DATABASE_URL` | *Paste your Neon connection string here* | Production, Preview, Development |
| `JWT_SECRET` | *Enter a random string (at least 32 characters, e.g. `9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c`)* | Production, Preview, Development |
| `NODE_ENV` | `production` | Production, Preview, Development |

> 🔒 **Generating a secure JWT_SECRET:**
> You can generate one on Windows using PowerShell:
> ```powershell
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

5. Click **Save** for each variable.

---

## 5. Push Changes to GitHub

Once you have verified the codebase locally, push the updated files to your GitHub repository.

### Using Windows Command Prompt (cmd) or PowerShell:
```cmd
# 1. Navigate to the project directory
cd c:\Users\ANKIT RAI\Downloads\Simple-Expense-Tracker\Simple-Expense-Tracker

# 2. Check the status of changed files
git status

# 3. Stage all modified and new files
git add .

# 4. Commit the changes
git commit -m "Migrate database to PostgreSQL and configure Vercel serverless deployment"

# 5. Push to the main branch
git push origin main
```

### Using VS Code:
1. Click the **Source Control** icon on the left activity bar (`Ctrl+Shift+G`).
2. Review the list of changed files.
3. Type a commit message (e.g., `Migrate from SQLite to PostgreSQL & fix Vercel deployment`).
4. Click **Commit** (or the checkmark button).
5. Click **Sync Changes** (or **Push**) to push your commits to GitHub.

---

## 6. Redeploy on Vercel

Once you push to GitHub, Vercel will automatically trigger a new deployment.

If you prefer to trigger a manual redeployment:
1. Go to your **Vercel Dashboard**.
2. Select your project **`bytexl-project-stx`**.
3. Click the **Deployments** tab.
4. Locate the latest deployment, click the **...** (three dots) on the right, and select **Redeploy**.
5. Ensure the box **"Use existing Build Cache"** is unchecked if you want a fresh build.
6. Click **Redeploy**.

---

## 7. Check Vercel Runtime Logs

If you encounter any issues:
1. Open your project in the **Vercel Dashboard**.
2. Click on the **Logs** (or **Runtime Logs**) tab.
3. Open your deployed website URL: `https://bytexl-project-stx.vercel.app/`.
4. Check the logs in real time:
   - When requests hit `/api/...`, you will see serverless execution logs.
   - You can also test the health check route directly in your browser:
     ```text
     https://bytexl-project-stx.vercel.app/api/health
     ```
     Expected response:
     ```json
     {
       "status": "ok",
       "database": "connected",
       "message": "Expense Tracker API is running."
     }
     ```

---

## 8. Troubleshooting

### Issue 1: "Database pool not initialized. Please set DATABASE_URL."
- **Cause:** The `DATABASE_URL` environment variable is missing or has a typo in Vercel Settings.
- **Fix:** Go to **Project Settings → Environment Variables**, double-check the spelling of `DATABASE_URL`, ensure the value contains your Neon connection string, and trigger a **Redeploy**.

### Issue 2: "Session expired. Please log in again." or 401 on every request
- **Cause:** `JWT_SECRET` is missing in Vercel Environment Variables.
- **Fix:** Add `JWT_SECRET` in Vercel Settings and redeploy.

### Issue 3: "self-signed certificate in certificate chain"
- **Cause:** SSL configuration mismatch.
- **Fix:** The included [`database.js`](database.js) is already configured with `ssl: { rejectUnauthorized: false }` for cloud databases, preventing this issue automatically. Ensure your `DATABASE_URL` includes `?sslmode=require`.

### Issue 4: Local testing shows `connect EACCES`
- **Cause:** Port permission restriction in local sandbox.
- **Fix:** Use `npm test` directly from your standard Command Prompt or PowerShell terminal.
