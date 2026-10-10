-- phase3_tests.sql
-- FinShield Phase 3 SQL Test Suite: MongoDB -> Postgres Sync Bridge, Cap Overrides,
-- Snapshot Cascades, Gatekeeper FS001 Integration, and RLS on Discretionary Tables.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/phase3_tests.sql
-- Runs inside a single transaction and rolls back at the end. Zero side-effects.

\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;
BEGIN;

------------------------------------------------------------------------
-- Test helpers (live in pg_temp, vanish with the session)
------------------------------------------------------------------------
CREATE FUNCTION pg_temp.ok(p_name TEXT, p_cond BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF p_cond IS TRUE THEN
        RAISE NOTICE 'PASS  %', p_name;
    ELSE
        RAISE EXCEPTION 'FAIL  %', p_name;
    END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(p_name TEXT, p_sql TEXT, p_state TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = p_state THEN
            RAISE NOTICE 'PASS  % (SQLSTATE %)', p_name, SQLSTATE;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL  % (got SQLSTATE %, wanted %): %', p_name, SQLSTATE, p_state, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL  % (no error raised, wanted %)', p_name, p_state;
END $$;

CREATE FUNCTION pg_temp.mk_hh(p_name TEXT, p_income NUMERIC, p_baseline NUMERIC,
                              p_emi NUMERIC, p_reserves NUMERIC) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE h UUID; u UUID;
BEGIN
    INSERT INTO households (household_name) VALUES (p_name) RETURNING household_id INTO h;
    INSERT INTO users (household_id, full_name, email, password_hash)
        VALUES (h, p_name || ' user', lower(p_name) || '@test.example', 'x') RETURNING user_id INTO u;
    IF p_income   > 0 THEN INSERT INTO incomes (user_id, source_name, monthly_amount)
                                VALUES (u, 'salary', p_income); END IF;
    IF p_baseline > 0 THEN INSERT INTO baseline_expenses (household_id, category_name, monthly_amount)
                                VALUES (h, 'living', p_baseline); END IF;
    IF p_emi      > 0 THEN INSERT INTO liabilities (user_id, lender_name, principal_remaining,
                                                    annual_interest_rate, monthly_emi)
                                VALUES (u, 'bank', p_emi * 12, 12, p_emi); END IF;
    IF p_reserves > 0 THEN INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund)
                                VALUES (h, 'emergency', p_reserves, TRUE); END IF;
    RETURN h;
END $$;

CREATE FUNCTION pg_temp.primary_user_of(h UUID) RETURNS UUID LANGUAGE sql AS $$
    SELECT user_id FROM users WHERE household_id = h ORDER BY created_at ASC LIMIT 1;
$$;

------------------------------------------------------------------------
-- T1: fn_set_discretionary_mtd Upsert, Idempotency & Date Normalisation
------------------------------------------------------------------------
\echo '--- T1: fn_set_discretionary_mtd Upsert, Idempotency & Date Normalisation'
DO $$
DECLARE
    h   UUID;
    res RECORD;
    m   DATE := date_trunc('month', CURRENT_DATE)::DATE;
BEGIN
    -- Income 100k, Baseline 30k, EMI 20k, Reserves 400k -> Surplus = 50k, Default Cap = 25k, Tier = SAFE
    h := pg_temp.mk_hh('P3SyncHH', 100000, 30000, 20000, 400000);

    -- 1. Sync MTD spend below cap (12,000 <= 25,000) -> remains SAFE
    SELECT * INTO res FROM fn_set_discretionary_mtd(h, 12000.00);
    PERFORM pg_temp.ok('T1.1 Sync 12,000 <= 25,000 cap keeps household SAFE',
        res.discretionary_mtd = 12000.00
        AND res.discretionary_cap = 25000.00
        AND res.current_tier = 'SAFE');

    -- 2. Idempotency: Calling with mid-month date normalises to 1st of month and overwrites (not adds!)
    SELECT * INTO res FROM fn_set_discretionary_mtd(h, 12000.00, (m + INTERVAL '14 days')::DATE);
    PERFORM pg_temp.ok('T1.2 Mid-month date normalises to 1st and upserts idempotently',
        res.month_start = m
        AND res.discretionary_mtd = 12000.00
        AND (SELECT COUNT(*) FROM household_discretionary_monthly WHERE household_id = h) = 1);

    -- 3. Escalate past discretionary cap (28,000 > 25,000) -> SAFE escalates to CAUTION
    SELECT * INTO res FROM fn_set_discretionary_mtd(h, 28000.00);
    PERFORM pg_temp.ok('T1.3 Spend 28,000 > 25,000 cap escalates SAFE -> CAUTION',
        res.base_tier = 'SAFE'
        AND res.current_tier = 'CAUTION'
        AND array_to_string(res.tier_reasons, ' | ') LIKE '%exceeds cap%');

    -- 4. Escalate past structural surplus (52,000 > 50,000) -> FREEZE
    SELECT * INTO res FROM fn_set_discretionary_mtd(h, 52000.00);
    PERFORM pg_temp.ok('T1.4 Spend 52,000 > 50,000 surplus triggers immediate FREEZE',
        res.current_tier = 'FREEZE'
        AND array_to_string(res.tier_reasons, ' | ') LIKE '%exceeds monthly surplus%');

    -- 5. Refund / correction back down to 18,000 -> recovers to SAFE
    SELECT * INTO res FROM fn_set_discretionary_mtd(h, 18000.00);
    PERFORM pg_temp.ok('T1.5 Refund/lowering spend to 18,000 restores SAFE tier',
        res.discretionary_mtd = 18000.00 AND res.current_tier = 'SAFE');

    -- 6. Prior month sync does NOT pollute current month snapshot
    SELECT * INTO res FROM fn_set_discretionary_mtd(h, 95000.00, (m - INTERVAL '1 month')::DATE);
    PERFORM pg_temp.ok('T1.6 Historical month sync stored separately without altering current MTD',
        res.month_start = (m - INTERVAL '1 month')::DATE
        AND res.discretionary_mtd = 18000.00
        AND res.current_tier = 'SAFE'
        AND (SELECT COUNT(*) FROM household_discretionary_monthly WHERE household_id = h) = 2);

    -- 7. Validation errors on NULL household or negative spend
    PERFORM pg_temp.expect_error('T1.7 Reject negative discretionary total',
        format('SELECT * FROM fn_set_discretionary_mtd(%L, -100.00)', h), '23514');

    PERFORM pg_temp.expect_error('T1.8 Reject NULL household_id',
        'SELECT * FROM fn_set_discretionary_mtd(NULL, 500.00)', '22004');
END $$;

------------------------------------------------------------------------
-- T2: fn_set_discretionary_cap_override & Flow B -> Flow C Cascade
------------------------------------------------------------------------
\echo '--- T2: Discretionary Cap Overrides & Gatekeeper (FS001) Cascade'
DO $$
DECLARE
    h   UUID;
    u   UUID;
    res RECORD;
BEGIN
    -- Income 100k, Baseline 30k, EMI 20k, Reserves 400k -> Surplus 50k, Default Cap 25k
    h := pg_temp.mk_hh('P3CascadeHH', 100000, 30000, 20000, 400000);
    u := pg_temp.primary_user_of(h);

    -- Sync spend to 15,000 (SAFE under default 25k cap)
    PERFORM fn_set_discretionary_mtd(h, 15000.00);

    -- 1. User lowers custom cap override to 10,000 -> 15,000 spend now breaches cap -> CAUTION!
    SELECT * INTO res FROM fn_set_discretionary_cap_override(h, 10000.00);
    PERFORM pg_temp.ok('T2.1 Lowering cap override to 10,000 escalates 15,000 spend to CAUTION',
        res.discretionary_cap = 10000.00 AND res.current_tier = 'CAUTION');

    -- 2. Attempting to raise cap override above 50% of surplus (e.g. 40,000 > 25,000) is clamped at 25,000
    SELECT * INTO res FROM fn_set_discretionary_cap_override(h, 40000.00);
    PERFORM pg_temp.ok('T2.2 Cap override above 50% surplus is clamped to 25,000 (SAFE restored)',
        res.discretionary_cap = 25000.00 AND res.current_tier = 'SAFE');

    -- 3. Clearing cap override with NULL deletes the row from discretionary_caps
    SELECT * INTO res FROM fn_set_discretionary_cap_override(h, NULL);
    PERFORM pg_temp.ok('T2.3 Passing NULL removes cap override row cleanly',
        NOT EXISTS (SELECT 1 FROM discretionary_caps WHERE household_id = h)
        AND res.discretionary_cap = 25000.00);

    -- 4. End-to-End Flow B -> Flow C Cascade:
    --    While SAFE (spend = 15k), 60% equity allocation succeeds
    INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
        VALUES (h, u, 60.00, 20.00, 20.00);
    PERFORM pg_temp.ok('T2.4 Flow B->C: 60% equity allowed when MTD spend is within cap (SAFE)',
        EXISTS (SELECT 1 FROM asset_allocations WHERE household_id = h AND equity_pct = 60.00));

    --    MongoDB sync pushes MTD spend to 30,000 (> 25k cap) -> tier becomes CAUTION
    PERFORM fn_set_discretionary_mtd(h, 30000.00);
    PERFORM pg_temp.expect_error('T2.5 Flow B->C: After spend sync crosses cap (CAUTION), 50% equity is blocked with FS001',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct) VALUES (%L, %L, 50.00, 25.00, 25.00)', h, u),
        'FS001');

    --    MongoDB sync pushes MTD spend to 55,000 (> 50k surplus) -> tier becomes FREEZE
    PERFORM fn_set_discretionary_mtd(h, 55000.00);
    PERFORM pg_temp.expect_error('T2.6 Flow B->C: After spend sync crosses surplus (FREEZE), even 10% equity is blocked with FS001',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct) VALUES (%L, %L, 10.00, 40.00, 50.00)', h, u),
        'FS001');
END $$;

------------------------------------------------------------------------
-- T3: Multi-Tenant RLS on household_discretionary_monthly & discretionary_caps
------------------------------------------------------------------------
\echo '--- T3: Multi-Tenant RLS on Discretionary Spend Tables'
DO $$
DECLARE
    h1 UUID; u1 UUID;
    h2 UUID; u2 UUID;
    u_coach UUID;
    v_cnt INT;
BEGIN
    h1 := pg_temp.mk_hh('P3RlsHH1', 100000, 30000, 20000, 400000);
    u1 := pg_temp.primary_user_of(h1);

    h2 := pg_temp.mk_hh('P3RlsHH2', 100000, 30000, 20000, 400000);
    u2 := pg_temp.primary_user_of(h2);

    INSERT INTO users (full_name, email, password_hash, role)
        VALUES ('P3 Coach', 'p3coach@test.example', 'x', 'COACH')
        RETURNING user_id INTO u_coach;
    INSERT INTO coach_assignments (coach_id, household_id) VALUES (u_coach, h1);

    PERFORM fn_set_discretionary_mtd(h1, 14000.00);
    PERFORM fn_set_discretionary_mtd(h2, 19000.00);
    PERFORM fn_set_discretionary_cap_override(h1, 20000.00);
    PERFORM fn_set_discretionary_cap_override(h2, 22000.00);

    -- Create low-privilege role if not present to verify RLS enforcement
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finshield_rls_tester') THEN
        CREATE ROLE finshield_rls_tester NOLOGIN;
    END IF;
    GRANT USAGE ON SCHEMA public TO finshield_rls_tester;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finshield_rls_tester;

    SET LOCAL ROLE finshield_rls_tester;

    -- 1. User 1 sees ONLY Household 1's discretionary MTD and cap
    PERFORM set_config('app.current_user_id', u1::text, true);
    PERFORM set_config('app.current_user_role', 'USER', true);

    SELECT COUNT(*) INTO v_cnt FROM household_discretionary_monthly;
    PERFORM pg_temp.ok('T3.1 RLS USER sees only own household_discretionary_monthly',
        v_cnt = 1 AND EXISTS (SELECT 1 FROM household_discretionary_monthly WHERE household_id = h1));

    SELECT COUNT(*) INTO v_cnt FROM discretionary_caps;
    PERFORM pg_temp.ok('T3.2 RLS USER sees only own discretionary_caps',
        v_cnt = 1 AND EXISTS (SELECT 1 FROM discretionary_caps WHERE household_id = h1));

    -- 2. Coach sees only assigned household (h1) and not unassigned (h2)
    PERFORM set_config('app.current_user_id', u_coach::text, true);
    PERFORM set_config('app.current_user_role', 'COACH', true);

    SELECT COUNT(*) INTO v_cnt FROM household_discretionary_monthly;
    PERFORM pg_temp.ok('T3.3 RLS COACH sees only assigned household discretionary spend',
        v_cnt = 1 AND NOT EXISTS (SELECT 1 FROM household_discretionary_monthly WHERE household_id = h2));

    RESET ROLE;
    PERFORM set_config('app.current_user_id', '', true);
    PERFORM set_config('app.current_user_role', '', true);
END $$;

\echo '=== Phase 3 SQL Tests Complete: All 17 assertions passed ==='
ROLLBACK;
