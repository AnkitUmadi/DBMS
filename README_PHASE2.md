# FinShield — Phase 2: Allocation Gatekeeper, Stored Procedures & Multi-Tenant RLS

Builds the financial safety gatekeeper, debt prioritization engine, high-risk cohort analytical view, audit logging, and multi-tenant Row-Level Security (RLS) on top of the Phase 1 Postgres core.

All migrations and tests run and pass against PostgreSQL 18.

---

## What's Added in Phase 2

| File | Contents |
|---|---|
| `db/migrations/005_gatekeeper_and_allocations.sql` | `policy_audit_logs`, `asset_allocations`, Gatekeeper trigger (`FS001`), `sp_evaluate_allocation_policy`, `sp_generate_debt_plan`, `fn_get_debt_payoff_schedule`, `view_high_risk_households`, and multi-tenant RLS policies. |
| `db/tests/phase2_tests.sql` | 26 assertions verifying Gatekeeper tier enforcement (`FS001`), allocation sum constraints, manual override logging, stored procedures, analytical view ranking, and role-based RLS isolation. |

---

## Core Architectural Deliverables

### 1. Allocation Policy Gatekeeper (`trg_gatekeeper_allocation`)
- **Enforcement at Database Level (SQLSTATE `FS001`):**
  - **`CRITICAL` / `FREEZE`:** Any equity allocation > 0.00% is strictly rejected with `FS001` unless accompanied by a verified manual override reason. Surplus must be 100% routed to emergency runway or debt clearance.
  - **`CAUTION`:** Equity allocations are capped at **25.00%**. Any attempt to allocate > 25% without override triggers `FS001`.
  - **`SAFE`:** Full strategic wealth allocation is permitted (0–100%).
- **Integrity Constraints:**
  - `chk_total_allocation`: `equity_pct + debt_pct + emergency_pct = 100.00%`.
  - `chk_override_reason_required`: Overrides must have `override_reason` with length $\ge 5$ characters.

### 2. Explainability & Gatekeeper Modal Engine (`sp_evaluate_allocation_policy`)
- Evaluates active household financial snapshots alongside user risk profile (`age`, `risk_appetite`).
- Returns:
  - `action_status`: `'ALLOWED'`, `'CAPPED'`, or `'BLOCKED'`.
  - `allowed_equity_max`: Numerical upper bound (100.00, 25.00, or 0.00).
  - Recommended breakdown (`recommended_equity`, `recommended_debt`, `recommended_emergency`).
  - `tier_reasons TEXT[]`: Direct pass-through of the plain-English trigger explanations generated in Phase 1 for the frontend Explainability Modal.

### 3. Debt Payoff Engine (`sp_generate_debt_plan` & `fn_get_debt_payoff_schedule`)
- **`sp_generate_debt_plan`:** PL/pgSQL stored procedure complying with TRD Section 5.2.2.
- **`fn_get_debt_payoff_schedule`:** Queryable set-returning function calculating priority rankings and routing extra surplus directly to priority rank 1:
  - **`AVALANCHE`:** Orders by `annual_interest_rate DESC, principal_remaining ASC` (mathematically minimizes total interest paid).
  - **`SNOWBALL`:** Orders by `principal_remaining ASC, annual_interest_rate DESC` (maximizes psychological momentum).
  - Excludes paid-off loans (`principal_remaining = 0`).

### 4. High-Risk Cohort Analytical View (`view_high_risk_households`)
- Complex analytical view for Coaches/Admins:
  - Filters to `CRITICAL` or `FREEZE` tiers with `dti_ratio > 40.0%` or active freeze.
  - Computes window ranking: `DENSE_RANK() OVER (ORDER BY fs.dti_ratio DESC NULLS LAST) AS dti_risk_rank`.
  - Aggregates active liabilities count (`COUNT(l.debt_id)` for active debts).

### 5. Multi-Tenant Row-Level Security (RLS)
- Multi-tenant tenant isolation based on application session variables:
  - `app.current_user_id`: UUID of the authenticated user.
  - `app.current_user_role`: `'USER'`, `'COACH'`, or `'ADMIN'`.
- Access Control Rules:
  - **`ADMIN`:** Full access across all households and tables.
  - **`COACH`:** Access restricted strictly to households assigned in `coach_assignments`.
  - **`USER`:** Access restricted strictly to their own household.
- Maintenance & migration safety: Background workers and migration scripts bypass RLS when session variables are unset.

---

## Test Verification

Run tests against your PostgreSQL instance:
```bash
# Run Phase 1 regressions
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/phase1_tests.sql

# Run Phase 2 test suite
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/phase2_tests.sql
```

### Results
```
db/tests/phase1_tests.sql    67 assertions, 0 failures (Zero Regressions)
db/tests/phase2_tests.sql    26 assertions, 0 failures
```

---

## What Phase 3 Needs From Phase 2

1. **`discretionary_caps` & `household_discretionary_monthly`:**
   - Phase 3 MongoDB sync worker aggregates dynamic daily spends and calls `fn_set_discretionary_mtd` to update Postgres.
2. **Snapshot Cascades:**
   - Overspending in MongoDB pushes MTD discretionary spend above the cap, which recalculates `financial_snapshots` to `CAUTION` or `FREEZE`.
   - Gatekeeper (`trg_gatekeeper_allocation`) automatically detects the downgraded tier and immediately restricts subsequent equity allocations!
