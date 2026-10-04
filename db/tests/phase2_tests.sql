-- phase2_tests.sql
-- FinShield Phase 2 Test Suite: Allocation Gatekeeper, Stored Procedures, Views, RLS
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/phase2_tests.sql
-- Runs in one transaction and rolls back at the end. Zero side-effects.

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
-- T1: Allocation Gatekeeper Trigger & Integrity (FS001)
------------------------------------------------------------------------
\echo '--- T1: Allocation Gatekeeper Trigger (FS001)'
DO $$
DECLARE
    h_safe UUID; u_safe UUID;
    h_caut UUID; u_caut UUID;
    h_crit UUID; u_crit UUID;
    h_frz  UUID; u_frz  UUID;
    v_audit_count INT;
BEGIN
    -- Setup households across all 4 tiers
    -- SAFE:     income 100k, baseline 30k, emi 20k, reserves 400k (runway 8.0, DTI 20%)
    h_safe := pg_temp.mk_hh('SafeHH', 100000, 30000, 20000, 400000);
    u_safe := pg_temp.primary_user_of(h_safe);

    -- CAUTION:  income 100k, baseline 30k, emi 35k, reserves 400k (runway 6.15, DTI 35%)
    h_caut := pg_temp.mk_hh('CautHH', 100000, 30000, 35000, 400000);
    u_caut := pg_temp.primary_user_of(h_caut);

    -- CRITICAL: income 60k, baseline 25k, emi 30k, reserves 100k (runway 1.82, DTI 50%)
    h_crit := pg_temp.mk_hh('CritHH', 60000, 25000, 30000, 100000);
    u_crit := pg_temp.primary_user_of(h_crit);

    -- FREEZE:   income 40k, baseline 25k, emi 20k, reserves 100k (deficit surplus -5k)
    h_frz  := pg_temp.mk_hh('FrzHH', 40000, 25000, 20000, 100000);
    u_frz  := pg_temp.primary_user_of(h_frz);

    -- 1. SAFE household: Full equity allowed (e.g. 60% equity, 20% debt, 20% emergency)
    INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
        VALUES (h_safe, u_safe, 60.00, 20.00, 20.00);
    PERFORM pg_temp.ok('T1 SAFE allows 60% equity',
        EXISTS (SELECT 1 FROM asset_allocations WHERE household_id = h_safe AND equity_pct = 60.00));

    -- 2. CAUTION household: Equity <= 25% allowed
    INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
        VALUES (h_caut, u_caut, 25.00, 35.00, 40.00);
    PERFORM pg_temp.ok('T1 CAUTION allows 25% equity (cap boundary)',
        EXISTS (SELECT 1 FROM asset_allocations WHERE household_id = h_caut AND equity_pct = 25.00));

    -- 3. CAUTION household: Equity > 25% blocked with FS001
    PERFORM pg_temp.expect_error('T1 CAUTION blocks equity 30% > 25%',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct) VALUES (''%s'', ''%s'', 30.00, 35.00, 35.00)', h_caut, u_caut),
        'FS001');

    -- 4. CRITICAL household: Equity > 0 blocked with FS001
    PERFORM pg_temp.expect_error('T1 CRITICAL blocks equity 10%',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct) VALUES (''%s'', ''%s'', 10.00, 40.00, 50.00)', h_crit, u_crit),
        'FS001');

    -- 5. CRITICAL household: 0% equity allowed
    INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
        VALUES (h_crit, u_crit, 0.00, 50.00, 50.00);
    PERFORM pg_temp.ok('T1 CRITICAL allows 0% equity',
        EXISTS (SELECT 1 FROM asset_allocations WHERE household_id = h_crit AND equity_pct = 0.00));

    -- 6. FREEZE household: Equity > 0 blocked with FS001
    PERFORM pg_temp.expect_error('T1 FREEZE blocks equity 5%',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct) VALUES (''%s'', ''%s'', 5.00, 0.00, 95.00)', h_frz, u_frz),
        'FS001');

    -- 7. FREEZE household: 0% equity allowed (100% emergency buffer)
    INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct)
        VALUES (h_frz, u_frz, 0.00, 0.00, 100.00);
    PERFORM pg_temp.ok('T1 FREEZE allows 0% equity (100% emergency)',
        EXISTS (SELECT 1 FROM asset_allocations WHERE household_id = h_frz AND emergency_pct = 100.00));

    -- 8. Allocation sum != 100% rejected by CHECK constraint
    PERFORM pg_temp.expect_error('T1 allocation sum 90% rejected (SQLSTATE 23514)',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct) VALUES (''%s'', ''%s'', 50.00, 20.00, 20.00)', h_safe, u_safe),
        '23514');

    -- 9. CRITICAL override WITH reason succeeds and logs audit entry
    INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct, is_override, override_reason)
        VALUES (h_crit, u_crit, 40.00, 30.00, 30.00, TRUE, 'Emergency consultation with coach approved temporary risk');
    PERFORM pg_temp.ok('T1 CRITICAL manual override allowed with reason',
        EXISTS (SELECT 1 FROM asset_allocations WHERE household_id = h_crit AND is_override = TRUE));

    SELECT COUNT(*) INTO v_audit_count FROM policy_audit_logs WHERE user_id = u_crit AND attempted_action = 'MANUAL_ALLOCATION_OVERRIDE';
    PERFORM pg_temp.ok('T1 override logged in policy_audit_logs', v_audit_count > 0);

    -- 10. Override WITHOUT reason rejected by CHECK constraint
    PERFORM pg_temp.expect_error('T1 override without reason rejected (SQLSTATE 23514)',
        format('INSERT INTO asset_allocations (household_id, created_by, equity_pct, debt_pct, emergency_pct, is_override, override_reason) VALUES (''%s'', ''%s'', 40.00, 30.00, 30.00, TRUE, NULL)', h_crit, u_crit),
        '23514');
END $$;

------------------------------------------------------------------------
-- T2: Stored Function sp_evaluate_allocation_policy (Explainability Modal)
------------------------------------------------------------------------
\echo '--- T2: sp_evaluate_allocation_policy'
DO $$
DECLARE
    h_safe UUID; u_safe UUID;
    h_crit UUID; u_crit UUID;
    r_eval RECORD;
BEGIN
    h_safe := pg_temp.mk_hh('EvalSafe', 100000, 30000, 20000, 400000);
    u_safe := pg_temp.primary_user_of(h_safe);
    INSERT INTO risk_profiles (user_id, age, risk_appetite) VALUES (u_safe, 30, 'AGGRESSIVE')
        ON CONFLICT (user_id) DO UPDATE SET age = 30, risk_appetite = 'AGGRESSIVE';

    -- Evaluate SAFE: should allow up to 100% equity, status 'ALLOWED'
    SELECT * INTO r_eval FROM sp_evaluate_allocation_policy(h_safe, 60.00);
    PERFORM pg_temp.ok('T2 SAFE evaluation status is ALLOWED', r_eval.action_status = 'ALLOWED');
    PERFORM pg_temp.ok('T2 SAFE allowed_equity_max is 100.00', r_eval.allowed_equity_max = 100.00);
    PERFORM pg_temp.ok('T2 SAFE recommends aggressive equity (>60%)', r_eval.recommended_equity >= 60.00);

    -- Evaluate CRITICAL: should block equity, status 'BLOCKED', tier_reasons populated
    h_crit := pg_temp.mk_hh('EvalCrit', 60000, 25000, 30000, 100000);
    SELECT * INTO r_eval FROM sp_evaluate_allocation_policy(h_crit, 20.00);
    PERFORM pg_temp.ok('T2 CRITICAL evaluation status is BLOCKED', r_eval.action_status = 'BLOCKED');
    PERFORM pg_temp.ok('T2 CRITICAL allowed_equity_max is 0.00', r_eval.allowed_equity_max = 0.00);
    PERFORM pg_temp.ok('T2 CRITICAL propagates tier_reasons array', array_length(r_eval.tier_reasons, 1) > 0);
END $$;

------------------------------------------------------------------------
-- T3: Debt Payoff Engine (sp_generate_debt_plan & fn_get_debt_payoff_schedule)
------------------------------------------------------------------------
\echo '--- T3: Debt Payoff Engine'
DO $$
DECLARE
    h UUID; u UUID;
    d_cc UUID; d_loan UUID; d_car UUID;
    r_sched RECORD;
BEGIN
    h := pg_temp.mk_hh('DebtHH', 100000, 30000, 0, 100000);
    u := pg_temp.primary_user_of(h);

    -- Insert multiple distinct liabilities:
    -- Credit Card: principal 3000, rate 24.00%, emi 150
    INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi)
        VALUES (u, 'Credit Card', 3000.00, 24.00, 150.00) RETURNING debt_id INTO d_cc;
    -- Auto Loan:   principal 5000, rate 8.00%,  emi 200
    INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi)
        VALUES (u, 'Auto Loan', 5000.00, 8.00, 200.00) RETURNING debt_id INTO d_car;
    -- Personal Loan: principal 10000, rate 14.00%, emi 300
    INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi)
        VALUES (u, 'Personal Loan', 10000.00, 14.00, 300.00) RETURNING debt_id INTO d_loan;

    -- Procedure sp_generate_debt_plan runs without raising errors
    CALL sp_generate_debt_plan(u, 'AVALANCHE', 500.00);
    PERFORM pg_temp.ok('T3 sp_generate_debt_plan AVALANCHE executes', TRUE);
    CALL sp_generate_debt_plan(u, 'SNOWBALL', 500.00);
    PERFORM pg_temp.ok('T3 sp_generate_debt_plan SNOWBALL executes', TRUE);

    -- Verify AVALANCHE schedule ordering: highest rate first (24% -> 14% -> 8%)
    SELECT * INTO r_sched FROM fn_get_debt_payoff_schedule(u, 'AVALANCHE', 500.00) WHERE priority_rank = 1;
    PERFORM pg_temp.ok('T3 AVALANCHE rank 1 is Credit Card (highest rate 24%)', r_sched.debt_id = d_cc);
    PERFORM pg_temp.ok('T3 AVALANCHE rank 1 receives extra payment ($500)', r_sched.extra_payment_alloc = 500.00);
    PERFORM pg_temp.ok('T3 AVALANCHE total pay is 150 + 500 = 650', r_sched.total_monthly_pay = 650.00);

    -- Verify SNOWBALL schedule ordering: lowest principal first ($3000 -> $5000 -> $10000)
    SELECT * INTO r_sched FROM fn_get_debt_payoff_schedule(u, 'SNOWBALL', 500.00) WHERE priority_rank = 2;
    PERFORM pg_temp.ok('T3 SNOWBALL rank 2 is Auto Loan ($5000 principal)', r_sched.debt_id = d_car);
END $$;

------------------------------------------------------------------------
-- T4: Analytical View: view_high_risk_households
------------------------------------------------------------------------
\echo '--- T4: view_high_risk_households'
DO $$
DECLARE
    h_safe UUID; h_caut UUID; h_crit UUID; h_frz UUID;
    v_found_crit BOOLEAN;
    v_found_safe BOOLEAN;
    v_rank_crit  INT;
BEGIN
    h_safe := pg_temp.mk_hh('ViewSafe', 100000, 30000, 20000, 400000);
    h_caut := pg_temp.mk_hh('ViewCaut', 100000, 30000, 35000, 400000);
    h_crit := pg_temp.mk_hh('ViewCrit',  60000, 25000, 30000, 100000); -- DTI = 50%
    h_frz  := pg_temp.mk_hh('ViewFrz',   40000, 25000, 20000, 100000); -- FREEZE

    -- SAFE and CAUTION should NOT appear in view_high_risk_households
    SELECT EXISTS (SELECT 1 FROM view_high_risk_households WHERE household_id = h_safe) INTO v_found_safe;
    PERFORM pg_temp.ok('T4 SAFE excluded from high-risk view', v_found_safe IS FALSE);

    -- CRITICAL and FREEZE should appear
    SELECT EXISTS (SELECT 1 FROM view_high_risk_households WHERE household_id = h_crit) INTO v_found_crit;
    PERFORM pg_temp.ok('T4 CRITICAL included in high-risk view', v_found_crit IS TRUE);

    -- Ranks are populated
    SELECT dti_risk_rank INTO v_rank_crit FROM view_high_risk_households WHERE household_id = h_crit;
    PERFORM pg_temp.ok('T4 dti_risk_rank is assigned', v_rank_crit IS NOT NULL);
END $$;

------------------------------------------------------------------------
-- T5: Multi-Tenant Row-Level Security (RLS)
------------------------------------------------------------------------
CREATE ROLE finshield_test_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO finshield_test_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO finshield_test_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO finshield_test_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO finshield_test_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO finshield_test_app;

DO $$
DECLARE
    h_a UUID; u_a UUID;
    h_b UUID; u_b UUID;
    u_coach UUID;
    v_cnt INT;
BEGIN
    -- Setup Household A and User A
    h_a := pg_temp.mk_hh('TenantA', 100000, 30000, 20000, 400000);
    u_a := pg_temp.primary_user_of(h_a);

    -- Setup Household B and User B
    h_b := pg_temp.mk_hh('TenantB', 80000, 25000, 15000, 300000);
    u_b := pg_temp.primary_user_of(h_b);

    -- Setup Coach and assign ONLY to Household A
    INSERT INTO users (full_name, email, password_hash, role)
        VALUES ('Test Coach', 'coach_test@finshield.example', 'x', 'COACH')
        RETURNING user_id INTO u_coach;
    INSERT INTO coach_assignments (coach_id, household_id) VALUES (u_coach, h_a);

    -- Switch to non-superuser application role subject to RLS
    SET LOCAL ROLE finshield_test_app;

    -- 1. USER A session: should see Household A, but NEVER Household B
    PERFORM set_config('app.current_user_id', u_a::TEXT, true);
    PERFORM set_config('app.current_user_role', 'USER', true);

    SELECT COUNT(*) INTO v_cnt FROM households WHERE household_id = h_a;
    PERFORM pg_temp.ok('T5 USER sees own household A', v_cnt = 1);

    SELECT COUNT(*) INTO v_cnt FROM households WHERE household_id = h_b;
    PERFORM pg_temp.ok('T5 USER cannot see unowned household B', v_cnt = 0);

    SELECT COUNT(*) INTO v_cnt FROM financial_snapshots WHERE household_id = h_b;
    PERFORM pg_temp.ok('T5 USER cannot see snapshot of household B', v_cnt = 0);

    -- 2. COACH session: should see assigned Household A, but NOT unassigned Household B
    PERFORM set_config('app.current_user_id', u_coach::TEXT, true);
    PERFORM set_config('app.current_user_role', 'COACH', true);

    SELECT COUNT(*) INTO v_cnt FROM households WHERE household_id = h_a;
    PERFORM pg_temp.ok('T5 COACH sees assigned household A', v_cnt = 1);

    SELECT COUNT(*) INTO v_cnt FROM households WHERE household_id = h_b;
    PERFORM pg_temp.ok('T5 COACH cannot see unassigned household B', v_cnt = 0);

    -- 3. ADMIN session: can see all households
    PERFORM set_config('app.current_user_role', 'ADMIN', true);
    SELECT COUNT(*) INTO v_cnt FROM households WHERE household_id IN (h_a, h_b);
    PERFORM pg_temp.ok('T5 ADMIN sees all households', v_cnt = 2);

    -- Reset role and session variables
    RESET ROLE;
    PERFORM set_config('app.current_user_id', '', true);
    PERFORM set_config('app.current_user_role', '', true);
END $$;

------------------------------------------------------------------------
-- Final verification
------------------------------------------------------------------------
\echo '--- ALL PHASE 2 TESTS PASSED'
ROLLBACK;
