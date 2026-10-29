// src/lib/db.js
// FinShield — Phase 5: Next.js Server-Side Connection Pooling & Polyglot Data Layer
// Implements TRD Section 2.2:
// "API Layer: Next.js Route Handlers (/api/v1/...) executing server-side database
//  drivers with connection pooling."

const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });

const { Pool } = require("pg");
const { MongoClient } = require("mongodb");
const { initMongoSchema, COLLECTION_NAME } = require("../../db/mongo/init_mongo");
const {
  getMonthBounds,
  computeHouseholdDiscretionaryMtd,
  computeCategoryBreakdown,
  syncHouseholdMtdToPostgres,
  logDailyExpenseAndSync,
  deleteDailyExpenseAndSync,
  recordReimbursementOrRefund,
} = require("../../db/mongo/spend_sync_service");
const { seedDemoData, DEMO_IDS } = require("../../db/seed_demo");

const PG_URI =
  process.env.DATABASE_URL || "postgres://postgres:simple@localhost:5432/finshield";
const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/finshield";

// Global singleton connection pools across Next.js hot-reloads
const globalForDb = globalThis;

if (!globalForDb.__finshieldPgPool) {
  globalForDb.__finshieldPgPool = new Pool({
    connectionString: PG_URI,
    max: 15,
  });
}

if (!globalForDb.__finshieldMongoClient) {
  globalForDb.__finshieldMongoClient = new MongoClient(MONGO_URI);
}

const pgPool = globalForDb.__finshieldPgPool;
const mongoClient = globalForDb.__finshieldMongoClient;

async function getMongoDb() {
  if (!globalForDb.__finshieldMongoDbPromise) {
    globalForDb.__finshieldMongoDbPromise = (async () => {
      await mongoClient.connect();
      const dbName =
        new URL(MONGO_URI).pathname.replace(/^\//, "") || "finshield";
      const db = mongoClient.db(dbName);
      await initMongoSchema(db);
      return db;
    })();
  }
  return globalForDb.__finshieldMongoDbPromise;
}

async function ensureDemoSeeded() {
  if (globalForDb.__finshieldSeededChecked) return;
  await getMongoDb();
  const check = await pgPool.query(
    `SELECT COUNT(*)::int AS cnt FROM households WHERE household_id = $1::uuid`,
    [DEMO_IDS.households.SAFE]
  );
  if (check.rows[0].cnt === 0) {
    await seedDemoData({
      existingPool: pgPool,
      existingMongoClient: mongoClient,
      silent: true,
    });
  }
  globalForDb.__finshieldSeededChecked = true;
}

/**
 * Executes a callback with a pooled PostgreSQL client and optional RLS session context.
 */
async function withPgClient(rlsContext, fn) {
  await ensureDemoSeeded();
  const client = await pgPool.connect();
  try {
    if (rlsContext && rlsContext.userId && rlsContext.role) {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_user_role', $2, true)`,
        [String(rlsContext.userId), String(rlsContext.role)]
      );
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } else {
      await client.query("RESET app.current_user_id");
      await client.query("RESET app.current_user_role");
      return await fn(client);
    }
  } catch (err) {
    if (rlsContext && rlsContext.userId && rlsContext.role) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Extracts optional RLS headers or query parameters from a Next.js Request.
 */
function extractRlsContext(request) {
  if (!request) return { userId: null, role: null };
  const url = new URL(request.url, "http://localhost:3000");
  const headers = request.headers;
  const getHeader = (name) =>
    typeof headers?.get === "function"
      ? headers.get(name)
      : headers?.[name] || null;

  return {
    userId: getHeader("x-user-id") || url.searchParams.get("rlsUserId") || null,
    role: getHeader("x-user-role") || url.searchParams.get("rlsRole") || null,
  };
}

/**
 * Computes amortization payoff months and total interest for Avalanche vs Snowball.
 */
function simulateAmortizationSummary(liabilities, strategy, extraSurplus) {
  const debts = liabilities
    .filter((l) => Number(l.principal_remaining) > 0)
    .map((l) => ({
      debt_id: l.debt_id,
      lender_name: l.lender_name,
      balance: Number(l.principal_remaining),
      rate: Number(l.annual_interest_rate),
      emi: Number(l.monthly_emi),
    }));

  if (debts.length === 0) {
    return { total_months: 0, total_interest_paid: 0, total_principal: 0 };
  }

  const totalPrincipal = debts.reduce((acc, d) => acc + d.balance, 0);
  let months = 0;
  let totalInterest = 0;
  const maxMonths = 360;

  while (debts.some((d) => d.balance > 0.01) && months < maxMonths) {
    months++;
    const active = debts.filter((d) => d.balance > 0.01);
    if (strategy === "AVALANCHE") {
      active.sort((a, b) => b.rate - a.rate || a.balance - b.balance);
    } else {
      active.sort((a, b) => a.balance - b.balance || b.rate - a.rate);
    }

    let extraPool = Math.max(Number(extraSurplus) || 0, 0);

    for (const d of active) {
      const monthlyInterest = d.balance * (d.rate / 100 / 12);
      totalInterest += monthlyInterest;
      d.balance += monthlyInterest;

      const payment = Math.min(d.balance, d.emi);
      d.balance -= payment;
      if (d.emi > payment) {
        extraPool += d.emi - payment;
      }
    }

    for (const d of active) {
      if (extraPool <= 0.01) break;
      if (d.balance > 0.01) {
        const extraPay = Math.min(d.balance, extraPool);
        d.balance -= extraPay;
        extraPool -= extraPay;
      }
    }
  }

  return {
    total_months: months,
    total_interest_paid: Number(totalInterest.toFixed(2)),
    total_principal: Number(totalPrincipal.toFixed(2)),
  };
}

/**
 * Fetches all demo households with live snapshots.
 */
async function getHouseholdsList(rlsContext = null) {
  return withPgClient(rlsContext, async (client) => {
    const hRes = await client.query(
      `SELECT
          h.household_id,
          h.household_name,
          fs.total_monthly_income::float8 AS total_monthly_income,
          fs.total_baseline_costs::float8 AS total_baseline_costs,
          fs.total_monthly_emi::float8 AS total_monthly_emi,
          fs.total_liquid_reserves::float8 AS total_liquid_reserves,
          fs.structural_surplus::float8 AS structural_surplus,
          fs.discretionary_mtd::float8 AS discretionary_mtd,
          fs.discretionary_cap::float8 AS discretionary_cap,
          fs.emergency_runway_months::float8 AS emergency_runway_months,
          fs.dti_ratio::float8 AS dti_ratio,
          fs.rigidity_ratio::float8 AS rigidity_ratio,
          fs.base_tier,
          fs.current_tier,
          fs.tier_reasons,
          fs.last_recalculated,
          (
            SELECT json_build_object(
              'user_id', u.user_id,
              'full_name', u.full_name,
              'email', u.email,
              'role', u.role
            )
            FROM users u
            WHERE u.household_id = h.household_id
            ORDER BY u.created_at ASC
            LIMIT 1
          ) AS primary_user
       FROM households h
       JOIN financial_snapshots fs ON fs.household_id = h.household_id
       ORDER BY
         CASE fs.current_tier
           WHEN 'SAFE' THEN 1
           WHEN 'CAUTION' THEN 2
           WHEN 'CRITICAL' THEN 3
           WHEN 'FREEZE' THEN 4
         END ASC,
         h.created_at DESC`
    );
    return {
      households: hRes.rows,
      coach_user_id: DEMO_IDS.coachUser,
      admin_user_id: DEMO_IDS.adminUser,
    };
  });
}

/**
 * Fetches the complete polyglot dashboard state for a single household.
 */
async function getHouseholdDashboard(householdId, rlsContext = null) {
  const mongoDb = await getMongoDb();

  return withPgClient(rlsContext, async (client) => {
    const hRes = await client.query(
      `SELECT household_id, household_name, created_at
       FROM households WHERE household_id = $1::uuid`,
      [householdId]
    );
    if (hRes.rows.length === 0) {
      return null;
    }

    const snapRes = await client.query(
      `SELECT
          snapshot_id,
          household_id,
          total_monthly_income::float8 AS total_monthly_income,
          total_baseline_costs::float8 AS total_baseline_costs,
          total_monthly_emi::float8 AS total_monthly_emi,
          total_liquid_reserves::float8 AS total_liquid_reserves,
          structural_surplus::float8 AS structural_surplus,
          discretionary_mtd::float8 AS discretionary_mtd,
          discretionary_cap::float8 AS discretionary_cap,
          emergency_runway_months::float8 AS emergency_runway_months,
          dti_ratio::float8 AS dti_ratio,
          rigidity_ratio::float8 AS rigidity_ratio,
          base_tier,
          current_tier,
          tier_reasons,
          last_recalculated
       FROM financial_snapshots WHERE household_id = $1::uuid`,
      [householdId]
    );
    const usersRes = await client.query(
      `SELECT u.user_id, u.full_name, u.email, u.role,
              rp.age, rp.risk_appetite
       FROM users u
       LEFT JOIN risk_profiles rp ON rp.user_id = u.user_id
       WHERE u.household_id = $1::uuid
       ORDER BY u.created_at ASC`,
      [householdId]
    );
    const depsRes = await client.query(
      `SELECT dependent_id, full_name, relationship, age
       FROM dependents WHERE household_id = $1::uuid
       ORDER BY age ASC`,
      [householdId]
    );
    const incRes = await client.query(
      `SELECT i.income_id, i.user_id, u.full_name AS earner_name,
              i.source_name, i.monthly_amount::float8 AS monthly_amount,
              i.is_primary_earner, COALESCE(i.pay_day_of_month, 1) AS pay_day_of_month
       FROM incomes i
       JOIN users u ON u.user_id = i.user_id
       WHERE u.household_id = $1::uuid
       ORDER BY i.is_primary_earner DESC, i.monthly_amount DESC`,
      [householdId]
    );
    const baseRes = await client.query(
      `SELECT expense_id, category_name, monthly_amount::float8 AS monthly_amount,
              COALESCE(due_day_of_month, 5) AS due_day_of_month
       FROM baseline_expenses
       WHERE household_id = $1::uuid
       ORDER BY monthly_amount DESC`,
      [householdId]
    );
    const liabRes = await client.query(
      `SELECT l.debt_id, l.user_id, u.full_name AS borrower_name,
              l.lender_name, l.principal_remaining::float8 AS principal_remaining,
              l.annual_interest_rate::float8 AS annual_interest_rate,
              l.monthly_emi::float8 AS monthly_emi,
              COALESCE(l.emi_due_day, 10) AS emi_due_day,
              l.prepayment_penalty_pct::float8 AS prepayment_penalty_pct,
              l.remaining_tenure_months
       FROM liabilities l
       JOIN users u ON u.user_id = l.user_id
       WHERE u.household_id = $1::uuid
       ORDER BY l.annual_interest_rate DESC`,
      [householdId]
    );
    const assetRes = await client.query(
      `SELECT asset_id, asset_name, current_balance::float8 AS current_balance,
              is_emergency_fund
       FROM liquid_assets
       WHERE household_id = $1::uuid
       ORDER BY is_emergency_fund DESC, current_balance DESC`,
      [householdId]
    );
    const capRes = await client.query(
      `SELECT cap_override::float8 AS cap_override, updated_at
       FROM discretionary_caps WHERE household_id = $1::uuid`,
      [householdId]
    );
    const allocPolicyRes = await client.query(
      `SELECT
          household_id,
          current_tier,
          action_status,
          allowed_equity_max::float8 AS allowed_equity_max,
          recommended_equity::float8 AS recommended_equity,
          recommended_debt::float8 AS recommended_debt,
          recommended_emergency::float8 AS recommended_emergency,
          policy_message,
          tier_reasons
       FROM sp_evaluate_allocation_policy($1::uuid, NULL)`,
      [householdId]
    );
    const activeAllocRes = await client.query(
      `SELECT
          allocation_id,
          created_by,
          equity_pct::float8 AS equity_pct,
          debt_pct::float8 AS debt_pct,
          emergency_pct::float8 AS emergency_pct,
          is_override,
          override_reason,
          created_at
       FROM asset_allocations
       WHERE household_id = $1::uuid
       ORDER BY created_at DESC
       LIMIT 1`,
      [householdId]
    );
    const playbooksRes = await client.query(
      `SELECT
          playbook_id,
          trigger_tier,
          category_tag,
          title,
          content_text,
          action_steps,
          similarity_score::float8 AS similarity_score
       FROM fn_get_playbooks_for_household($1::uuid, NULL, 3)`,
      [householdId]
    );
    const scenariosRes = await client.query(
      `SELECT scenario_id, scenario_name, params, created_at
       FROM scenarios
       WHERE household_id = $1::uuid
       ORDER BY created_at ASC`,
      [householdId]
    );
    const auditRes = await client.query(
      `SELECT pal.log_id, pal.user_id, u.full_name AS user_name,
              pal.attempted_action, pal.enforced_tier,
              pal.action_blocked, pal.override_reason, pal.logged_at
       FROM policy_audit_logs pal
       JOIN users u ON u.user_id = pal.user_id
       WHERE u.household_id = $1::uuid
       ORDER BY pal.logged_at DESC
       LIMIT 10`,
      [householdId]
    );

    const now = new Date();
    const { monthStart, nextMonthStart } = getMonthBounds(now);
    const [mongoMtd, mongoCategories, mongoRecentDocs] = await Promise.all([
      computeHouseholdDiscretionaryMtd(mongoDb, householdId, now),
      computeCategoryBreakdown(mongoDb, householdId, now),
      mongoDb
        .collection(COLLECTION_NAME)
        .find({
          household_id: String(householdId),
          timestamp: { $gte: monthStart, $lt: nextMonthStart },
        })
        .sort({ timestamp: -1 })
        .limit(25)
        .toArray(),
    ]);

    return {
      household: hRes.rows[0],
      snapshot: snapRes.rows[0] || null,
      users: usersRes.rows,
      dependents: depsRes.rows,
      incomes: incRes.rows,
      baseline_expenses: baseRes.rows,
      liabilities: liabRes.rows,
      liquid_assets: assetRes.rows,
      custom_cap_override: capRes.rows[0] ? capRes.rows[0].cap_override : null,
      allocation_policy: allocPolicyRes.rows[0] || null,
      active_allocation: activeAllocRes.rows[0] || null,
      playbooks: playbooksRes.rows,
      saved_scenarios: scenariosRes.rows,
      audit_logs: auditRes.rows,
      mongo: {
        mtd_summary: mongoMtd,
        category_breakdown: mongoCategories,
        transactions: mongoRecentDocs.map((d) => ({
          expense_id: d.expense_id,
          household_id: d.household_id,
          user_id: d.user_id,
          amount: Number(d.amount),
          category: d.category,
          is_discretionary: d.is_discretionary,
          merchant_metadata: d.merchant_metadata || null,
          timestamp: d.timestamp,
        })),
      },
    };
  });
}

module.exports = {
  pgPool,
  mongoClient,
  getMongoDb,
  withPgClient,
  extractRlsContext,
  simulateAmortizationSummary,
  getHouseholdsList,
  getHouseholdDashboard,
  COLLECTION_NAME,
  DEMO_IDS,
  seedDemoData,
  getMonthBounds,
  computeHouseholdDiscretionaryMtd,
  computeCategoryBreakdown,
  syncHouseholdMtdToPostgres,
  logDailyExpenseAndSync,
  deleteDailyExpenseAndSync,
  recordReimbursementOrRefund,
};
