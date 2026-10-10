# FinShield — Phase 5: Full-Stack Web Application, REST API & Interactive Dashboard

## Overview
Phase 5 completes the **FinShield** polyglot architecture by connecting **PostgreSQL 18.6** (Relational Source of Truth, Triggers, Stored Procedures, RLS, and `pgvector` Playbooks) and **MongoDB 8.2** (Dynamic Spend Engine, `$jsonSchema` Validator, and Aggregation Pipelines) to an interactive Command Dashboard & Financial Coach Risk Portal.

---

## 1. Architecture & Files Added in Phase 5

| File | Responsibility |
| :--- | :--- |
| [`db/seed_demo.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/db/seed_demo.js) | Idempotent polyglot seeder creating 4 representative households across all 4 tiers (`SAFE`, `CAUTION`, `CRITICAL`, `FREEZE`), a `COACH` account with `coach_assignments`, multi-loan portfolios, saved scenarios, and synchronized MongoDB `daily_expenses`. |
| [`server.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/server.js) | Full-stack Node.js HTTP & REST API server (`/api/v1/*`) orchestrating PostgreSQL transactions, RLS session variables (`app.current_user_id`, `app.current_user_role`), Gatekeeper `FS001` interception, and MongoDB aggregation pipelines. |
| [`public/index.html`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/public/index.html) | FinShield Dashboard & Coach Portal UI built to `FinShield_UI_UX_Specification.pdf` (Deep Slate `#0F172A`, Indigo `#6366F1`, semantic tier tokens, Chart.js trajectories, and the 4-Pillar Explainability Modal). |
| [`public/app.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/public/app.js) | Frontend controller managing real-time state updates, Chart.js rendering, MongoDB transaction logging, P2P split/refund reconciliation, and What-If shock simulations. |
| [`db/tests/phase5_api_tests.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/db/tests/phase5_api_tests.js) | 14 end-to-end HTTP API & polyglot integration assertions verifying the complete stack. |

---

## 2. Seeded Demo Cohorts (All 4 Policy Tiers)

1. **Sharma Family (`SAFE` Tier)** — Dual-earner (`₹1,80,000/mo`), Baseline `₹45,000`, EMI `₹15,000` (**DTI 8.33%**), Liquid Reserves `₹4,20,000` (**Runway 7.00m**), MongoDB MTD Spend `₹18,500` / Cap `₹60,000`.
2. **Verma Household (`CAUTION` Tier)** — Mid-career (`₹1,10,000/mo`), Baseline `₹33,500`, 3 Active Debts totaling `₹38,500/mo` EMI (**DTI 35.00%**), Liquid Reserves `₹3,24,000` (**Runway 4.50m**). Crafted so **Avalanche** ranks the `24% APR Personal Loan` #1 while **Snowball** ranks the `₹32,000 Credit Card` #1.
3. **Patel Household (`CRITICAL` Tier)** — High debt burden (`₹95,000/mo`), Baseline `₹30,000`, 3 Active Debts totaling `₹47,500/mo` EMI (**DTI 50.00% > 45%**), Liquid Reserves `₹1,40,000` (**Runway 1.81m < 3.0m**). Equity allocations are strictly locked at `0%` by `FS001`.
4. **Nair Household (`FREEZE` Tier)** — Cashflow deficit (`₹65,000/mo` income vs `₹42,000` baseline + `₹28,000` EMI = **-₹5,000/mo structural deficit**), Liquid Reserves `₹18,000` (**Runway 0.26m < 1.0m**).

---

## 3. Running the Application & Test Suite

### Start the Full-Stack Server
```powershell
npm start
# Open http://localhost:3000 in your browser
```

### Re-seed Demo Data at Any Time
```powershell
npm run seed
# Or click the "Reset Demo" button in the top-right header of the web UI
```

### Run All 165 Automated Assertions (Phases 1–5)
```powershell
powershell -ExecutionPolicy Bypass -File db/tests/run_tests.ps1
```
- **Phase 1 (Core Schema & Snapshot Triggers):** 67 assertions PASS
- **Phase 2 (Gatekeeper `FS001`, Debt Engine, Views & RLS):** 26 assertions PASS
- **Phase 3 (MongoDB `$jsonSchema`, Aggregation & Sync Bridge):** 37 assertions PASS (17 SQL + 20 Polyglot)
- **Phase 4 (`pgvector` Playbooks, What-If Simulator & 90d Forecaster):** 21 assertions PASS
- **Phase 5 (Full-Stack REST API & Polyglot E2E):** 14 assertions PASS
- **Total:** **165 / 165 Assertions Passing (0 Failures)**

---

## 4. Examiner / Viva Live Demo Walkthrough (5-Minute Script)

1. **Show Deterministic Tier Classification:**
   - Use the top **Household Switcher** to cycle through `Sharma (SAFE)`, `Verma (CAUTION)`, `Patel (CRITICAL)`, and `Nair (FREEZE)`. Point out how the 4 KPI cards, 90-day cashflow chart, and `pgvector` playbooks adapt immediately.
2. **Demonstrate Polyglot MongoDB &rarr; PostgreSQL Tier Escalation & Refund De-escalation:**
   - Select **Sharma Family (`SAFE`)**.
   - Click **`⚡ Simulate Impulse Overspend (+₹45,000)`**.
   - Watch MongoDB aggregate `₹63,500` MTD spend (exceeding the `₹60,000` 50% surplus cap) and watch the PostgreSQL trigger automatically escalate the household from **`SAFE` &rarr; `CAUTION`**!
   - In the MongoDB transaction table, click **`Refund`** (or **`Split 50%`**) on the `₹45,000` Apple Store transaction — watch the tier immediately recover back to **`SAFE`**.
   - Click **`Test MongoError 121 (-₹500 Invalid)`** to show MongoDB's `$jsonSchema` validator rejecting negative spend at the database layer.
3. **Demonstrate Database Gatekeeper (`SQLSTATE FS001`) & Explainability Modal:**
   - Switch to **Patel Household (`CRITICAL`)** or **Verma Household (`CAUTION`)**.
   - Click **`Test 70% Equity Block`** in the Asset Allocation panel.
   - The PostgreSQL `BEFORE INSERT` trigger `trg_gatekeeper_allocation` raises `SQLSTATE FS001`, opening the **4-Pillar Explainability Modal** showing *What happened*, *Why it happened (`tier_reasons`)*, *Data used*, and *Next Action*.
   - Click **`✓ Accept Safety Recommendation`** or test **`Override Policy (Requires Reason Log)`**.
4. **Demonstrate Debt Optimizer (`AVALANCHE` vs `SNOWBALL`):**
   - On **Verma Household (`CAUTION`)**, toggle between **`AVALANCHE (APR)`** and **`SNOWBALL (Bal)`** to show `sp_generate_debt_plan` / `fn_get_debt_payoff_schedule` flipping Priority #1 between the 24% APR loan and the ₹32,000 credit card.
5. **Demonstrate Multi-Tenant RLS Coach View (`view_high_risk_households`):**
   - Click **`Coach & RLS Audit`** in the top-right header to show `SET LOCAL app.current_user_role = 'COACH'`, the `DENSE_RANK()` high-risk household cohort view, and the immutable `policy_audit_logs` ledger.
