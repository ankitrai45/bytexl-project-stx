/**
 * Simple Expense Tracker - Comprehensive Test Suite
 *
 * Covers all requirements in Section 9:
 * 1. Database connectivity & initialization
 * 2. Table creation & constraints verification
 * 3. User registration (valid, invalid, duplicate email)
 * 4. User login & JWT authentication
 * 5. Current user (/api/me)
 * 6. Adding income and expense transactions
 * 7. Editing transactions
 * 8. Deleting transactions
 * 9. Dashboard totals, categories, and recent transactions
 * 10. Budget creation, calculation of spent amounts, duplicate prevention, and deletion
 * 11. CSV export formatting
 * 12. User data isolation (User B cannot access or modify User A's data)
 * 13. Health endpoint
 * 14. Vercel serverless entry point compatibility
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_super_secret_jwt_key_for_testing_1234567890';

const http = require('http');
const { newDb, DataType } = require('pg-mem');
const db = require('../database');
const app = require('../server');
const vercelHandler = require('../api/index');

let server;
let baseUrl;
let testPassed = 0;
let testFailed = 0;

function assert(condition, message) {
  if (!condition) {
    testFailed++;
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    testPassed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

async function request(method, path, body = null, token = null) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { status: res.status, headers: res.headers, data };
}

async function runTests() {
  console.log('\n========================================');
  console.log('🧪 Starting Expense Tracker Test Suite');
  console.log('========================================\n');

  try {
    // Setup in-memory PostgreSQL emulator for test isolation
    console.log('--- 1. Database Connection & Schema Setup ---');
    const memDb = newDb();

    // Register substr function for pg-mem compatibility
    memDb.public.registerFunction({
      name: 'substr',
      args: [DataType.text, DataType.integer, DataType.integer],
      returns: DataType.text,
      implementation: (str, start, len) => (str ? str.substring(start - 1, start - 1 + len) : ''),
    });

    const pgAdapter = memDb.adapters.createPg();
    const testPool = new pgAdapter.Pool();
    db.setPool(testPool);

    await db.initDb();
    assert(true, 'Database schema initialized successfully with all tables');

    // Start ephemeral HTTP server
    await new Promise(resolve => {
      server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        console.log(`  🚀 Test server running at ${baseUrl}`);
        resolve();
      });
    });

    // Test Health Endpoint
    console.log('\n--- 2. Health Endpoint Check ---');
    const healthRes = await request('GET', '/api/health');
    assert(healthRes.status === 200, 'Health endpoint responds with 200');
    assert(healthRes.data.status === 'ok', 'Health status is ok');

    // Test Registration
    console.log('\n--- 3. User Registration Tests ---');
    const regRes = await request('POST', '/api/auth/register', {
      name: 'Alice Johnson',
      email: 'alice@example.com',
      password: 'password123',
    });
    assert(regRes.status === 201, 'Alice registered with 201 status');
    assert(regRes.data.user && regRes.data.user.email === 'alice@example.com', 'Registered user email matches');
    assert(typeof regRes.data.token === 'string', 'Received JWT token upon registration');
    const aliceToken = regRes.data.token;
    const aliceId = regRes.data.user.id;

    // Test Duplicate Registration (Unique Email Constraint)
    const dupRes = await request('POST', '/api/auth/register', {
      name: 'Alice Duplicate',
      email: 'alice@example.com',
      password: 'anotherpassword',
    });
    assert(dupRes.status === 409, 'Duplicate email registration returns 409 conflict');

    // Test Registration Validation
    const invalidReg = await request('POST', '/api/auth/register', {
      name: 'A',
      email: 'invalid-email',
      password: 'short',
    });
    assert(invalidReg.status === 400, 'Invalid registration payload rejected with 400');

    // Test Login
    console.log('\n--- 4. User Login & Auth Tests ---');
    const loginRes = await request('POST', '/api/auth/login', {
      email: 'alice@example.com',
      password: 'password123',
    });
    assert(loginRes.status === 200, 'Successful login returns 200');
    assert(typeof loginRes.data.token === 'string', 'Login returns valid token');

    const wrongLogin = await request('POST', '/api/auth/login', {
      email: 'alice@example.com',
      password: 'wrongpassword',
    });
    assert(wrongLogin.status === 401, 'Incorrect password rejected with 401');

    // Test /api/me
    console.log('\n--- 5. Protected /api/me Profile ---');
    const meRes = await request('GET', '/api/me', null, aliceToken);
    assert(meRes.status === 200, 'GET /api/me returns 200 for authenticated user');
    assert(meRes.data.user.email === 'alice@example.com', '/api/me returns correct user data');

    const unauthMe = await request('GET', '/api/me');
    assert(unauthMe.status === 401, 'Unauthenticated request to /api/me rejected with 401');

    // Test Adding Transactions
    console.log('\n--- 6. Transactions (Add, Edit, Delete, Filter) ---');
    const tIncome = await request('POST', '/api/transactions', {
      type: 'income',
      amount: 50000,
      category: 'Salary',
      description: 'Monthly payroll',
      date: '2026-11-01',
    }, aliceToken);
    assert(tIncome.status === 201, 'Added income transaction with 201');
    assert(tIncome.data.transaction.amount === 50000, 'Income amount matches');

    const tExpense1 = await request('POST', '/api/transactions', {
      type: 'expense',
      amount: 2500,
      category: 'Food',
      description: 'Groceries store',
      date: '2026-11-03',
    }, aliceToken);
    assert(tExpense1.status === 201, 'Added expense transaction with 201');
    const expenseId = tExpense1.data.transaction.id;

    const tExpense2 = await request('POST', '/api/transactions', {
      type: 'expense',
      amount: 1500,
      category: 'Utilities',
      description: 'Electricity bill',
      date: '2026-11-04',
    }, aliceToken);
    assert(tExpense2.status === 201, 'Added second expense transaction');

    // Test Editing Transaction
    const editRes = await request('PUT', `/api/transactions/${expenseId}`, {
      type: 'expense',
      amount: 2800,
      category: 'Food',
      description: 'Groceries store + organic vegetables',
      date: '2026-11-03',
    }, aliceToken);
    assert(editRes.status === 200, 'Updated transaction successfully');
    assert(editRes.data.transaction.amount === 2800, 'Updated amount is 2800');
    assert(editRes.data.transaction.description.includes('organic'), 'Updated description persisted');

    // Test Listing & Filtering Transactions
    const listRes = await request('GET', '/api/transactions?month=2026-11', null, aliceToken);
    assert(listRes.status === 200, 'Listed transactions');
    assert(listRes.data.transactions.length === 3, 'Found exactly 3 transactions for 2026-11');

    const filterType = await request('GET', '/api/transactions?type=expense', null, aliceToken);
    assert(filterType.data.transactions.length === 2, 'Filtered by type=expense returns 2 items');

    const searchRes = await request('GET', '/api/transactions?search=organic', null, aliceToken);
    assert(searchRes.data.transactions.length === 1, 'Search by keyword finds matching transaction');

    // Test Dashboard Totals & Insights
    console.log('\n--- 7. Dashboard Calculation Tests ---');
    const dashRes = await request('GET', '/api/dashboard?month=2026-11', null, aliceToken);
    assert(dashRes.status === 200, 'GET /api/dashboard returns 200');
    assert(dashRes.data.income === 50000, `Dashboard income is 50000 (actual: ${dashRes.data.income})`);
    assert(dashRes.data.expense === 4300, `Dashboard expense is 4300 (2800 + 1500, actual: ${dashRes.data.expense})`);
    assert(dashRes.data.balance === 45700, `Dashboard balance is 45700 (actual: ${dashRes.data.balance})`);
    assert(dashRes.data.categories.length === 2, 'Dashboard lists 2 expense categories');

    // Test Budgets
    console.log('\n--- 8. Budgets (Create, Calculate Spent, Duplicate, Delete) ---');
    const budgetRes = await request('POST', '/api/budgets', {
      category: 'Food',
      monthly_limit: 5000,
      month: '2026-11',
    }, aliceToken);
    assert(budgetRes.status === 201, 'Created Food budget of 5000');
    const budgetId = budgetRes.data.budget.id;

    // Test Duplicate Budget
    const dupBudget = await request('POST', '/api/budgets', {
      category: 'Food',
      monthly_limit: 6000,
      month: '2026-11',
    }, aliceToken);
    assert(dupBudget.status === 409, 'Duplicate budget for same category and month returns 409');

    // Test Budget Spent Calculation
    const listBudgets = await request('GET', '/api/budgets?month=2026-11', null, aliceToken);
    assert(listBudgets.status === 200, 'Listed budgets');
    const foodBudget = listBudgets.data.budgets.find(b => b.category === 'Food');
    assert(foodBudget !== undefined, 'Found Food budget in list');
    assert(foodBudget.spent === 2800, `Budget spent correctly calculated as 2800 (actual: ${foodBudget.spent})`);
    assert(foodBudget.monthly_limit === 5000, 'Budget monthly limit is 5000');

    // Test CSV Export
    console.log('\n--- 9. CSV Export Tests ---');
    const csvRes = await request('GET', '/api/export/csv', null, aliceToken);
    assert(csvRes.status === 200, 'GET /api/export/csv returns 200');
    assert(csvRes.headers.get('content-type').includes('text/csv'), 'Content-Type is text/csv');
    assert(csvRes.data.includes('Date,Type,Category,Description,Amount'), 'CSV contains standard header');
    assert(csvRes.data.includes('Salary'), 'CSV contains Salary transaction');
    assert(csvRes.data.includes('Groceries store'), 'CSV contains expense description');

    // Test User Data Isolation (User B cannot access or tamper with User A's data)
    console.log('\n--- 10. User Data Isolation Security Tests ---');
    const bobReg = await request('POST', '/api/auth/register', {
      name: 'Bob Smith',
      email: 'bob@example.com',
      password: 'password123',
    });
    const bobToken = bobReg.data.token;

    // Bob tries to list transactions - should see empty
    const bobTx = await request('GET', '/api/transactions', null, bobToken);
    assert(bobTx.data.transactions.length === 0, "Bob cannot see Alice's transactions");

    // Bob tries to update Alice's transaction
    const bobTamper = await request('PUT', `/api/transactions/${expenseId}`, {
      type: 'expense',
      amount: 1,
      category: 'Food',
      description: 'Hacked',
      date: '2026-11-03',
    }, bobToken);
    assert(bobTamper.status === 404, "Bob cannot update Alice's transaction (returns 404)");

    // Bob tries to delete Alice's transaction
    const bobDelete = await request('DELETE', `/api/transactions/${expenseId}`, null, bobToken);
    assert(bobDelete.status === 404, "Bob cannot delete Alice's transaction (returns 404)");

    // Bob tries to delete Alice's budget
    const bobDelBudget = await request('DELETE', `/api/budgets/${budgetId}`, null, bobToken);
    assert(bobDelBudget.status === 404, "Bob cannot delete Alice's budget (returns 404)");

    // Bob's dashboard should be all zero
    const bobDash = await request('GET', '/api/dashboard?month=2026-11', null, bobToken);
    assert(bobDash.data.income === 0 && bobDash.data.expense === 0, "Bob's dashboard shows zero income and expense");

    // Test Deleting Own Transaction and Budget
    console.log('\n--- 11. Transaction & Budget Deletion Tests ---');
    const deleteTx = await request('DELETE', `/api/transactions/${expenseId}`, null, aliceToken);
    assert(deleteTx.status === 200, "Alice successfully deletes her own transaction");

    const deleteBudgetRes = await request('DELETE', `/api/budgets/${budgetId}`, null, aliceToken);
    assert(deleteBudgetRes.status === 200, "Alice successfully deletes her own budget");

    // Test Vercel Entry Point Handler
    console.log('\n--- 12. Vercel Serverless Entry Point Check ---');
    assert(typeof vercelHandler === 'function', 'api/index.js exports a callable serverless request listener');

    const vercelServer = http.createServer(vercelHandler);
    const vercelPort = await new Promise(resolve => {
      vercelServer.listen(0, '127.0.0.1', () => resolve(vercelServer.address().port));
    });

    const vRes = await fetch(`http://127.0.0.1:${vercelPort}/api/health`);
    assert(vRes.status === 200, 'Vercel handler responds to /api/health with status 200');
    const vData = await vRes.json();
    assert(vData.status === 'ok', 'Vercel handler returns expected API health response');

    const vStrippedRes = await fetch(`http://127.0.0.1:${vercelPort}/health`);
    assert(vStrippedRes.status === 200, 'Vercel handler rewrites stripped /health to /api/health');
    const vStrippedData = await vStrippedRes.json();
    assert(vStrippedData.status === 'ok', 'Stripped path returns expected API health response');

    await new Promise(resolve => vercelServer.close(resolve));

    console.log('\n========================================');
    console.log(`🎉 ALL TESTS COMPLETED!`);
    console.log(`Passed: ${testPassed} | Failed: ${testFailed}`);
    console.log('========================================\n');
  } catch (err) {
    console.error('\n❌ TEST RUN ABORTED DUE TO ERROR:\n', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
  }
}

runTests();
