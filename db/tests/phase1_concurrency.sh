#!/usr/bin/env bash
# phase1_concurrency.sh
# Proves the per-household advisory lock: concurrent writers must never leave a
# stale snapshot (the "last writer wins with old totals" race in the original design).
# Uses real committed data in separate connections, then cleans up after itself.
# Usage: DATABASE_URL=postgres://... ./db/tests/phase1_concurrency.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
P() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qtA "$@"; }

fail=0
check() {  # name, actual, expected
  if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', wanted '$3')"; fail=1; fi
}

mk_household() {  # prints "household_id user_id"
  local name="$1" h u
  h=$(P -c "INSERT INTO households (household_name) VALUES ('$name') RETURNING household_id" | head -1)
  u=$(P -c "INSERT INTO users (household_id, full_name, email, password_hash)
            VALUES ('$h', '$name', '$name@conc.example', 'x') RETURNING user_id" | head -1)
  P -c "INSERT INTO baseline_expenses (household_id, category_name, monthly_amount) VALUES ('$h','living',30000)" >/dev/null
  P -c "INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund) VALUES ('$h','ef',400000,TRUE)" >/dev/null
  echo "$h $u"
}

cleanup() {
  P -c "DELETE FROM users WHERE email LIKE '%@conc.example'" >/dev/null 2>&1 || true
  P -c "DELETE FROM households WHERE household_name LIKE 'conc-%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

# ---- Scenario 1: a slow transaction and a fast one touching the same household
read -r H1 U1 < <(mk_household conc-slow)
( P -c "BEGIN;
        INSERT INTO incomes (user_id, source_name, monthly_amount) VALUES ('$U1','salary',100000);
        SELECT pg_sleep(2);
        COMMIT;" >/dev/null ) &
sleep 0.7
P -c "INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi)
      VALUES ('$U1','bank',240000,12,20000)" >/dev/null     # blocks on the lock until the slow txn commits
wait
row=$(P -c "SELECT total_monthly_income || '|' || total_monthly_emi || '|' || dti_ratio || '|' || current_tier
              FROM financial_snapshots WHERE household_id='$H1'")
check "S1 slow income txn + concurrent loan insert: snapshot includes BOTH" "$row" "100000.00|20000.00|20.00|SAFE"

# ---- Scenario 2: 8 simultaneous loan inserts on one household
read -r H2 U2 < <(mk_household conc-burst)
P -c "INSERT INTO incomes (user_id, source_name, monthly_amount) VALUES ('$U2','salary',100000)" >/dev/null
for i in 1 2 3 4 5 6 7 8; do
  ( P -c "INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi)
          VALUES ('$U2','lender$i',12000,10,1000)" >/dev/null ) &
done
wait
row=$(P -c "SELECT total_monthly_emi || '|' || dti_ratio FROM financial_snapshots WHERE household_id='$H2'")
check "S2 8 parallel loan inserts: snapshot EMI total is 8000" "$row" "8000.00|8.00"

if [ "$fail" -eq 0 ]; then echo "--- ALL CONCURRENCY TESTS PASSED"; else echo "--- CONCURRENCY TESTS FAILED"; exit 1; fi
