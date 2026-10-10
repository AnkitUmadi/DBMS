// db/tests/phase3_polyglot_tests.js
// FinShield — Phase 3 Polyglot End-to-End Integration Test Suite
// Exercises live MongoDB 8+ ($jsonSchema validation, indexes, aggregation pipelines)
// alongside live PostgreSQL 16+ (fn_set_discretionary_mtd, snapshot triggers, Gatekeeper FS001).
// Zero residual test data: PostgreSQL runs in a rolled-back transaction; MongoDB cleans up in finally.

const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });

const { MongoClient, Double } = require("mongodb");
const { Client: PgClient } = require("pg");
const { COLLECTION_NAME, initMongoSchema } = require("../mongo/init_mongo");
const {
  computeCategoryBreakdown,
  syncHouseholdMtdToPostgres,
  logDailyExpenseAndSync,
  deleteDailyExpenseAndSync,
} = require("../mongo/spend_sync_service");

let passCount = 0;
let failCount = 0;

function ok(name, condition, detail = "") {
  if (condition) {
    passCount++;
    console.log(`PASS  ${name}`);
  } else {
    failCount++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
    throw new Error(`Assertion failed: ${name}`);
  }
}

async function expectMongoError(name, fn, expectedCode) {
  try {
    await fn();
  } catch (err) {
    if (err && err.code === expectedCode) {
      passCount++;
      console.log(`PASS  ${name} (MongoError ${err.code})`);
      return;
    }
    failCount++;
    throw new Error(
      `FAIL  ${name}: got code ${err && err.code} (${err && err.message}), wanted ${expectedCode}`
    );
  }
  failCount++;
  throw new Error(`FAIL  ${name}: expected MongoError ${expectedCode}, but succeeded`);
}

async function expectPgError(name, fn, expectedSqlState) {
  try {
    await fn();
  } catch (err) {
    if (err && err.code === expectedSqlState) {
      passCount++;
      console.log(`PASS  ${name} (SQLSTATE ${err.code})`);
      return;
    }
    failCount++;
    throw new Error(
      `FAIL  ${name}: got SQLSTATE ${err && err.code} (${err && err.message}), wanted ${expectedSqlState}`
    );
  }
  failCount++;
  throw new Error(`FAIL  ${name}: expected SQLSTATE ${expectedSqlState}, but succeeded`);
}

async function runTests() {
  const mongoUri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/finshield";
  const pgUrl = process.env.DATABASE_URL;

  if (!pgUrl) {
    throw new Error("DATABASE_URL is not set in environment or .env.local");
  }

  const mongoClient = new MongoClient(mongoUri);
  const pgClient = new PgClient({ connectionString: pgUrl });

  const testRunId = crypto.randomUUID().slice(0, 8);
  const trackedHouseholds = [];

  await mongoClient.connect();
  await pgClient.connect();

  const mongoDb = mongoClient.db();
  const col = await initMongoSchema(mongoDb);

  try {
    await pgClient.query("BEGIN");

    // Helper: create a household in Postgres with known financials
    // Income: 100,000 | Baseline: 30,000 | EMI: 20,000 | Emergency Reserves: 400,000
    // -> Structural Surplus = 50,000 | Default Cap = 25,000 | Runway = 8.00 | DTI = 20% | Tier = SAFE
    const hhRes = await pgClient.query(
      `INSERT INTO households (household_name) VALUES ($1) RETURNING household_id`,
      [`PolyglotHH_${testRunId}`]
    );
    const householdId = hhRes.rows[0].household_id;
    trackedHouseholds.push(householdId);

    const usrRes = await pgClient.query(
      `INSERT INTO users (household_id, full_name, email, password_hash, role)
       VALUES ($1, 'Polyglot Tester', $2, 'hash', 'USER')
       RETURNING user_id`,
      [householdId, `polyglot_${testRunId}@test.example`]
    );
    const userId = usrRes.rows[0].user_id;

    await pgClient.query(
      `INSERT INTO incomes (user_id, source_name, monthly_amount) VALUES ($1, 'Primary Salary', 100000)`,
      [userId]
    );
    await pgClient.query(
      `INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month)
       VALUES ($1, 'Rent & Utilities', 30000, 5)`,
      [householdId]
    );
    await pgClient.query(
      `INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day)
       VALUES ($1, 'HDFC Car Loan', 240000, 10.5, 20000, 10)`,
      [userId]
    );
    await pgClient.query(
      `INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund)
       VALUES ($1, 'Liquid Emergency Vault', 400000, TRUE)`,
      [householdId]
    );
    await pgClient.query(
      `INSERT INTO risk_profiles (user_id, age, risk_appetite) VALUES ($1, 30, 'AGGRESSIVE')`,
      [userId]
    );

    const now = new Date();
    const currentMonthMid = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10, 12, 0, 0)
    );
    const prevMonthMid = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, 12, 0, 0)
    );

    // =========================================================================
    // T1: MongoDB $jsonSchema Validator & Index Constraints (TRD Section 5.3)
    // =========================================================================
    console.log("\n--- T1: MongoDB $jsonSchema Validator & Index Constraints");

    const schemaTestHh = `schema_hh_${testRunId}`;
    trackedHouseholds.push(schemaTestHh);

    // 1.1 Valid document with rich merchant_metadata inserts cleanly
    const validExpenseId = `exp_valid_${testRunId}`;
    const validInsert = await col.insertOne({
      expense_id: validExpenseId,
      household_id: schemaTestHh,
      user_id: userId,
      amount: new Double(450.75),
      category: "COFFEE_AND_SNACKS",
      is_discretionary: true,
      merchant_metadata: {
        name: "Third Wave Coffee",
        location: "Bengaluru, IN",
        tags: ["coffee", "work-break", "upi"],
      },
      timestamp: currentMonthMid,
    });
    ok("T1.1 Valid expense with nested merchant_metadata inserts cleanly", !!validInsert.insertedId);

    // 1.2 Missing required field (`category`) rejected with 121
    await expectMongoError(
      "T1.2 Missing required field (category) rejected by $jsonSchema",
      () =>
        col.insertOne({
          expense_id: `exp_nocat_${testRunId}`,
          household_id: schemaTestHh,
          user_id: userId,
          amount: new Double(100.0),
          is_discretionary: true,
          timestamp: currentMonthMid,
        }),
      121
    );

    // 1.3 Negative amount rejected by $jsonSchema (`minimum: 0`)
    await expectMongoError(
      "T1.3 Negative amount (-250.00) rejected by $jsonSchema",
      () =>
        col.insertOne({
          expense_id: `exp_neg_${testRunId}`,
          household_id: schemaTestHh,
          user_id: userId,
          amount: new Double(-250.0),
          category: "DINING",
          is_discretionary: true,
          timestamp: currentMonthMid,
        }),
      121
    );

    // 1.4 Wrong BSON type for amount (string instead of number) rejected
    await expectMongoError(
      "T1.4 String amount ('500') rejected by $jsonSchema",
      () =>
        col.insertOne({
          expense_id: `exp_stramt_${testRunId}`,
          household_id: schemaTestHh,
          user_id: userId,
          amount: "500.00",
          category: "DINING",
          is_discretionary: true,
          timestamp: currentMonthMid,
        }),
      121
    );

    // 1.5 Invalid merchant_metadata.tags element type (number in string[]) rejected
    await expectMongoError(
      "T1.5 Non-string element inside merchant_metadata.tags rejected by $jsonSchema",
      () =>
        col.insertOne({
          expense_id: `exp_badtags_${testRunId}`,
          household_id: schemaTestHh,
          user_id: userId,
          amount: new Double(120.0),
          category: "DINING",
          is_discretionary: true,
          merchant_metadata: {
            name: "Cafe",
            tags: ["valid-tag", 99999],
          },
          timestamp: currentMonthMid,
        }),
      121
    );

    // 1.6 Duplicate expense_id rejected by unique index idx_expense_id_uq (code 11000)
    await expectMongoError(
      "T1.6 Duplicate expense_id rejected by unique index (idempotent webhook protection)",
      () =>
        col.insertOne({
          expense_id: validExpenseId,
          household_id: schemaTestHh,
          user_id: userId,
          amount: new Double(450.75),
          category: "COFFEE_AND_SNACKS",
          is_discretionary: true,
          timestamp: currentMonthMid,
        }),
      11000
    );

    // =========================================================================
    // T2: MongoDB Aggregation Pipeline & Reconciliation Filtering
    // =========================================================================
    console.log("\n--- T2: MongoDB Aggregation Pipeline & Reconciliation Filtering");

    // 2.1 Reconciled Auto-Debit EMI (`is_discretionary: false`) is logged in Mongo
    //     but strictly ignored by the MTD discretionary aggregation pipeline!
    const emiLog = await logDailyExpenseAndSync(mongoDb, pgClient, {
      expense_id: `exp_emi_${testRunId}`,
      household_id: householdId,
      user_id: userId,
      amount: 20000.0,
      category: "LOAN_EMI_AUTO_DEBIT",
      is_discretionary: false,
      merchant_metadata: {
        name: "HDFC Bank NACH Mandate",
        tags: ["auto-debit", "emi", "reconciled"],
      },
      timestamp: currentMonthMid,
    });
    ok(
      "T2.1 Reconciled EMI (is_discretionary=false) excluded from discretionary_mtd",
      emiLog.snapshot.discretionary_mtd === 0 &&
        emiLog.snapshot.current_tier === "SAFE"
    );

    // 2.2 Previous month discretionary spend does NOT bleed into current month MTD
    await logDailyExpenseAndSync(mongoDb, pgClient, {
      expense_id: `exp_prevmonth_${testRunId}`,
      household_id: householdId,
      user_id: userId,
      amount: 42000.0,
      category: "VACATION_LAST_MONTH",
      is_discretionary: true,
      timestamp: prevMonthMid,
    });
    const currentSnapAfterPrev = await syncHouseholdMtdToPostgres(
      mongoDb,
      pgClient,
      householdId,
      currentMonthMid
    );
    ok(
      "T2.2 Previous month spend (42k) does not affect current month MTD (remains 0, SAFE)",
      currentSnapAfterPrev.discretionary_mtd === 0 &&
        currentSnapAfterPrev.current_tier === "SAFE"
    );

    // 2.3 Log 2 current-month discretionary transactions (10,000 + 8,500 = 18,500 <= 25,000 cap)
    await logDailyExpenseAndSync(mongoDb, pgClient, {
      expense_id: `exp_dining_${testRunId}`,
      household_id: householdId,
      user_id: userId,
      amount: 10000.0,
      category: "DINING_OUT",
      is_discretionary: true,
      merchant_metadata: { name: "Swiggy / Zomato", tags: ["food-delivery"] },
      timestamp: currentMonthMid,
    });

    const shopLog = await logDailyExpenseAndSync(mongoDb, pgClient, {
      expense_id: `exp_shopping_${testRunId}`,
      household_id: householdId,
      user_id: userId,
      amount: 8500.0,
      category: "SHOPPING",
      is_discretionary: true,
      merchant_metadata: { name: "Amazon India", tags: ["apparel"] },
      timestamp: currentMonthMid,
    });

    ok(
      "T2.3 Two discretionary spends aggregate to 18,500.00 across 2 transactions (SAFE)",
      shopLog.snapshot.discretionary_mtd === 18500 &&
        shopLog.snapshot.transaction_count === 2 &&
        shopLog.snapshot.current_tier === "SAFE"
    );

    // 2.4 Idempotency: Running sync 3 times without new spends keeps MTD at exactly 18,500
    await syncHouseholdMtdToPostgres(mongoDb, pgClient, householdId, currentMonthMid);
    await syncHouseholdMtdToPostgres(mongoDb, pgClient, householdId, currentMonthMid);
    const idempSnap = await syncHouseholdMtdToPostgres(
      mongoDb,
      pgClient,
      householdId,
      currentMonthMid
    );
    ok(
      "T2.4 Repeated sync runs are 100% idempotent (absolute total 18,500, never delta-doubled)",
      idempSnap.discretionary_mtd === 18500 && idempSnap.current_tier === "SAFE"
    );

    // 2.5 Category breakdown pipeline groups discretionary and non-discretionary accurately
    const breakdown = await computeCategoryBreakdown(
      mongoDb,
      householdId,
      currentMonthMid
    );
    ok(
      "T2.5 Category breakdown pipeline returns 3 categories sorted by amount DESC",
      breakdown.length === 3 &&
        breakdown[0].category === "LOAN_EMI_AUTO_DEBIT" &&
        breakdown[0].is_discretionary === false &&
        breakdown[0].total_amount === 20000 &&
        breakdown[1].category === "DINING_OUT" &&
        breakdown[1].total_amount === 10000 &&
        breakdown[2].category === "SHOPPING" &&
        breakdown[2].total_amount === 8500
    );

    // =========================================================================
    // T3: Polyglot Flow B -> Flow C Cascade (Mongo Spend -> Tier Shift -> Gatekeeper FS001)
    // =========================================================================
    console.log(
      "\n--- T3: Polyglot Flow B -> Flow C Cascade (Mongo Spend -> Postgres Tier -> Gatekeeper FS001)"
    );

    // 3.1 While in SAFE (18,500 <= 25,000 cap), 60% equity allocation succeeds
    const evalSafe = await pgClient.query(
      `SELECT * FROM sp_evaluate_allocation_policy($1::uuid, 60.00)`,
      [householdId]
    );
    ok(
      "T3.1 In SAFE tier, sp_evaluate_allocation_policy returns ALLOWED (max 100% equity)",
      evalSafe.rows[0].action_status === "ALLOWED" &&
        Number(evalSafe.rows[0].allowed_equity_max) === 100
    );

    await pgClient.query(
      `INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
       VALUES ($1, $2, 60.00, 20.00, 20.00)`,
      [householdId, userId]
    );
    ok("T3.2 In SAFE tier, 60% equity allocation inserts into PostgreSQL cleanly", true);

    // 3.3 User logs 9,000 Electronics spend in MongoDB -> MTD = 27,500 (> 25,000 cap) -> CAUTION!
    const elecExpenseId = `exp_elec_${testRunId}`;
    const cautLog = await logDailyExpenseAndSync(mongoDb, pgClient, {
      expense_id: elecExpenseId,
      household_id: householdId,
      user_id: userId,
      amount: 9000.0,
      category: "ELECTRONICS",
      is_discretionary: true,
      merchant_metadata: { name: "Croma", tags: ["gadgets"] },
      timestamp: currentMonthMid,
    });
    ok(
      "T3.3 MongoDB spend of 9,000 pushes MTD to 27,500 (> 25k cap) -> Postgres tier becomes CAUTION",
      cautLog.snapshot.discretionary_mtd === 27500 &&
        cautLog.snapshot.current_tier === "CAUTION" &&
        cautLog.snapshot.tier_reasons.some((r) => r.includes("exceeds cap"))
    );

    // 3.4 sp_evaluate_allocation_policy now reports CAPPED at 25% equity
    const evalCaut = await pgClient.query(
      `SELECT * FROM sp_evaluate_allocation_policy($1::uuid, 60.00)`,
      [householdId]
    );
    ok(
      "T3.4 sp_evaluate_allocation_policy transitions to CAPPED (allowed_equity_max = 25.00%)",
      evalCaut.rows[0].action_status === "CAPPED" &&
        Number(evalCaut.rows[0].allowed_equity_max) === 25
    );

    // 3.5 Gatekeeper Trigger (FS001) immediately blocks a 50% equity allocation in PostgreSQL
    await expectPgError(
      "T3.5 Gatekeeper blocks 50% equity allocation after MongoDB overspend downgraded tier to CAUTION",
      async () => {
        await pgClient.query("SAVEPOINT sp_caut_block");
        try {
          await pgClient.query(
            `INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
             VALUES ($1, $2, 50.00, 25.00, 25.00)`,
            [householdId, userId]
          );
        } catch (err) {
          await pgClient.query("ROLLBACK TO SAVEPOINT sp_caut_block");
          throw err;
        }
      },
      "FS001"
    );

    // 3.6 User logs 25,000 Luxury Travel spend in MongoDB -> MTD = 52,500 (> 50,000 surplus) -> FREEZE!
    const travelExpenseId = `exp_travel_${testRunId}`;
    const frzLog = await logDailyExpenseAndSync(mongoDb, pgClient, {
      expense_id: travelExpenseId,
      household_id: householdId,
      user_id: userId,
      amount: 25000.0,
      category: "LUXURY_TRAVEL",
      is_discretionary: true,
      merchant_metadata: { name: "MakeMyTrip", tags: ["vacation", "splurge"] },
      timestamp: currentMonthMid,
    });
    ok(
      "T3.6 MongoDB spend of 25,000 pushes MTD to 52,500 (> 50k surplus) -> Postgres tier becomes FREEZE",
      frzLog.snapshot.discretionary_mtd === 52500 &&
        frzLog.snapshot.current_tier === "FREEZE" &&
        frzLog.snapshot.tier_reasons.some((r) =>
          r.includes("exceeds monthly surplus")
        )
    );

    // 3.7 Gatekeeper Trigger (FS001) now blocks even a 10% equity allocation in FREEZE tier
    await expectPgError(
      "T3.7 Gatekeeper blocks even 10% equity allocation when MongoDB spend triggers FREEZE",
      async () => {
        await pgClient.query("SAVEPOINT sp_frz_block");
        try {
          await pgClient.query(
            `INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
             VALUES ($1, $2, 10.00, 40.00, 50.00)`,
            [householdId, userId]
          );
        } catch (err) {
          await pgClient.query("ROLLBACK TO SAVEPOINT sp_frz_block");
          throw err;
        }
      },
      "FS001"
    );

    // 3.8 Refund / Delete the two splurge transactions in MongoDB -> Tier automatically recovers to SAFE!
    await deleteDailyExpenseAndSync(mongoDb, pgClient, travelExpenseId);
    const recovered = await deleteDailyExpenseAndSync(
      mongoDb,
      pgClient,
      elecExpenseId
    );
    ok(
      "T3.8 Deleting splurge transactions in MongoDB restores MTD to 18,500 and recovers tier to SAFE",
      recovered.deleted === true &&
        recovered.snapshot.discretionary_mtd === 18500 &&
        recovered.snapshot.current_tier === "SAFE"
    );

    // 3.9 Incoming Bill-Split Reimbursement: Friend sends 4,500 back on the 10,000 Dining bill
    const { recordReimbursementOrRefund } = require("../mongo/spend_sync_service");
    const splitRes = await recordReimbursementOrRefund(
      mongoDb,
      pgClient,
      `exp_dining_${testRunId}`,
      4500.0
    );
    ok(
      "T3.9 Incoming bill-split reimbursement (4,500) reduces Dining expense to 5,500 and MTD to 14,000",
      splitRes.updated === true &&
        splitRes.new_amount === 5500 &&
        splitRes.snapshot.discretionary_mtd === 14000 &&
        splitRes.snapshot.current_tier === "SAFE"
    );

    console.log(
      `\n=== Phase 3 Polyglot Tests Complete: All ${passCount} assertions passed (${failCount} failures) ===`
    );
  } finally {
    // Clean up test documents in MongoDB and rollback PostgreSQL transaction
    if (trackedHouseholds.length > 0) {
      await col.deleteMany({ household_id: { $in: trackedHouseholds } });
    }
    try {
      await pgClient.query("ROLLBACK");
    } catch (_) {}
    await pgClient.end();
    await mongoClient.close();
  }
}

runTests().catch((err) => {
  console.error("\n[PHASE 3 TEST FAILURE]:", err.message || err);
  process.exit(1);
});
