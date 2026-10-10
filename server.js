// server.js
// FinShield — Phase 5: Full-Stack Polyglot REST API Server & Dashboard Host
// Connects PostgreSQL 18 (Relational Engine + Triggers + RLS + pgvector Playbooks)
// and MongoDB 8.2 (Dynamic Spend Engine + $jsonSchema Validator + Aggregation Pipeline).

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
require("dotenv").config({ path: path.resolve(__dirname, ".env.local") });

const { Pool } = require("pg");
const { MongoClient } = require("mongodb");
const { initMongoSchema, COLLECTION_NAME } = require("./db/mongo/init_mongo");
const {
  getMonthBounds,
  computeHouseholdDiscretionaryMtd,
  computeCategoryBreakdown,
  syncHouseholdMtdToPostgres,
  logDailyExpenseAndSync,
  deleteDailyExpenseAndSync,
  recordReimbursementOrRefund,
} = require("./db/mongo/spend_sync_service");
const { seedDemoData, DEMO_IDS } = require("./db/seed_demo");

const PORT = Number(process.env.PORT || 3000);
const PG_URI =
  process.env.DATABASE_URL || "postgres://postgres:simple@localhost:5432/finshield";
const MONGO_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/finshield";

const pgPool = new Pool({ connectionString: PG_URI, max: 15 });
const mongoClient = new MongoClient(MONGO_URI);
let mongoDb = null;

// Helper: parse JSON request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Helper: send JSON response
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

// Helper: run a PostgreSQL callback with optional RLS session context
async function withPgClient(rlsContext, fn) {
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

// Helper: compute interest & payoff comparison for Avalanche vs Snowball
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
  const maxMonths = 360; // 30-year safety ceiling

  while (debts.some((d) => d.balance > 0.01) && months < maxMonths) {
    months++;
    // Sort active debts according to strategy
    const active = debts.filter((d) => d.balance > 0.01);
    if (strategy === "AVALANCHE") {
      active.sort((a, b) => b.rate - a.rate || a.balance - b.balance);
    } else {
      active.sort((a, b) => a.balance - b.balance || b.rate - a.rate);
    }

    let extraPool = Math.max(Number(extraSurplus) || 0, 0);

    // 1. Accrue monthly interest and pay base EMI
    for (const d of active) {
      const monthlyInterest = d.balance * (d.rate / 100 / 12);
      totalInterest += monthlyInterest;
      d.balance += monthlyInterest;

      const payment = Math.min(d.balance, d.emi);
      d.balance -= payment;
      // If a debt finished with less than its full EMI, roll leftover EMI into extraPool
      if (d.emi > payment) {
        extraPool += d.emi - payment;
      }
    }

    // 2. Apply extraPool cascading in priority order
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

// Static file server for /public
function serveStaticFile(reqPath, res) {
  const safePath = reqPath === "/" ? "/index.html" : reqPath;
  const fullPath = path.join(__dirname, "public", path.normalize(safePath));
  const publicRoot = path.join(__dirname, "public");

  if (!fullPath.startsWith(publicRoot)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not Found");
    }
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

// Main Request Router
async function handleRequest(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // Optional RLS headers / query params
  const rlsContext = {
    userId:
      req.headers["x-user-id"] || parsedUrl.searchParams.get("rlsUserId") || null,
    role:
      req.headers["x-user-role"] || parsedUrl.searchParams.get("rlsRole") || null,
  };

  try {
    // -----------------------------------------------------------------------
    // 1. GET /api/v1/health
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/v1/health") {
      const pgCheck = await withPgClient(null, (c) =>
        c.query(
          `SELECT version() AS pg_version,
                  (SELECT COUNT(*)::int FROM households) AS household_count,
                  (SELECT COUNT(*)::int FROM recovery_playbooks) AS playbook_count`
        )
      );
      const mongoCount = await mongoDb
        .collection(COLLECTION_NAME)
        .countDocuments();

      return sendJson(res, 200, {
        status: "ok",
        postgres: {
          connected: true,
          household_count: pgCheck.rows[0].household_count,
          playbook_count: pgCheck.rows[0].playbook_count,
        },
        mongodb: {
          connected: true,
          collection: COLLECTION_NAME,
          expense_document_count: mongoCount,
        },
        demo_ids: DEMO_IDS,
      });
    }

    // -----------------------------------------------------------------------
    // 2. GET /api/v1/households
    //    Lists demo households with their live snapshot metrics and primary user
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/v1/households") {
      const data = await withPgClient(rlsContext, async (client) => {
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
           WHERE h.household_id = ANY($1::uuid[])
           ORDER BY
             CASE fs.current_tier
               WHEN 'SAFE' THEN 1
               WHEN 'CAUTION' THEN 2
               WHEN 'CRITICAL' THEN 3
               WHEN 'FREEZE' THEN 4
             END ASC,
             h.household_name ASC`,
          [Object.values(DEMO_IDS.households)]
        );
        return hRes.rows;
      });

      return sendJson(res, 200, {
        households: data,
        coach_user_id: DEMO_IDS.coachUser,
        admin_user_id: DEMO_IDS.adminUser,
      });
    }

    // -----------------------------------------------------------------------
    // 3. GET /api/v1/dashboard/:householdId
    //    Returns full polyglot household state (PostgreSQL + MongoDB + pgvector)
    // -----------------------------------------------------------------------
    const dashMatch = pathname.match(/^\/api\/v1\/dashboard\/([0-9a-fA-F-]+)$/);
    if (method === "GET" && dashMatch) {
      const householdId = dashMatch[1];

      const payload = await withPgClient(rlsContext, async (client) => {
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

        // Fetch MongoDB live MTD aggregation, category breakdown, and recent transactions
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

      if (!payload) {
        return sendJson(res, 404, {
          error: "Household not found or access denied by PostgreSQL RLS.",
        });
      }
      return sendJson(res, 200, payload);
    }

    // -----------------------------------------------------------------------
    // 4. GET /api/v1/forecast/:householdId?days=90
    //    Calls PostgreSQL fn_forecast_cashflow_90d
    // -----------------------------------------------------------------------
    const forecastMatch = pathname.match(/^\/api\/v1\/forecast\/([0-9a-fA-F-]+)$/);
    if (method === "GET" && forecastMatch) {
      const householdId = forecastMatch[1];
      const days = Math.min(
        Math.max(Number(parsedUrl.searchParams.get("days") || 90), 7),
        180
      );

      const rows = await withPgClient(rlsContext, async (client) => {
        const fRes = await client.query(
          `SELECT
              day_offset,
              forecast_date::text AS forecast_date,
              daily_inflow::float8 AS daily_inflow,
              daily_outflow::float8 AS daily_outflow,
              net_daily_flow::float8 AS net_daily_flow,
              projected_balance::float8 AS projected_balance,
              is_deficit
           FROM fn_forecast_cashflow_90d($1::uuid, $2::int, CURRENT_DATE)
           ORDER BY day_offset ASC`,
          [householdId, days]
        );
        return fRes.rows;
      });

      const deficitDays = rows.filter((r) => r.is_deficit);
      const minBalanceRow = rows.reduce(
        (min, r) => (r.projected_balance < min.projected_balance ? r : min),
        rows[0] || { projected_balance: 0, forecast_date: null }
      );

      return sendJson(res, 200, {
        household_id: householdId,
        horizon_days: days,
        deficit_day_count: deficitDays.length,
        first_deficit_date: deficitDays[0] ? deficitDays[0].forecast_date : null,
        lowest_projected_balance: minBalanceRow.projected_balance,
        lowest_balance_date: minBalanceRow.forecast_date,
        series: rows,
      });
    }

    // -----------------------------------------------------------------------
    // 5. GET /api/v1/debt-plan/:householdId?strategy=AVALANCHE&surplus=5000
    //    Calls fn_get_debt_payoff_schedule + compares Avalanche vs Snowball
    // -----------------------------------------------------------------------
    const debtMatch = pathname.match(/^\/api\/v1\/debt-plan\/([0-9a-fA-F-]+)$/);
    if (method === "GET" && debtMatch) {
      const householdId = debtMatch[1];
      const strategy =
        (parsedUrl.searchParams.get("strategy") || "AVALANCHE").toUpperCase() ===
        "SNOWBALL"
          ? "SNOWBALL"
          : "AVALANCHE";
      const extraSurplus = Math.max(
        Number(parsedUrl.searchParams.get("surplus") || 0),
        0
      );

      const data = await withPgClient(rlsContext, async (client) => {
        // Find primary borrower in household
        const uRes = await client.query(
          `SELECT u.user_id, u.full_name
           FROM users u
           WHERE u.household_id = $1::uuid
           ORDER BY
             (SELECT COUNT(*) FROM liabilities l WHERE l.user_id = u.user_id) DESC,
             u.created_at ASC
           LIMIT 1`,
          [householdId]
        );
        if (uRes.rows.length === 0) return null;

        const userId = uRes.rows[0].user_id;

        // Call stored procedure sp_generate_debt_plan + query fn_get_debt_payoff_schedule
        await client.query(`CALL sp_generate_debt_plan($1::uuid, $2::debt_strategy, $3::numeric)`, [
          userId,
          strategy,
          extraSurplus,
        ]);

        const schedRes = await client.query(
          `SELECT
              priority_rank,
              debt_id,
              lender_name,
              principal_remaining::float8 AS principal_remaining,
              annual_rate::float8 AS annual_rate,
              monthly_emi::float8 AS monthly_emi,
              extra_payment_alloc::float8 AS extra_payment_alloc,
              total_monthly_pay::float8 AS total_monthly_pay
           FROM fn_get_debt_payoff_schedule($1::uuid, $2::debt_strategy, $3::numeric)`,
          [userId, strategy, extraSurplus]
        );

        const rawLiabRes = await client.query(
          `SELECT debt_id, lender_name,
                  principal_remaining::float8 AS principal_remaining,
                  annual_interest_rate::float8 AS annual_interest_rate,
                  monthly_emi::float8 AS monthly_emi,
                  prepayment_penalty_pct::float8 AS prepayment_penalty_pct,
                  remaining_tenure_months
           FROM liabilities
           WHERE user_id = $1::uuid AND principal_remaining > 0`,
          [userId]
        );

        const avalancheSim = simulateAmortizationSummary(
          rawLiabRes.rows,
          "AVALANCHE",
          extraSurplus
        );
        const snowballSim = simulateAmortizationSummary(
          rawLiabRes.rows,
          "SNOWBALL",
          extraSurplus
        );
        const baselineSim = simulateAmortizationSummary(
          rawLiabRes.rows,
          strategy,
          0
        );

        const penaltyMap = new Map(
          rawLiabRes.rows.map((r) => [
            r.debt_id,
            {
              prepayment_penalty_pct: r.prepayment_penalty_pct,
              remaining_tenure_months: r.remaining_tenure_months,
            },
          ])
        );

        const schedule = schedRes.rows.map((r) => ({
          ...r,
          ...(penaltyMap.get(r.debt_id) || {
            prepayment_penalty_pct: 0,
            remaining_tenure_months: null,
          }),
        }));

        const activeSim =
          strategy === "AVALANCHE" ? avalancheSim : snowballSim;

        return {
          household_id: householdId,
          borrower: uRes.rows[0],
          strategy,
          extra_surplus: extraSurplus,
          schedule,
          comparison: {
            active_strategy: activeSim,
            without_extra_surplus: baselineSim,
            avalanche: avalancheSim,
            snowball: snowballSim,
            interest_saved_vs_baseline: Number(
              Math.max(
                baselineSim.total_interest_paid - activeSim.total_interest_paid,
                0
              ).toFixed(2)
            ),
            months_saved_vs_baseline: Math.max(
              baselineSim.total_months - activeSim.total_months,
              0
            ),
            avalanche_interest_advantage: Number(
              Math.max(
                snowballSim.total_interest_paid - avalancheSim.total_interest_paid,
                0
              ).toFixed(2)
            ),
          },
        };
      });

      if (!data) {
        return sendJson(res, 404, { error: "Household borrower not found" });
      }
      return sendJson(res, 200, data);
    }

    // -----------------------------------------------------------------------
    // 6. POST /api/v1/expenses
    //    Logs a daily expense to MongoDB ($jsonSchema validated) & syncs MTD
    //    to PostgreSQL via fn_set_discretionary_mtd
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/v1/expenses") {
      const body = await parseBody(req);
      const {
        household_id,
        user_id,
        amount,
        category,
        is_discretionary = true,
        merchant_name = "Retail Merchant",
        location = "Bengaluru",
        payment_mode = "UPI",
      } = body;

      if (!household_id || !user_id || amount === undefined || !category) {
        return sendJson(res, 400, {
          error: "household_id, user_id, amount, and category are required.",
        });
      }

      const expenseDoc = {
        expense_id:
          body.expense_id ||
          `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        household_id: String(household_id),
        user_id: String(user_id),
        amount: Number(amount),
        category: String(category).trim(),
        is_discretionary: Boolean(is_discretionary),
        timestamp: new Date(),
        merchant_metadata: {
          name: String(merchant_name || "Retail Merchant"),
          location: String(location || "India"),
          tags: [String(payment_mode || "UPI"), is_discretionary ? "Discretionary" : "Baseline"],
        },
      };

      try {
        const result = await withPgClient(null, async (pgClient) => {
          return await logDailyExpenseAndSync(mongoDb, pgClient, expenseDoc);
        });

        return sendJson(res, 201, {
          status: "logged_and_synced",
          expense_id: result.expense_id,
          snapshot: result.snapshot,
        });
      } catch (err) {
        // Catch MongoDB $jsonSchema validation error (code 121)
        if (err && err.code === 121) {
          return sendJson(res, 422, {
            error: "Blocked by MongoDB $jsonSchema Validator (MongoError 121)",
            code: 121,
            details: err.message,
          });
        }
        throw err;
      }
    }

    // -----------------------------------------------------------------------
    // 7. POST /api/v1/expenses/refund
    //    Processes P2P split reimbursement or merchant refund in MongoDB &
    //    re-synchronizes PostgreSQL snapshot tier
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/v1/expenses/refund") {
      const body = await parseBody(req);
      const { expense_id, refund_amount, reason = "P2P Bill Split / Refund" } = body;

      if (!expense_id) {
        return sendJson(res, 400, { error: "expense_id is required" });
      }

      const result = await withPgClient(null, async (pgClient) => {
        if (refund_amount === undefined || refund_amount === null || refund_amount === "FULL") {
          return await deleteDailyExpenseAndSync(mongoDb, pgClient, expense_id);
        }
        return await recordReimbursementOrRefund(
          mongoDb,
          pgClient,
          expense_id,
          Number(refund_amount),
          reason
        );
      });

      return sendJson(res, 200, {
        status: "reconciled",
        ...result,
      });
    }

    // -----------------------------------------------------------------------
    // 8. POST /api/v1/cap-override
    //    Sets or clears a custom lower discretionary cap in PostgreSQL
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/v1/cap-override") {
      const body = await parseBody(req);
      const { household_id, cap_override } = body;

      if (!household_id) {
        return sendJson(res, 400, { error: "household_id is required" });
      }

      const parsedCap =
        cap_override === null || cap_override === "" || cap_override === undefined
          ? null
          : Number(cap_override);

      const row = await withPgClient(null, async (pgClient) => {
        const r = await pgClient.query(
          `SELECT
              household_id,
              cap_override::float8 AS cap_override,
              effective_cap::float8 AS effective_cap,
              structural_surplus::float8 AS structural_surplus,
              discretionary_mtd::float8 AS discretionary_mtd,
              current_tier,
              tier_reasons
           FROM fn_set_discretionary_cap_override($1::uuid, $2::numeric)`,
          [household_id, parsedCap]
        );
        return r.rows[0];
      });

      return sendJson(res, 200, {
        status: "cap_updated",
        snapshot: row,
      });
    }

    // -----------------------------------------------------------------------
    // 9. POST /api/v1/allocations
    //    Attempts to save an asset allocation.
    //    If blocked by PostgreSQL Gatekeeper Trigger (SQLSTATE FS001):
    //      - Records blocked attempt in `policy_audit_logs`
    //      - Queries `sp_evaluate_allocation_policy` + snapshot metrics
    //      - Returns HTTP 403 with `code: 'FS001'` and full Explainability Modal data!
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/v1/allocations") {
      const body = await parseBody(req);
      const {
        household_id,
        user_id,
        equity_pct,
        debt_pct,
        emergency_pct,
        is_override = false,
        override_reason = null,
      } = body;

      if (
        !household_id ||
        !user_id ||
        equity_pct === undefined ||
        debt_pct === undefined ||
        emergency_pct === undefined
      ) {
        return sendJson(res, 400, {
          error:
            "household_id, user_id, equity_pct, debt_pct, and emergency_pct are required.",
        });
      }

      const eq = Number(Number(equity_pct).toFixed(2));
      const dt = Number(Number(debt_pct).toFixed(2));
      const em = Number(Number(emergency_pct).toFixed(2));

      if (Math.abs(eq + dt + em - 100.0) > 0.01) {
        return sendJson(res, 400, {
          error: `Total allocation must equal 100.00% (received ${(eq + dt + em).toFixed(2)}%).`,
        });
      }

      try {
        const saved = await withPgClient(null, async (client) => {
          const ins = await client.query(
            `INSERT INTO asset_allocations (
                household_id, created_by, equity_pct, debt_pct, emergency_pct,
                is_override, override_reason
             ) VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric, $6::boolean, $7)
             RETURNING
                allocation_id,
                household_id,
                created_by,
                equity_pct::float8 AS equity_pct,
                debt_pct::float8 AS debt_pct,
                emergency_pct::float8 AS emergency_pct,
                is_override,
                override_reason,
                created_at`,
            [
              household_id,
              user_id,
              eq,
              dt,
              em,
              Boolean(is_override),
              override_reason ? String(override_reason).trim() : null,
            ]
          );
          return ins.rows[0];
        });

        return sendJson(res, 201, {
          status: is_override ? "override_accepted_and_audited" : "allocation_saved",
          allocation: saved,
        });
      } catch (err) {
        // Intercept custom PostgreSQL Gatekeeper exception SQLSTATE 'FS001'
        if (err && err.code === "FS001") {
          const explainability = await withPgClient(null, async (client) => {
            const polRes = await client.query(
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
               FROM sp_evaluate_allocation_policy($1::uuid, $2::numeric)`,
              [household_id, eq]
            );
            const snapRes = await client.query(
              `SELECT
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
                  current_tier,
                  tier_reasons
               FROM financial_snapshots WHERE household_id = $1::uuid`,
              [household_id]
            );

            const pol = polRes.rows[0];
            // Record the blocked Gatekeeper attempt in policy_audit_logs
            await client.query(
              `INSERT INTO policy_audit_logs (
                  user_id, attempted_action, enforced_tier, action_blocked, override_reason
               ) VALUES ($1::uuid, $2, $3::policy_tier, TRUE, $4)`,
              [
                user_id,
                `ATTEMPT_EQUITY_${eq}_PCT`,
                pol.current_tier,
                `Blocked by FS001 Gatekeeper (Max allowed equity: ${pol.allowed_equity_max}%)`,
              ]
            );

            return {
              policy: pol,
              snapshot: snapRes.rows[0],
            };
          });

          return sendJson(res, 403, {
            status: "blocked_by_gatekeeper",
            code: "FS001",
            gatekeeper_error: err.message,
            attempted: {
              equity_pct: eq,
              debt_pct: dt,
              emergency_pct: em,
            },
            explainability: {
              what_happened: err.message,
              why_it_happened: explainability.policy.tier_reasons,
              policy_message: explainability.policy.policy_message,
              data_used: explainability.snapshot,
              recommendation: {
                allowed_equity_max: explainability.policy.allowed_equity_max,
                equity_pct: explainability.policy.recommended_equity,
                debt_pct: explainability.policy.recommended_debt,
                emergency_pct: explainability.policy.recommended_emergency,
              },
            },
          });
        }

        // Check constraint error when override reason is too short
        if (err && err.code === "23514") {
          return sendJson(res, 400, {
            error:
              "Override requires a meaningful justification reason (minimum 5 characters) per CHK_OVERRIDE_REASON_REQUIRED.",
            code: err.code,
          });
        }

        throw err;
      }
    }

    // -----------------------------------------------------------------------
    // 10. POST /api/v1/simulate
    //     Calls non-destructive STABLE function `fn_simulate_scenario`
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/v1/simulate") {
      const body = await parseBody(req);
      const { household_id, params = {}, scenario_id = null } = body;

      const simRow = await withPgClient(rlsContext, async (client) => {
        if (scenario_id) {
          const scRes = await client.query(
            `SELECT params, household_id FROM scenarios WHERE scenario_id = $1::uuid`,
            [scenario_id]
          );
          if (scRes.rows.length === 0) return null;
          const row = scRes.rows[0];
          const r = await client.query(
            `SELECT
                household_id,
                live_income::float8 AS live_income,
                sim_income::float8 AS sim_income,
                live_baseline::float8 AS live_baseline,
                sim_baseline::float8 AS sim_baseline,
                live_emi::float8 AS live_emi,
                sim_emi::float8 AS sim_emi,
                live_reserves::float8 AS live_reserves,
                sim_reserves::float8 AS sim_reserves,
                live_surplus::float8 AS live_surplus,
                sim_surplus::float8 AS sim_surplus,
                live_runway_months::float8 AS live_runway_months,
                sim_runway_months::float8 AS sim_runway_months,
                live_dti_ratio::float8 AS live_dti_ratio,
                sim_dti_ratio::float8 AS sim_dti_ratio,
                live_rigidity_ratio::float8 AS live_rigidity_ratio,
                sim_rigidity_ratio::float8 AS sim_rigidity_ratio,
                live_tier,
                sim_tier,
                tier_changed,
                sim_tier_reasons
             FROM fn_simulate_scenario($1::uuid, $2::jsonb)`,
            [row.household_id, row.params]
          );
          return { simulation: r.rows[0], applied_params: row.params };
        }

        if (!household_id) return null;
        const r = await client.query(
          `SELECT
              household_id,
              live_income::float8 AS live_income,
              sim_income::float8 AS sim_income,
              live_baseline::float8 AS live_baseline,
              sim_baseline::float8 AS sim_baseline,
              live_emi::float8 AS live_emi,
              sim_emi::float8 AS sim_emi,
              live_reserves::float8 AS live_reserves,
              sim_reserves::float8 AS sim_reserves,
              live_surplus::float8 AS live_surplus,
              sim_surplus::float8 AS sim_surplus,
              live_runway_months::float8 AS live_runway_months,
              sim_runway_months::float8 AS sim_runway_months,
              live_dti_ratio::float8 AS live_dti_ratio,
              sim_dti_ratio::float8 AS sim_dti_ratio,
              live_rigidity_ratio::float8 AS live_rigidity_ratio,
              sim_rigidity_ratio::float8 AS sim_rigidity_ratio,
              live_tier,
              sim_tier,
              tier_changed,
              sim_tier_reasons
           FROM fn_simulate_scenario($1::uuid, $2::jsonb)`,
          [household_id, JSON.stringify(params || {})]
        );
        return { simulation: r.rows[0], applied_params: params };
      });

      if (!simRow) {
        return sendJson(res, 404, { error: "Household or scenario not found" });
      }
      return sendJson(res, 200, simRow);
    }

    // -----------------------------------------------------------------------
    // 11. GET /api/v1/coach/overview
    //     Executes under COACH RLS context: queries `view_high_risk_households`
    //     (window function DENSE_RANK) + `policy_audit_logs` + RLS verification
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/v1/coach/overview") {
      const coachContext = {
        userId: DEMO_IDS.coachUser,
        role: "COACH",
      };

      const data = await withPgClient(coachContext, async (client) => {
        const highRiskRes = await client.query(
          `SELECT
              household_id,
              household_name,
              total_monthly_income::float8 AS total_monthly_income,
              total_monthly_emi::float8 AS total_monthly_emi,
              dti_ratio::float8 AS dti_ratio,
              emergency_runway_months::float8 AS emergency_runway_months,
              current_tier,
              dti_risk_rank::int AS dti_risk_rank,
              active_debt_count::int AS active_debt_count
           FROM view_high_risk_households
           WHERE household_id = ANY($1::uuid[])
           ORDER BY dti_risk_rank ASC, emergency_runway_months ASC`,
          [Object.values(DEMO_IDS.households)]
        );
        const auditRes = await client.query(
          `SELECT
              pal.log_id,
              pal.user_id,
              u.full_name AS user_name,
              h.household_name,
              pal.attempted_action,
              pal.enforced_tier,
              pal.action_blocked,
              pal.override_reason,
              pal.logged_at
           FROM policy_audit_logs pal
           JOIN users u ON u.user_id = pal.user_id
           LEFT JOIN households h ON h.household_id = u.household_id
           WHERE u.household_id = ANY($1::uuid[])
           ORDER BY pal.logged_at DESC
           LIMIT 25`,
          [Object.values(DEMO_IDS.households)]
        );
        const allAssignedRes = await client.query(
          `SELECT
              h.household_id,
              h.household_name,
              fs.current_tier,
              fs.base_tier,
              fs.dti_ratio::float8 AS dti_ratio,
              fs.emergency_runway_months::float8 AS emergency_runway_months,
              fs.structural_surplus::float8 AS structural_surplus,
              fs.discretionary_mtd::float8 AS discretionary_mtd,
              fs.discretionary_cap::float8 AS discretionary_cap,
              fs.tier_reasons
           FROM households h
           JOIN financial_snapshots fs ON fs.household_id = h.household_id
           WHERE h.household_id = ANY($1::uuid[])
           ORDER BY
             CASE fs.current_tier
               WHEN 'FREEZE' THEN 1
               WHEN 'CRITICAL' THEN 2
               WHEN 'CAUTION' THEN 3
               WHEN 'SAFE' THEN 4
             END ASC`,
          [Object.values(DEMO_IDS.households)]
        );
        const rlsCheckRes = await client.query(
          `SELECT
              current_setting('app.current_user_id', true) AS active_rls_user_id,
              current_setting('app.current_user_role', true) AS active_rls_role`
        );

        return {
          rls_session: rlsCheckRes.rows[0],
          high_risk_cohort: highRiskRes.rows,
          assigned_households: allAssignedRes.rows,
          audit_logs: auditRes.rows,
        };
      });

      return sendJson(res, 200, data);
    }

    // -----------------------------------------------------------------------
    // 12. POST /api/v1/seed/reset
    //     Re-seeds the 4 demo households and resets MongoDB + PostgreSQL state
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/v1/seed/reset") {
      const seeded = await seedDemoData({
        existingPool: pgPool,
        existingMongoClient: mongoClient,
        silent: true,
      });
      return sendJson(res, 200, {
        status: "demo_reset_complete",
        summary: seeded.summary,
      });
    }

    // Fallback to serving static files from /public
    if (method === "GET") {
      return serveStaticFile(pathname, res);
    }

    return sendJson(res, 404, { error: `Route ${method} ${pathname} not found` });
  } catch (err) {
    console.error(`[API Error] ${method} ${pathname}:`, err);
    return sendJson(res, 500, {
      error: err.message || "Internal Server Error",
      code: err.code || "INTERNAL_ERROR",
    });
  }
}

async function startServer(port = PORT) {
  await mongoClient.connect();
  const dbName = new URL(MONGO_URI).pathname.replace(/^\//, "") || "finshield";
  mongoDb = mongoClient.db(dbName);
  await initMongoSchema(mongoDb);

  // Check if demo households exist; if not, seed automatically on first boot
  const check = await pgPool.query(
    `SELECT COUNT(*)::int AS cnt FROM households WHERE household_id = $1::uuid`,
    [DEMO_IDS.households.SAFE]
  );
  if (check.rows[0].cnt === 0) {
    console.log("[Boot] Seeding initial Phase 5 polyglot demo households...");
    await seedDemoData({
      existingPool: pgPool,
      existingMongoClient: mongoClient,
    });
  }

  const server = http.createServer(handleRequest);
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(
        `=================================================================`
      );
      console.log(
        `  FinShield Polyglot Engine Live at: http://localhost:${port}`
      );
      console.log(
        `  PostgreSQL 18 + MongoDB 8.2 + pgvector Semantic Playbooks Ready`
      );
      console.log(
        `=================================================================`
      );
      resolve({ server, pgPool, mongoClient });
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("[FATAL] Failed to start FinShield server:", err);
    process.exit(1);
  });
}

module.exports = { startServer };
