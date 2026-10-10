// db/seed_demo.js
// FinShield — Phase 5: Deterministic Polyglot Demo Data Seeder
// Seeds 4 households across all 4 Policy Tiers (SAFE, CAUTION, CRITICAL, FREEZE),
// a COACH user with multi-tenant coach_assignments, realistic multi-loan portfolios
// (where AVALANCHE and SNOWBALL produce distinct priority rankings), saved What-If
// scenarios, and synchronized MongoDB daily_expenses documents.

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });

const { Pool } = require("pg");
const { MongoClient } = require("mongodb");
const { initMongoSchema, COLLECTION_NAME } = require("./mongo/init_mongo");
const {
  logDailyExpenseAndSync,
  syncHouseholdMtdToPostgres,
} = require("./mongo/spend_sync_service");

const PG_URI =
  process.env.DATABASE_URL || "postgres://postgres:simple@localhost:5432/finshield";
const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/finshield";

// Fixed deterministic UUIDs so demo links, tests, and bookmarking stay consistent
const DEMO_IDS = {
  coachUser: "99999999-0000-4000-8000-000000000001",
  adminUser: "99999999-0000-4000-8000-000000000002",

  households: {
    SAFE: "11111111-1111-4111-8111-111111111111",
    CAUTION: "22222222-2222-4222-8222-222222222222",
    CRITICAL: "33333333-3333-4333-8333-333333333333",
    FREEZE: "44444444-4444-4444-8444-444444444444",
  },

  users: {
    sharmaPrimary: "11111111-aaaa-4111-8111-111111111101",
    sharmaSpouse: "11111111-bbbb-4111-8111-111111111102",
    vermaPrimary: "22222222-aaaa-4222-8222-222222222201",
    patelPrimary: "33333333-aaaa-4333-8333-333333333301",
    nairPrimary: "44444444-aaaa-4444-8444-444444444401",
  },
};

async function seedDemoData({ existingPool, existingMongoClient, silent = false } = {}) {
  const pool = existingPool || new Pool({ connectionString: PG_URI });
  const mongoClient = existingMongoClient || new MongoClient(MONGO_URI);

  const log = (...args) => {
    if (!silent) console.log(...args);
  };

  let pgClient;
  try {
    if (!existingMongoClient) {
      await mongoClient.connect();
    }
    const dbName = new URL(MONGO_URI).pathname.replace(/^\//, "") || "finshield";
    const mongoDb = mongoClient.db(dbName);

    // Ensure MongoDB collection & $jsonSchema validator are initialized
    await initMongoSchema(mongoDb);

    pgClient = await pool.connect();
    await pgClient.query("BEGIN");

    // Ensure superuser/bypass context during seeding
    await pgClient.query("RESET app.current_user_id");
    await pgClient.query("RESET app.current_user_role");

    const allHouseholdIds = Object.values(DEMO_IDS.households);
    const allUserIds = [
      DEMO_IDS.coachUser,
      DEMO_IDS.adminUser,
      ...Object.values(DEMO_IDS.users),
    ];

    // Clean any previous demo records idempotently
    await pgClient.query(
      `DELETE FROM coach_assignments WHERE coach_id = ANY($1::uuid[]) OR household_id = ANY($2::uuid[])`,
      [allUserIds, allHouseholdIds]
    );
    await pgClient.query(
      `DELETE FROM policy_audit_logs WHERE user_id = ANY($1::uuid[])`,
      [allUserIds]
    );
    await pgClient.query(
      `DELETE FROM users WHERE user_id = ANY($1::uuid[]) OR email IN (
        'coach.nagasundari@finshield.edu',
        'admin@finshield.edu',
        'aarav.sharma@finshield.demo',
        'priya.sharma@finshield.demo',
        'rohan.verma@finshield.demo',
        'vikram.patel@finshield.demo',
        'karthik.nair@finshield.demo'
      )`,
      [allUserIds]
    );
    await pgClient.query(
      `DELETE FROM households WHERE household_id = ANY($1::uuid[])`,
      [allHouseholdIds]
    );

    // Also clear MongoDB daily_expenses for these demo households
    await mongoDb.collection(COLLECTION_NAME).deleteMany({
      household_id: { $in: allHouseholdIds },
    });

    // -------------------------------------------------------------------------
    // 1. Insert Households
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO households (household_id, household_name) VALUES
        ($1, 'Sharma Family (Dual-Earner • Resilient)'),
        ($2, 'Verma Household (Mid-Career • Moderate Debt)'),
        ($3, 'Patel Household (High Debt Stress • Low Buffer)'),
        ($4, 'Nair Household (Cashflow Deficit • Emergency Freeze)')`,
      [
        DEMO_IDS.households.SAFE,
        DEMO_IDS.households.CAUTION,
        DEMO_IDS.households.CRITICAL,
        DEMO_IDS.households.FREEZE,
      ]
    );

    // -------------------------------------------------------------------------
    // 2. Insert Users (Coach, Admin, and Household Members)
    // -------------------------------------------------------------------------
    const demoHash = "$2b$12$FinShieldDemoBcryptHashValueForPhase5Verification0000";
    await pgClient.query(
      `INSERT INTO users (user_id, household_id, full_name, email, password_hash, role) VALUES
        ($1, NULL, 'Dr. Nagasundari S (Lead Financial Coach)', 'coach.nagasundari@finshield.edu', $8, 'COACH'),
        ($2, NULL, 'FinShield Risk Admin', 'admin@finshield.edu', $8, 'ADMIN'),
        ($3, $9,   'Aarav Sharma', 'aarav.sharma@finshield.demo', $8, 'USER'),
        ($4, $9,   'Priya Sharma', 'priya.sharma@finshield.demo', $8, 'USER'),
        ($5, $10,  'Rohan Verma',  'rohan.verma@finshield.demo',  $8, 'USER'),
        ($6, $11,  'Vikram Patel', 'vikram.patel@finshield.demo', $8, 'USER'),
        ($7, $12,  'Karthik Nair', 'karthik.nair@finshield.demo', $8, 'USER')`,
      [
        DEMO_IDS.coachUser,
        DEMO_IDS.adminUser,
        DEMO_IDS.users.sharmaPrimary,
        DEMO_IDS.users.sharmaSpouse,
        DEMO_IDS.users.vermaPrimary,
        DEMO_IDS.users.patelPrimary,
        DEMO_IDS.users.nairPrimary,
        demoHash,
        DEMO_IDS.households.SAFE,
        DEMO_IDS.households.CAUTION,
        DEMO_IDS.households.CRITICAL,
        DEMO_IDS.households.FREEZE,
      ]
    );

    // Assign Coach to all 4 households
    for (const hId of allHouseholdIds) {
      await pgClient.query(
        `INSERT INTO coach_assignments (coach_id, household_id) VALUES ($1, $2)`,
        [DEMO_IDS.coachUser, hId]
      );
    }

    // -------------------------------------------------------------------------
    // 3. Risk Profiles & Dependents
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO risk_profiles (user_id, age, risk_appetite) VALUES
        ($1, 32, 'AGGRESSIVE'),
        ($2, 30, 'MODERATE'),
        ($3, 38, 'MODERATE'),
        ($4, 42, 'CONSERVATIVE'),
        ($5, 45, 'CONSERVATIVE')`,
      [
        DEMO_IDS.users.sharmaPrimary,
        DEMO_IDS.users.sharmaSpouse,
        DEMO_IDS.users.vermaPrimary,
        DEMO_IDS.users.patelPrimary,
        DEMO_IDS.users.nairPrimary,
      ]
    );

    await pgClient.query(
      `INSERT INTO dependents (household_id, full_name, relationship, age) VALUES
        ($1, 'Ananya Sharma', 'Child', 5),
        ($2, 'Kabir Verma', 'Child', 9),
        ($2, 'Meera Verma', 'Parent', 66),
        ($3, 'Dev Patel', 'Child', 12),
        ($3, 'Suresh Patel', 'Parent', 71),
        ($4, 'Lakshmi Nair', 'Parent', 69)`,
      [
        DEMO_IDS.households.SAFE,
        DEMO_IDS.households.CAUTION,
        DEMO_IDS.households.CRITICAL,
        DEMO_IDS.households.FREEZE,
      ]
    );

    // -------------------------------------------------------------------------
    // 4. Household 1: SHARMA FAMILY (SAFE TIER)
    //    Income: 1,20,000 + 60,000 = 1,80,000
    //    Baseline: 45,000 | EMI: 15,000 | Total Outflow: 60,000
    //    Structural Surplus: 1,20,000 | Discretionary Cap (50%): 60,000
    //    Liquid Emergency Reserves: 4,20,000 -> Runway: 7.00 months (>= 6m)
    //    DTI: 8.33% (<= 30%) -> Tier: SAFE
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month) VALUES
        ($1, 'Senior Software Architect Salary', 120000.00, TRUE, 1),
        ($2, 'Product Designer Salary', 60000.00, FALSE, 5)`,
      [DEMO_IDS.users.sharmaPrimary, DEMO_IDS.users.sharmaSpouse]
    );

    await pgClient.query(
      `INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month) VALUES
        ($1, 'Apartment Rent & Maintenance', 26000.00, 5),
        ($1, 'Essential Groceries & Dairy', 11000.00, 10),
        ($1, 'Electricity, Fiber & Utilities', 4500.00, 15),
        ($1, 'Term & Health Insurance Premium', 3500.00, 20)`,
      [DEMO_IDS.households.SAFE]
    );

    await pgClient.query(
      `INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day, prepayment_penalty_pct, remaining_tenure_months) VALUES
        ($1, 'HDFC EV Car Loan', 210000.00, 8.90, 9500.00, 10, 1.00, 24),
        ($1, 'ICICI Consumer Durable Loan', 38000.00, 13.50, 5500.00, 15, 0.00, 8)`,
      [DEMO_IDS.users.sharmaPrimary]
    );

    await pgClient.query(
      `INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund) VALUES
        ($1, 'SBI Insta-Sweep Emergency Reserve', 320000.00, TRUE),
        ($1, 'HDFC Liquid Overnight Fund', 100000.00, TRUE),
        ($1, 'Nifty 50 Index Portfolio (Non-Emergency)', 650000.00, FALSE)`,
      [DEMO_IDS.households.SAFE]
    );

    // -------------------------------------------------------------------------
    // 5. Household 2: VERMA HOUSEHOLD (CAUTION TIER)
    //    Income: 1,10,000
    //    Baseline: 33,500 | EMI: 38,500 | Total Outflow: 72,000
    //    Structural Surplus: 38,000 | Discretionary Cap (50%): 19,000
    //    Liquid Emergency Reserves: 3,24,000 -> Runway: 4.50 months (3 to 6m)
    //    DTI: 35.00% (30% to 45%) -> Tier: CAUTION
    //    Note: Loans crafted so AVALANCHE (#1 = 24% APR Personal Loan) and
    //          SNOWBALL (#1 = ₹32,000 Credit Card) show distinct rankings!
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month) VALUES
        ($1, 'Operations Manager Salary', 95000.00, TRUE, 1),
        ($1, 'Weekend Advisory Retainer', 15000.00, FALSE, 18)`,
      [DEMO_IDS.users.vermaPrimary]
    );

    await pgClient.query(
      `INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month) VALUES
        ($1, '2BHK House Rent', 19500.00, 5),
        ($1, 'Family Groceries & Staples', 8500.00, 8),
        ($1, 'Power, Water & Broadband', 3200.00, 14),
        ($1, 'Commute & School Bus Fee', 2300.00, 18)`,
      [DEMO_IDS.households.CAUTION]
    );

    await pgClient.query(
      `INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day, prepayment_penalty_pct, remaining_tenure_months) VALUES
        ($1, 'ICICI Unsecured Personal Loan', 220000.00, 24.00, 12500.00, 7, 2.00, 22),
        ($1, 'Flipkart Axis Credit Card EMI', 32000.00, 18.00, 6000.00, 12, 0.00, 6),
        ($1, 'SBI Auto Loan', 450000.00, 9.50, 20000.00, 15, 0.50, 26)`,
      [DEMO_IDS.users.vermaPrimary]
    );

    await pgClient.query(
      `INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund) VALUES
        ($1, 'ICICI High-Yield Emergency Savings', 324000.00, TRUE)`,
      [DEMO_IDS.households.CAUTION]
    );

    // -------------------------------------------------------------------------
    // 6. Household 3: PATEL HOUSEHOLD (CRITICAL TIER)
    //    Income: 95,000
    //    Baseline: 30,000 | EMI: 47,500 | Total Outflow: 77,500
    //    Structural Surplus: 17,500 | Discretionary Cap (50%): 8,750
    //    Liquid Emergency Reserves: 1,40,000 -> Runway: 1.81 months (< 3.0m)
    //    DTI: 50.00% (> 45%) -> Tier: CRITICAL
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month) VALUES
        ($1, 'Manufacturing Plant Supervisor Salary', 95000.00, TRUE, 1)`,
      [DEMO_IDS.users.patelPrimary]
    );

    await pgClient.query(
      `INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month) VALUES
        ($1, 'Housing Society Rent', 16500.00, 5),
        ($1, 'Household Groceries & Medical', 9000.00, 9),
        ($1, 'Utilities & Domestic Fuel', 4500.00, 15)`,
      [DEMO_IDS.households.CRITICAL]
    );

    await pgClient.query(
      `INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day, prepayment_penalty_pct, remaining_tenure_months) VALUES
        ($1, 'HDFC Regalia Credit Card Revolver', 140000.00, 38.00, 15500.00, 5, 0.00, 12),
        ($1, 'KreditBee Emergency Personal Loan', 28000.00, 26.00, 8000.00, 10, 0.00, 4),
        ($1, 'Kotak Home Renovation Loan', 580000.00, 13.50, 24000.00, 15, 2.50, 32)`,
      [DEMO_IDS.users.patelPrimary]
    );

    await pgClient.query(
      `INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund) VALUES
        ($1, 'Kotak Savings Emergency Buffer', 140000.00, TRUE)`,
      [DEMO_IDS.households.CRITICAL]
    );

    // -------------------------------------------------------------------------
    // 7. Household 4: NAIR HOUSEHOLD (FREEZE TIER)
    //    Income: 65,000 (End-of-month payroll on Day 28)
    //    Baseline: 42,000 | EMI: 28,000 | Total Outflow: 70,000
    //    Structural Surplus: -5,000 (Monthly Cashflow Deficit!)
    //    Liquid Emergency Reserves: 18,000 -> Runway: 0.26 months (< 1.0m)
    //    DTI: 43.08% -> Tier: FREEZE
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month) VALUES
        ($1, 'Retail Store Operations Salary', 65000.00, TRUE, 28)`,
      [DEMO_IDS.users.nairPrimary]
    );

    await pgClient.query(
      `INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month) VALUES
        ($1, 'House Rent (Metro)', 24000.00, 5),
        ($1, 'Groceries & Elder Care Medicine', 12500.00, 14),
        ($1, 'Electricity & Essential Utilities', 5500.00, 20)`,
      [DEMO_IDS.households.FREEZE]
    );

    await pgClient.query(
      `INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day, prepayment_penalty_pct, remaining_tenure_months) VALUES
        ($1, 'SBI SimplyClick Card Overdue EMI', 95000.00, 42.00, 11500.00, 12, 0.00, 11),
        ($1, 'Bajaj Finserv Medical Bridge Loan', 210000.00, 19.50, 16500.00, 18, 1.50, 16)`,
      [DEMO_IDS.users.nairPrimary]
    );

    await pgClient.query(
      `INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund) VALUES
        ($1, 'Federal Bank Survival Savings', 18000.00, TRUE)`,
      [DEMO_IDS.households.FREEZE]
    );

    // -------------------------------------------------------------------------
    // 8. Seed Initial Compliant Asset Allocations & Sample Audit Logs
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct, is_override, override_reason) VALUES
        ($1, $5, 75.00, 15.00, 10.00, FALSE, NULL),
        ($2, $6, 25.00, 35.00, 40.00, FALSE, NULL),
        ($3, $7, 0.00,  50.00, 50.00, FALSE, NULL),
        ($4, $8, 0.00,  0.00,  100.00, FALSE, NULL)`,
      [
        DEMO_IDS.households.SAFE,
        DEMO_IDS.households.CAUTION,
        DEMO_IDS.households.CRITICAL,
        DEMO_IDS.households.FREEZE,
        DEMO_IDS.users.sharmaPrimary,
        DEMO_IDS.users.vermaPrimary,
        DEMO_IDS.users.patelPrimary,
        DEMO_IDS.users.nairPrimary,
      ]
    );

    await pgClient.query(
      `INSERT INTO policy_audit_logs (user_id, attempted_action, enforced_tier, action_blocked, override_reason) VALUES
        ($1, 'ALLOCATE_EQUITY_60_PCT', 'CRITICAL', TRUE, 'Blocked by FS001 Gatekeeper: DTI at 50.00% and Runway at 1.81 months'),
        ($2, 'ALLOCATE_EQUITY_50_PCT', 'CAUTION',  TRUE, 'Blocked by FS001 Gatekeeper: Equity exceeds 25.00% CAUTION cap'),
        ($3, 'ALLOCATE_EQUITY_35_PCT', 'FREEZE',   TRUE, 'Blocked by FS001 Gatekeeper: Household in FREEZE cashflow deficit')`,
      [
        DEMO_IDS.users.patelPrimary,
        DEMO_IDS.users.vermaPrimary,
        DEMO_IDS.users.nairPrimary,
      ]
    );

    // -------------------------------------------------------------------------
    // 9. Seed Saved What-If Scenarios (for 1-click simulation in UI)
    // -------------------------------------------------------------------------
    await pgClient.query(
      `INSERT INTO scenarios (household_id, created_by, scenario_name, params) VALUES
        ($1, $5, 'Primary Earner Layoff Stress Test', '{"drop_primary_earner": true}'::jsonb),
        ($1, $5, '15% Rent Hike + ₹1.5L Medical Shock', '{"baseline_pct_change": 15, "reserve_delta": -150000}'::jsonb),
        ($2, $6, 'Prepay Credit Card + ₹20k Salary Raise', '{"income_delta": 20000, "emi_delta": -6000}'::jsonb),
        ($2, $6, 'Unplanned ₹1.8L Hospitalization Shock', '{"reserve_delta": -180000}'::jsonb),
        ($3, $7, 'Debt Consolidation (-₹12k Monthly EMI)', '{"emi_delta": -12000, "reserve_delta": 50000}'::jsonb),
        ($4, $8, 'Spouse New Job (+₹35,000/mo Income)', '{"income_delta": 35000, "reserve_delta": 40000}'::jsonb)`,
      [
        DEMO_IDS.households.SAFE,
        DEMO_IDS.households.CAUTION,
        DEMO_IDS.households.CRITICAL,
        DEMO_IDS.households.FREEZE,
        DEMO_IDS.users.sharmaPrimary,
        DEMO_IDS.users.vermaPrimary,
        DEMO_IDS.users.patelPrimary,
        DEMO_IDS.users.nairPrimary,
      ]
    );

    await pgClient.query("COMMIT");

    // -------------------------------------------------------------------------
    // 10. Seed MongoDB `daily_expenses` & Sync MTD Totals to PostgreSQL
    // -------------------------------------------------------------------------
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const txDate = (day, hour = 14) =>
      new Date(Date.UTC(y, m, Math.min(day, 28), hour, 30, 0));

    const demoExpenses = [
      // Sharma Family (SAFE) — Total discretionary MTD: ₹18,500 (Cap: ₹60,000)
      {
        expense_id: "demo-sharma-tx-01",
        household_id: DEMO_IDS.households.SAFE,
        user_id: DEMO_IDS.users.sharmaPrimary,
        amount: 6500.0,
        category: "Family Weekend Dining",
        is_discretionary: true,
        timestamp: txDate(2, 19),
        merchant_metadata: {
          name: "Truffles & Olive Bistro",
          location: "Bengaluru",
          tags: ["UPI", "Dining"],
        },
      },
      {
        expense_id: "demo-sharma-tx-02",
        household_id: DEMO_IDS.households.SAFE,
        user_id: DEMO_IDS.users.sharmaSpouse,
        amount: 8200.0,
        category: "Apparel & Kids Retail",
        is_discretionary: true,
        timestamp: txDate(5, 16),
        merchant_metadata: {
          name: "Myntra Fashion",
          location: "Online",
          tags: ["CREDIT_CARD", "Shopping"],
        },
      },
      {
        expense_id: "demo-sharma-tx-03",
        household_id: DEMO_IDS.households.SAFE,
        user_id: DEMO_IDS.users.sharmaPrimary,
        amount: 3800.0,
        category: "Streaming & Cloud Gaming",
        is_discretionary: true,
        timestamp: txDate(8, 11),
        merchant_metadata: {
          name: "Apple & Netflix Bundle",
          location: "Online",
          tags: ["CREDIT_CARD", "Subscription"],
        },
      },

      // Verma Household (CAUTION) — Total discretionary MTD: ₹11,400 (Cap: ₹19,000)
      {
        expense_id: "demo-verma-tx-01",
        household_id: DEMO_IDS.households.CAUTION,
        user_id: DEMO_IDS.users.vermaPrimary,
        amount: 4900.0,
        category: "Food Delivery & Takeout",
        is_discretionary: true,
        timestamp: txDate(3, 20),
        merchant_metadata: {
          name: "Swiggy Instamart & Dining",
          location: "Pune",
          tags: ["UPI", "Food"],
        },
      },
      {
        expense_id: "demo-verma-tx-02",
        household_id: DEMO_IDS.households.CAUTION,
        user_id: DEMO_IDS.users.vermaPrimary,
        amount: 6500.0,
        category: "Electronics Accessories",
        is_discretionary: true,
        timestamp: txDate(7, 15),
        merchant_metadata: {
          name: "Croma Retail",
          location: "Pune",
          tags: ["CREDIT_CARD", "Gadgets"],
        },
      },

      // Patel Household (CRITICAL) — Total discretionary MTD: ₹5,200 (Cap: ₹8,750)
      {
        expense_id: "demo-patel-tx-01",
        household_id: DEMO_IDS.households.CRITICAL,
        user_id: DEMO_IDS.users.patelPrimary,
        amount: 3200.0,
        category: "Festival Gifts & Sweets",
        is_discretionary: true,
        timestamp: txDate(4, 18),
        merchant_metadata: {
          name: "Anand Sweets",
          location: "Ahmedabad",
          tags: ["UPI", "Gifts"],
        },
      },
      {
        expense_id: "demo-patel-tx-02",
        household_id: DEMO_IDS.households.CRITICAL,
        user_id: DEMO_IDS.users.patelPrimary,
        amount: 2000.0,
        category: "Ride-Hailing & Cab Commute",
        is_discretionary: true,
        timestamp: txDate(6, 10),
        merchant_metadata: {
          name: "Uber India",
          location: "Ahmedabad",
          tags: ["UPI", "Transit"],
        },
      },

      // Nair Household (FREEZE) — Total discretionary MTD: ₹1,800 (Cap: ₹0)
      {
        expense_id: "demo-nair-tx-01",
        household_id: DEMO_IDS.households.FREEZE,
        user_id: DEMO_IDS.users.nairPrimary,
        amount: 1800.0,
        category: "Emergency Cab & Pharmacy",
        is_discretionary: true,
        timestamp: txDate(2, 21),
        merchant_metadata: {
          name: "Apollo & Auto Rickshaw",
          location: "Kochi",
          tags: ["UPI", "Medical"],
        },
      },
    ];

    for (const exp of demoExpenses) {
      await logDailyExpenseAndSync(mongoDb, pgClient, exp);
    }

    // Ensure all 4 households are synced and retrieve final snapshot states
    const summary = [];
    for (const [tierKey, hId] of Object.entries(DEMO_IDS.households)) {
      const snap = await syncHouseholdMtdToPostgres(mongoDb, pgClient, hId, now);
      summary.push({
        expected: tierKey,
        household_id: hId,
        current_tier: snap.current_tier,
        discretionary_mtd: snap.discretionary_mtd,
        discretionary_cap: snap.discretionary_cap,
        structural_surplus: snap.structural_surplus,
      });
    }

    log("=================================================================");
    log("FinShield Phase 5 Polyglot Demo Seeder Complete!");
    log("-----------------------------------------------------------------");
    for (const s of summary) {
      log(
        `  [${s.current_tier.padEnd(8)}] Household ${s.household_id.slice(0, 8)}... | Surplus: ₹${s.structural_surplus.toLocaleString("en-IN")} | MTD Spend: ₹${s.discretionary_mtd.toLocaleString("en-IN")} / Cap: ₹${s.discretionary_cap.toLocaleString("en-IN")}`
      );
    }
    log("=================================================================");

    return { DEMO_IDS, summary };
  } catch (err) {
    if (pgClient) {
      try {
        await pgClient.query("ROLLBACK");
      } catch (_) {}
    }
    throw err;
  } finally {
    if (pgClient) pgClient.release();
    if (!existingPool) await pool.end();
    if (!existingMongoClient) await mongoClient.close();
  }
}

if (require.main === module) {
  seedDemoData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[FATAL] Demo seeding failed:", err);
      process.exit(1);
    });
}

module.exports = { seedDemoData, DEMO_IDS };
