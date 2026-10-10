# FinShield — Phase 3: MongoDB Dynamic Spend Engine & PostgreSQL MTD Sync Bridge

Implements the polyglot document-store layer (MongoDB 8+) for high-velocity daily spend logging, `$jsonSchema` validation, aggregation pipelines (`$match` $\rightarrow$ `$group` $\rightarrow$ `$sum`), and authoritative Month-To-Date (MTD) synchronisation into PostgreSQL (`fn_set_discretionary_mtd`).

All migrations and end-to-end polyglot tests run and pass against **MongoDB 8.2** and **PostgreSQL 18.6**.

---

## What's Added in Phase 3

| File | Contents |
|---|---|
| `db/migrations/006_mongo_sync_bridge.sql` | `fn_set_discretionary_mtd`, `fn_set_discretionary_cap_override`, and multi-tenant RLS policies on `household_discretionary_monthly` & `discretionary_caps`. |
| `db/mongo/init_mongo.js` | Initialises MongoDB `daily_expenses` collection with TRD Section 5.3 `$jsonSchema` validator (`validationLevel: "strict"`) and compound indexes. |
| `db/mongo/spend_sync_service.js` | Polyglot spend logging (`logDailyExpenseAndSync`), refund/deletion sync (`deleteDailyExpenseAndSync`), MTD aggregation pipeline (`computeHouseholdDiscretionaryMtd`), and category rollup (`computeCategoryBreakdown`). |
| `db/tests/phase3_tests.sql` | 17 PostgreSQL assertions verifying `fn_set_discretionary_mtd`, date normalisation, idempotent upserts, cap overrides, Gatekeeper `FS001` cascade, and RLS isolation. |
| `db/tests/phase3_polyglot_tests.js` | 19 live MongoDB 8 + PostgreSQL 18 assertions verifying `$jsonSchema` enforcement, unique webhook deduplication, `is_discretionary` reconciliation filtering, and real-time cross-DB tier escalation (`SAFE` $\rightarrow$ `CAUTION` $\rightarrow$ `FREEZE`). |

---

## Core Architectural Deliverables

### 1. MongoDB Collection & Strict `$jsonSchema` Validation (`daily_expenses`)
- **Enforced at MongoDB Engine Level (`MongoError 121`):**
  - Required fields: `expense_id`, `household_id`, `user_id`, `amount`, `category`, `timestamp`.
  - `amount`: Numeric BSON type (`double`/`int`/`long`/`decimal`) with `minimum: 0` (strictly rejects negative values or string numbers).
  - `is_discretionary`: Boolean flag distinguishing variable daily spending (`true`) from reconciled baseline/EMI auto-debits (`false`).
  - `merchant_metadata`: Optional nested object with `name`, `location`, and typed `tags: string[]`.
- **Production Indexes:**
  - `idx_expense_id_uq` (`{ expense_id: 1 }`, unique): Guarantees idempotent webhook/transaction ingestion (`MongoError 11000` on duplicate `expense_id`).
  - `idx_household_mtd_agg` (`{ household_id: 1, is_discretionary: 1, timestamp: -1 }`): Compound index covering the MTD aggregation pipeline `$match` stage.
  - `idx_user_timestamp` (`{ user_id: 1, timestamp: -1 }`): Chronological per-user spend queries.

### 2. Aggregation Pipeline & Transaction Reconciliation
- **MTD Discretionary Rollup (`computeHouseholdDiscretionaryMtd`):**
  - Filters strictly by `household_id`, `is_discretionary: true`, and UTC month boundaries `[monthStart, nextMonthStart)`.
  - Reconciled auto-debits (e.g. NACH loan EMIs or rent logged with `is_discretionary: false`) are preserved in MongoDB for audit/history but **never** penalise the household's discretionary surplus.
- **Category Breakdown Pipeline (`computeCategoryBreakdown`):**
  - Groups monthly transactions by `{ category, is_discretionary }`, rounds totals to 2 decimal places, and sorts descending by spend volume.

### 3. Idempotent PostgreSQL Sync Bridge (`fn_set_discretionary_mtd`)
- **Absolute Totals, Never Deltas:**
  - Every sync writes the authoritative MTD sum computed by MongoDB into `household_discretionary_monthly (household_id, month_start)`.
  - Re-running the sync worker $N$ times produces the exact same PostgreSQL state without double-counting.
- **Real-Time Flow B $\rightarrow$ Flow C Cascade:**
  1. User logs a daily spend in MongoDB via `logDailyExpenseAndSync`.
  2. MongoDB aggregates the new MTD total and calls `fn_set_discretionary_mtd` in PostgreSQL.
  3. Trigger `trg_snap_disc_monthly` invokes `fn_refresh_snapshot` (protected by per-household advisory lock).
  4. If `discretionary_mtd > discretionary_cap`, tier escalates one level (`SAFE` $\rightarrow$ `CAUTION`); if `discretionary_mtd > structural_surplus`, tier immediately drops to `FREEZE`.
  5. Subsequent attempts to allocate risky equity in `asset_allocations` are immediately blocked by Gatekeeper trigger `trg_gatekeeper_allocation` (`SQLSTATE FS001`).

---

## Running Phase 3

```powershell
# 1. Apply PostgreSQL migration 006
powershell -ExecutionPolicy Bypass -File ./db/migrate.ps1

# 2. Initialise MongoDB schema validator and indexes
npm run mongo:init

# 3. Run the complete test suite (Phase 1 + Phase 2 + Phase 3 SQL + Phase 3 Polyglot)
powershell -ExecutionPolicy Bypass -File ./db/tests/run_tests.ps1
```

### Test Results
```text
db/tests/phase1_tests.sql           67 assertions, 0 failures
db/tests/phase2_tests.sql           26 assertions, 0 failures
db/tests/phase3_tests.sql           17 assertions, 0 failures
db/tests/phase3_polyglot_tests.js   19 assertions, 0 failures
-------------------------------------------------------------
Total                              129 assertions, 0 failures
```
