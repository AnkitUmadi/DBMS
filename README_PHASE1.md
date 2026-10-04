# FinShield — Phase 1: Postgres core

Postgres schema, snapshot triggers and the tier classifier, built and tested against
`docs/FinShield_Phase0_Spec.md`. Everything below was actually run in a sandboxed
Postgres 16 instance, not just written and assumed correct.

## Setup

```bash
createdb finshield
cp .env.example .env.local   # fill in real credentials
export DATABASE_URL=postgres://user:pass@host:5432/finshield
./db/migrate.sh
```

`db/migrate.sh` applies `db/migrations/*.sql` in order, records each in
`schema_migrations`, and skips files already applied — safe to re-run.

## What's here

| File | Contents |
|---|---|
| `db/migrations/001_types.sql` | `user_role`, `policy_tier`, `debt_strategy`, `risk_appetite` enums |
| `db/migrations/002_core_tables.sql` | All 15 tables, keys, CHECK constraints, indexes |
| `db/migrations/003_snapshot_logic.sql` | `fn_classify_tier` (pure), `fn_refresh_snapshot` (locked), all triggers |
| `db/migrations/004_alter_and_drop.sql` | ALTER/DROP demo: forecast columns, email format check, index swap |
| `db/tests/phase1_tests.sql` | 67 assertions: classifier vectors, trigger E2E, mutations, constraints |
| `db/tests/phase1_concurrency.sh` | 2 assertions requiring real parallel connections |

## Design decisions worth knowing before Phase 2

- **`fn_classify_tier` is a pure function** — numbers in, tier + reasons out, no table
  access. `fn_refresh_snapshot` reads the tables and calls it. The simulator (Phase 4)
  reuses the same function so a what-if run can never touch live data by construction.
- **Per-household locking**: `fn_refresh_snapshot` takes
  `pg_advisory_xact_lock(hashtextextended(household_id, 0))` before reading, so two
  concurrent writers serialize instead of racing. Proven in
  `phase1_concurrency.sh` — see "How I broke it" below.
- **DELETE handling**: every trigger function branches on `TG_OP` explicitly and uses
  `OLD` on delete, `NEW` on insert. The original schema's `NEW.household_id` on
  DELETE (always NULL) is exactly the bug this fixes.
- **Only `is_emergency_fund = TRUE` liquid assets count toward runway.** A household
  can hold other liquid assets that don't affect its tier.
- **A loan with `principal_remaining = 0` stops counting toward EMI/DTI.** Paying off
  a loan without deleting the row now correctly lowers DTI.
- **Ratio columns are `NUMERIC(10,2)`**, not `(5,2)`. A household with costs 20x
  income no longer overflows and rolls back the insert.
- **Runway is capped at 999**, both as a display number and to avoid a divide-by-zero
  when baseline + EMI = 0.
- **`tier_reasons TEXT[]`** on the snapshot row holds the plain-English reasons a tier
  was assigned (e.g. "DTI 52.00% is above 45%") — this is what the Explainability
  Modal in Phase 7 reads from, instead of the frontend reimplementing the logic.
- **Coach integrity is enforced at the DB level**: a `USER` role cannot be inserted
  into `coach_assignments` (SQLSTATE `FS002`), and a coach with active assignments
  cannot be demoted to `USER` (SQLSTATE `FS003`).

## How I broke it (to prove the concurrency test is real)

I built a second database from `001`, `002`, `004`, and a copy of `003` with the
`pg_advisory_xact_lock` line stripped out, then ran `phase1_concurrency.sh` against
it. Both scenarios failed exactly as expected — the burst-insert case landed on
`1000.00|1.00` instead of `8000.00|8.00` (7 of 8 concurrent writers overwrote each
other). Re-ran against the real migration: both pass. The test only means something
because it can fail, and now that's demonstrated rather than assumed.

## Test results (this session)

```
db/tests/phase1_tests.sql        67 assertions, 0 failures
db/tests/phase1_concurrency.sh    2 assertions, 0 failures
```
Run on a freshly created database, plus a second run to confirm `migrate.sh` is
idempotent (all 4 files correctly skipped on re-run).

## Known gap

`hashtextextended` collisions are theoretically possible (two different household
UUIDs hashing to the same lock key), which would over-serialize two unrelated
households rather than corrupt data — a performance issue, not a correctness one.
Not tested here; flagging it rather than hiding it.

## What Phase 2 needs from this

- `financial_snapshots.current_tier` is what the allocation gatekeeper trigger reads.
- `tier_reasons` is what `sp_evaluate_allocation_policy` returns to the modal.
- `coach_assignments` is what RLS policies will filter on for the `COACH` role.
- `discretionary_caps` and `household_discretionary_monthly` are what the Mongo sync
  (Phase 3) writes into via `fn_set_discretionary_mtd` — not built yet; Phase 3 needs
  to wrap the existing `household_discretionary_monthly` upsert in that function name,
  per the Phase 0 spec.
