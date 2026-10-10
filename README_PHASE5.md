# FinShield — Phase 5: Next.js App Router Full-Stack Web Application & Polyglot Engine

## Overview
Phase 5 completes the **FinShield** polyglot architecture per **TRD Section 2.1 & 2.2** using **Next.js (App Router)** with React Server Components, Client Components, and Next.js Route Handlers (`/api/v1/*`) backed by connection-pooled **PostgreSQL 18.6** (Relational Source of Truth, Triggers, Stored Procedures, RLS, and `pgvector` Playbooks) and **MongoDB 8.2** (Dynamic Spend Engine, `$jsonSchema` Validator, and Aggregation Pipelines).

---

## 1. Next.js App Router Architecture & File Map

| File | Responsibility |
| :--- | :--- |
| [`src/app/layout.jsx`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/layout.jsx) | **Next.js Root Layout (Server Component):** Configures `Inter` and `JetBrains Mono` typography and global styling tokens. |
| [`src/app/page.jsx`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/page.jsx) | **Next.js Dashboard Page (Server Component):** Performs server-side data fetching from PostgreSQL 18 and MongoDB 8.2 pools and hydrates the interactive client dashboard. |
| [`src/components/FinShieldDashboardClient.jsx`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/components/FinShieldDashboardClient.jsx) | **Next.js Interactive Dashboard (`"use client"` Component):** Implements `FinShield_UI_UX_Specification.pdf` Sections 4.1 & 4.2 (4 KPI cards, 30/60/90D Cashflow Line Chart, Avalanche/Snowball Debt Optimizer, Asset Allocation Donut + `FS001` Explainability Modal, `pgvector` Playbooks, MongoDB Spend Logger, What-If Simulator, and Coach RLS View). |
| [`src/lib/db.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/lib/db.js) | **Server-Side Connection Pooling Layer:** Manages singleton `pg.Pool` and `MongoClient` connections using `.env.local` credentials and RLS session context (`SET LOCAL app.current_user_id / app.current_user_role`). |
| [`src/app/api/v1/health/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/health/route.js) | `GET /api/v1/health` — Verifies PostgreSQL 18, MongoDB 8.2, and `pgvector` playbooks. |
| [`src/app/api/v1/households/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/households/route.js) | `GET /api/v1/households` — Lists demo households across `SAFE`, `CAUTION`, `CRITICAL`, and `FREEZE`. |
| [`src/app/api/v1/dashboard/[householdId]/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/dashboard/%5BhouseholdId%5D/route.js) | `GET /api/v1/dashboard/:householdId` — Full polyglot state (PostgreSQL snapshot + MongoDB MTD aggregation + `pgvector` top-3 cosine similarity playbooks). |
| [`src/app/api/v1/forecast/[householdId]/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/forecast/%5BhouseholdId%5D/route.js) | `GET /api/v1/forecast/:householdId` — Executes `fn_forecast_cashflow_90d` and flags balance deficit dates. |
| [`src/app/api/v1/debt-plan/[householdId]/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/debt-plan/%5BhouseholdId%5D/route.js) | `GET /api/v1/debt-plan/:householdId` — Calls `sp_generate_debt_plan` and `fn_get_debt_payoff_schedule` for `AVALANCHE` vs `SNOWBALL`. |
| [`src/app/api/v1/expenses/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/expenses/route.js) | `POST /api/v1/expenses` — Validates against MongoDB `$jsonSchema` (`MongoError 121`), runs `$match -> $group -> $sum`, and syncs to PostgreSQL via `fn_set_discretionary_mtd`. |
| [`src/app/api/v1/expenses/refund/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/expenses/refund/route.js) | `POST /api/v1/expenses/refund` — Reconciles P2P bill splits and merchant refunds in MongoDB and re-evaluates PostgreSQL risk tier. |
| [`src/app/api/v1/allocations/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/allocations/route.js) | `POST /api/v1/allocations` — Intercepts restricted allocations via `trg_gatekeeper_allocation` (`SQLSTATE FS001`), logs to `policy_audit_logs`, and returns the Explainability Modal payload. |
| [`src/app/api/v1/simulate/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/simulate/route.js) | `POST /api/v1/simulate` — Executes non-destructive `STABLE` function `fn_simulate_scenario`. |
| [`src/app/api/v1/coach/overview/route.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/src/app/api/v1/coach/overview/route.js) | `GET /api/v1/coach/overview` — Queries `view_high_risk_households` (`DENSE_RANK()`) and `policy_audit_logs` under `COACH` RLS context. |
| [`db/seed_demo.js`](file:///C:/Users/Ankit%20Umadi/Downloads/finshield_phase1/finshield_phase1/db/seed_demo.js) | Deterministic polyglot seeder for all 4 demo households (`SAFE`, `CAUTION`, `CRITICAL`, `FREEZE`). |

---

## 2. Running the Next.js Application & Automated Test Suite

### Start the Next.js Development Server
```powershell
npm run dev
# Open http://localhost:3000 in your browser
```

### Re-seed Demo Data at Any Time
```powershell
npm run seed
# Or click the "Reset Demo" button in the top-right header of the Next.js UI
```

### Run All 165 Automated Assertions (Phases 1–5)
```powershell
powershell -ExecutionPolicy Bypass -File db/tests/run_tests.ps1
```
