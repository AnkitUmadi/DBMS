// db/tests/phase5_api_tests.js
// FinShield — Phase 5: End-to-End Full-Stack REST API & Polyglot Integration Tests
// Verifies all Phase 5 HTTP endpoints, UI hosting, Demo Seeder, Gatekeeper FS001
// Explainability Modal contract, MongoDB $jsonSchema validation (121), P2P Refund
// reconciliation, Debt Optimizer (Avalanche vs Snowball), What-If Simulator,
// and Coach RLS Portal.

const { startServer } = require("../../server");
const { DEMO_IDS } = require("../seed_demo");

const TEST_PORT = 3099;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let passCount = 0;
let failCount = 0;

function assert(condition, label, detail = "") {
  if (condition) {
    passCount++;
    console.log(`PASS [${String(passCount).padStart(2, "0")}] ${label}`);
  } else {
    failCount++;
    console.error(`FAIL [${label}] ${detail}`);
  }
}

async function reqJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function runPhase5Tests() {
  console.log("=================================================================");
  console.log("FinShield Phase 5 — Full-Stack API & Polyglot E2E Test Suite");
  console.log("=================================================================");

  const { server, pgPool, mongoClient } = await startServer(TEST_PORT);

  try {
    // 1. Reset Demo Seed via API
    const resetRes = await reqJson("/api/v1/seed/reset", { method: "POST" });
    assert(
      resetRes.status === 200 &&
        resetRes.body.status === "demo_reset_complete" &&
        resetRes.body.summary.length === 4,
      "5.1 POST /api/v1/seed/reset seeds all 4 demo households across SAFE, CAUTION, CRITICAL, FREEZE"
    );

    // 2. Health Check
    const health = await reqJson("/api/v1/health");
    assert(
      health.status === 200 &&
        health.body.postgres.connected === true &&
        health.body.mongodb.connected === true &&
        health.body.postgres.playbook_count >= 12,
      "5.2 GET /api/v1/health confirms PostgreSQL 18, MongoDB 8.2, and 12 pgvector playbooks"
    );

    // 3. Static Dashboard UI Serving
    const htmlRes = await fetch(`${BASE_URL}/`);
    const htmlText = await htmlRes.text();
    assert(
      htmlRes.status === 200 &&
        htmlText.includes("FinShield") &&
        htmlText.includes("Explainability"),
      "5.3 GET / serves the FinShield interactive dashboard HTML"
    );

    // 4. List Households across all 4 tiers
    const hhRes = await reqJson("/api/v1/households");
    const tierMap = new Map(
      hhRes.body.households.map((h) => [h.household_id, h.current_tier])
    );
    assert(
      hhRes.status === 200 &&
        tierMap.get(DEMO_IDS.households.SAFE) === "SAFE" &&
        tierMap.get(DEMO_IDS.households.CAUTION) === "CAUTION" &&
        tierMap.get(DEMO_IDS.households.CRITICAL) === "CRITICAL" &&
        tierMap.get(DEMO_IDS.households.FREEZE) === "FREEZE",
      "5.4 GET /api/v1/households returns all 4 demo households in their exact expected policy tiers"
    );

    // 5. Dashboard Payload for SAFE Household (Sharma Family)
    const safeDash = await reqJson(
      `/api/v1/dashboard/${DEMO_IDS.households.SAFE}`
    );
    assert(
      safeDash.status === 200 &&
        safeDash.body.snapshot.current_tier === "SAFE" &&
        safeDash.body.snapshot.total_monthly_income === 180000 &&
        safeDash.body.snapshot.discretionary_mtd === 18500 &&
        safeDash.body.playbooks.length === 3 &&
        safeDash.body.playbooks.every((p) => p.trigger_tier === "SAFE"),
      "5.5 GET /api/v1/dashboard/:id returns synchronized PostgreSQL snapshot, MongoDB MTD (18,500), and 3 SAFE pgvector playbooks"
    );

    // 6. Debt Payoff Optimizer: AVALANCHE vs SNOWBALL Priority Flipping on Verma Household (CAUTION)
    const avRes = await reqJson(
      `/api/v1/debt-plan/${DEMO_IDS.households.CAUTION}?strategy=AVALANCHE&surplus=5000`
    );
    const snRes = await reqJson(
      `/api/v1/debt-plan/${DEMO_IDS.households.CAUTION}?strategy=SNOWBALL&surplus=5000`
    );
    assert(
      avRes.status === 200 &&
        snRes.status === 200 &&
        avRes.body.schedule[0].annual_rate === 24.0 &&
        avRes.body.schedule[0].extra_payment_alloc === 5000 &&
        snRes.body.schedule[0].principal_remaining === 32000 &&
        snRes.body.schedule[0].extra_payment_alloc === 5000 &&
        avRes.body.schedule[0].debt_id !== snRes.body.schedule[0].debt_id,
      "5.6 GET /api/v1/debt-plan/:id flips Priority #1 between 24% APR Loan (AVALANCHE) and ₹32k Credit Card (SNOWBALL)"
    );

    // 7. 90-Day Cashflow Forecaster: SAFE vs FREEZE Deficit Detection
    const fcSafe = await reqJson(
      `/api/v1/forecast/${DEMO_IDS.households.SAFE}?days=90`
    );
    const fcFreeze = await reqJson(
      `/api/v1/forecast/${DEMO_IDS.households.FREEZE}?days=90`
    );
    assert(
      fcSafe.status === 200 &&
        fcSafe.body.series.length === 90 &&
        fcSafe.body.deficit_day_count === 0 &&
        fcFreeze.status === 200 &&
        fcFreeze.body.deficit_day_count > 0,
      "5.7 GET /api/v1/forecast/:id projects 90-day trajectory with 0 deficit days for SAFE and flags deficit days for FREEZE"
    );

    // 8. MongoDB $jsonSchema Validation Rejection (MongoError 121 on negative amount)
    const badExp = await reqJson("/api/v1/expenses", {
      method: "POST",
      body: JSON.stringify({
        household_id: DEMO_IDS.households.SAFE,
        user_id: DEMO_IDS.users.sharmaPrimary,
        amount: -250,
        category: "Invalid Negative Spend",
        is_discretionary: true,
      }),
    });
    assert(
      badExp.status === 422 && badExp.body.code === 121,
      "5.8 POST /api/v1/expenses rejects negative spend with HTTP 422 & MongoError 121 ($jsonSchema validator)"
    );

    // 9. Live Polyglot Spend Escalation: Log ₹45,000 discretionary spend on SAFE household -> Escalates to CAUTION
    const spikeExp = await reqJson("/api/v1/expenses", {
      method: "POST",
      body: JSON.stringify({
        expense_id: "phase5-test-spike-01",
        household_id: DEMO_IDS.households.SAFE,
        user_id: DEMO_IDS.users.sharmaPrimary,
        amount: 45000,
        category: "Impulse Luxury Spend",
        is_discretionary: true,
      }),
    });
    assert(
      spikeExp.status === 201 &&
        spikeExp.body.snapshot.discretionary_mtd === 63500 &&
        spikeExp.body.snapshot.base_tier === "SAFE" &&
        spikeExp.body.snapshot.current_tier === "CAUTION",
      "5.9 POST /api/v1/expenses logs ₹45,000 in MongoDB, aggregates ₹63,500 MTD (> ₹60,000 cap), and escalates PostgreSQL tier SAFE -> CAUTION"
    );

    // 10. Live P2P Split / Refund Reconciliation: Refund the ₹45,000 expense -> De-escalates CAUTION -> SAFE
    const refundRes = await reqJson("/api/v1/expenses/refund", {
      method: "POST",
      body: JSON.stringify({
        expense_id: "phase5-test-spike-01",
        refund_amount: "FULL",
      }),
    });
    assert(
      refundRes.status === 200 &&
        refundRes.body.snapshot.discretionary_mtd === 18500 &&
        refundRes.body.snapshot.current_tier === "SAFE",
      "5.10 POST /api/v1/expenses/refund reconciles refund in MongoDB and automatically restores PostgreSQL tier CAUTION -> SAFE"
    );

    // 11. Gatekeeper FS001 Interception & Explainability Modal Contract on CRITICAL Household
    const blockedAlloc = await reqJson("/api/v1/allocations", {
      method: "POST",
      body: JSON.stringify({
        household_id: DEMO_IDS.households.CRITICAL,
        user_id: DEMO_IDS.users.patelPrimary,
        equity_pct: 60,
        debt_pct: 20,
        emergency_pct: 20,
        is_override: false,
      }),
    });
    assert(
      blockedAlloc.status === 403 &&
        blockedAlloc.body.code === "FS001" &&
        blockedAlloc.body.explainability &&
        blockedAlloc.body.explainability.recommendation.allowed_equity_max === 0 &&
        Array.isArray(blockedAlloc.body.explainability.why_it_happened) &&
        blockedAlloc.body.explainability.why_it_happened.length > 0,
      "5.11 POST /api/v1/allocations intercepts 60% equity on CRITICAL household with SQLSTATE FS001 and returns Explainability Modal payload"
    );

    // 12. Audited Policy Override Workflow (is_override: true + justification reason)
    const overrideAlloc = await reqJson("/api/v1/allocations", {
      method: "POST",
      body: JSON.stringify({
        household_id: DEMO_IDS.households.CAUTION,
        user_id: DEMO_IDS.users.vermaPrimary,
        equity_pct: 50,
        debt_pct: 25,
        emergency_pct: 25,
        is_override: true,
        override_reason: "Employer 100% matched ESOP contribution window",
      }),
    });
    assert(
      overrideAlloc.status === 201 &&
        overrideAlloc.body.status === "override_accepted_and_audited" &&
        overrideAlloc.body.allocation.is_override === true,
      "5.12 POST /api/v1/allocations permits explicit override with justification and logs to policy_audit_logs"
    );

    // 13. Non-Destructive What-If Scenario Simulator (SAFE -> CRITICAL & SAFE -> FREEZE)
    const simCritRes = await reqJson("/api/v1/simulate", {
      method: "POST",
      body: JSON.stringify({
        household_id: DEMO_IDS.households.SAFE,
        params: {
          reserve_delta: -300000, // Drops reserves from 4.2L to 1.2L (2.00 months runway -> CRITICAL)
        },
      }),
    });
    const simFreezeRes = await reqJson("/api/v1/simulate", {
      method: "POST",
      body: JSON.stringify({
        household_id: DEMO_IDS.households.SAFE,
        params: {
          drop_primary_earner: true, // Drops income from 1.8L to 60k (0 surplus vs 18.5k MTD spend -> FREEZE)
        },
      }),
    });
    const checkAfterSim = await reqJson(
      `/api/v1/dashboard/${DEMO_IDS.households.SAFE}`
    );
    assert(
      simCritRes.status === 200 &&
        simCritRes.body.simulation.live_tier === "SAFE" &&
        simCritRes.body.simulation.sim_tier === "CRITICAL" &&
        simFreezeRes.status === 200 &&
        simFreezeRes.body.simulation.sim_tier === "FREEZE" &&
        checkAfterSim.body.snapshot.current_tier === "SAFE" &&
        checkAfterSim.body.snapshot.total_liquid_reserves === 420000,
      "5.13 POST /api/v1/simulate computes SAFE -> CRITICAL & SAFE -> FREEZE shock trajectories without mutating live PostgreSQL data"
    );

    // 14. Coach & RLS Overview Endpoint (`view_high_risk_households` + `policy_audit_logs`)
    const coachRes = await reqJson("/api/v1/coach/overview");
    assert(
      coachRes.status === 200 &&
        coachRes.body.rls_session.active_rls_role === "COACH" &&
        coachRes.body.high_risk_cohort.length === 2 &&
        coachRes.body.high_risk_cohort[0].dti_risk_rank === 1 &&
        coachRes.body.audit_logs.length >= 4,
      "5.14 GET /api/v1/coach/overview executes under COACH RLS context and returns ranked high-risk cohort + audit logs"
    );

    // Restore clean initial demo state after tests finish
    await reqJson("/api/v1/seed/reset", { method: "POST" });

    console.log("-----------------------------------------------------------------");
    console.log(
      `Phase 5 Full-Stack API & E2E Tests Summary: ${passCount} passed, ${failCount} failed`
    );
    console.log("=================================================================");

    if (failCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    server.close();
    await pgPool.end();
    await mongoClient.close();
  }
}

runPhase5Tests().catch((err) => {
  console.error("[FATAL] Phase 5 test runner failed:", err);
  process.exit(1);
});
