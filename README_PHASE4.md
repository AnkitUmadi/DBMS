# FinShield — Phase 4: pgvector Semantic Recovery Playbooks, Scenario Simulator & 90-Day Forecaster

Implements the contextual semantic guidance engine (`recovery_playbooks` + 384-dimensional vector embeddings + `<=>` cosine distance search), the non-destructive What-If Scenario Simulator (`fn_simulate_scenario` & `fn_run_saved_scenario`), and the 30/60/90-Day Cashflow Trajectory Forecaster (`fn_forecast_cashflow_90d`).

All migrations and tests run and pass against **PostgreSQL 18.6** and **MongoDB 8.2**.

---

## What's Added in Phase 4

| File | Contents |
|---|---|
| `db/migrations/007_vector_playbooks_and_simulator.sql` | `vector` extension / pure-SQL 384-dim compatibility layer & `<=>` cosine distance operator, `recovery_playbooks` table (seeded with 12 playbooks across all 4 tiers), `fn_match_recovery_playbooks`, `fn_get_playbooks_for_household`, `fn_simulate_scenario`, `fn_run_saved_scenario`, `fn_forecast_cashflow_90d`, and RLS policies. |
| `db/tests/phase4_tests.sql` | 21 assertions verifying 384-dim vector constraints, `<=>` cosine similarity ranking, hard tier filtering, non-destructive stress simulations (job loss, rent hike, medical reserve shock), 90-day deficit detection, loan tenure expiration, and RLS isolation. |

---

## Core Architectural Deliverables

### 1. Contextual Recovery Playbooks & Cosine Similarity (`pgvector` / `<=>`)
- **Hard Policy Filter Before Vector Ranking (TRD Section 5.4):**
  ```sql
  SELECT
      playbook_id, title, content_text,
      1 - (embedding <=> $1::vector) AS similarity_score
  FROM recovery_playbooks
  WHERE trigger_tier = $2::policy_tier
  ORDER BY embedding <=> $1::vector
  LIMIT 3;
  ```
  - Vector search **never** makes policy decisions or crosses tier boundaries. A household in `CRITICAL` tier only searches `CRITICAL` playbooks.
- **Automated Household Context Vector (`fn_get_playbooks_for_household`):**
  - Maps the household's live stress signals (DTI > 45%, low runway, discretionary overspend, cashflow deficit) into a normalised 384-dimensional query vector and retrieves the top 3 tailored recovery playbooks.
- **12 Curated Playbooks Seeded:**
  - 3 per tier (`FREEZE`, `CRITICAL`, `CAUTION`, `SAFE`) with structured `action_steps TEXT[]`.

### 2. Non-Destructive What-If Scenario Simulator (`fn_simulate_scenario`)
- **Guaranteed Read-Only (`STABLE`):**
  - Reuses the pure `fn_classify_tier` function from Phase 1 without writing a single byte to live tables.
- **Supported Stress Parameters (`p_params JSONB`):**
  - `drop_primary_earner`: Simulates losing the primary earner's salary in a dual-income household.
  - `baseline_pct_change` / `baseline_delta`: Simulates rent hikes or inflation shocks (e.g. `{"baseline_pct_change": 15}`).
  - `income_pct_change` / `income_delta`: Simulates pay cuts or bonuses.
  - `emi_delta`: Simulates taking on a new loan EMI or missed-payment penalty.
  - `reserve_delta`: Simulates sudden emergency cash drain (e.g. `{"reserve_delta": -250000}` hospital bill).
  - `simulated_disc_mtd`: Tests how discretionary spending levels affect the household's tier.

### 3. 30/60/90-Day Cashflow Trajectory Forecaster (`fn_forecast_cashflow_90d`)
- Projects daily balances across a 90-day horizon using the schedule columns introduced in Migration 004:
  - `incomes.pay_day_of_month` (default day 1)
  - `baseline_expenses.due_day_of_month` (default day 5)
  - `liabilities.emi_due_day` (default day 10) & `remaining_tenure_months`
- Automatically stops charging EMIs once a loan's `remaining_tenure_months` elapses within the forecast window.
- Flags exact calendar dates where `projected_balance < 0` (`is_deficit = TRUE`) for the dashboard projection chart.

---

## Full Suite Test Results

Run the complete test suite across all 4 phases:
```powershell
powershell -ExecutionPolicy Bypass -File ./db/tests/run_tests.ps1
```

```text
db/tests/phase1_tests.sql           67 assertions, 0 failures
db/tests/phase2_tests.sql           26 assertions, 0 failures
db/tests/phase3_tests.sql           17 assertions, 0 failures
db/tests/phase3_polyglot_tests.js   20 assertions, 0 failures
db/tests/phase4_tests.sql           21 assertions, 0 failures
-------------------------------------------------------------
Total                              151 assertions, 0 failures
```
