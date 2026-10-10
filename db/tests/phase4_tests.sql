-- phase4_tests.sql
-- FinShield Phase 4 Test Suite: pgvector Semantic Recovery Playbooks,
-- What-If Scenario Simulator, 30/60/90-Day Cashflow Forecaster, and RLS.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/phase4_tests.sql
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
    IF p_income   > 0 THEN INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month)
                                VALUES (u, 'primary_salary', p_income, TRUE, 1); END IF;
    IF p_baseline > 0 THEN INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month)
                                VALUES (h, 'rent_and_living', p_baseline, 5); END IF;
    IF p_emi      > 0 THEN INSERT INTO liabilities (user_id, lender_name, principal_remaining,
                                                    annual_interest_rate, monthly_emi, emi_due_day)
                                VALUES (u, 'bank_loan', p_emi * 12, 12, p_emi, 10); END IF;
    IF p_reserves > 0 THEN INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund)
                                VALUES (h, 'emergency_fund', p_reserves, TRUE); END IF;
    RETURN h;
END $$;

CREATE FUNCTION pg_temp.primary_user_of(h UUID) RETURNS UUID LANGUAGE sql AS $$
    SELECT user_id FROM users WHERE household_id = h ORDER BY created_at ASC LIMIT 1;
$$;

------------------------------------------------------------------------
-- T1: pgvector Recovery Playbooks, Cosine Distance (<=>) & Hard Tier Filter
------------------------------------------------------------------------
\echo '--- T1: pgvector Recovery Playbooks, Cosine Distance (<=>) & Hard Tier Filter'
DO $$
DECLARE
    v_total_cnt   INT;
    v_bad_dim_cnt INT;
    v_safe_vec    vector;
    h_high_dti    UUID;
    h_low_runway  UUID;
    h_overspend   UUID;
    r_top         RECORD;
BEGIN
    -- 1. Verify 12 seeded playbooks (3 per tier)
    SELECT COUNT(*) INTO v_total_cnt FROM recovery_playbooks;
    PERFORM pg_temp.ok('T1.1 12 curated recovery playbooks seeded across 4 tiers',
        v_total_cnt >= 12
        AND (SELECT COUNT(*) FROM recovery_playbooks WHERE trigger_tier = 'SAFE') >= 3
        AND (SELECT COUNT(*) FROM recovery_playbooks WHERE trigger_tier = 'CAUTION') >= 3
        AND (SELECT COUNT(*) FROM recovery_playbooks WHERE trigger_tier = 'CRITICAL') >= 3
        AND (SELECT COUNT(*) FROM recovery_playbooks WHERE trigger_tier = 'FREEZE') >= 3);

    -- 2. Every playbook embedding has exact length 384
    SELECT COUNT(*) INTO v_bad_dim_cnt
    FROM recovery_playbooks
    WHERE array_length(embedding::float8[], 1) <> 384;
    PERFORM pg_temp.ok('T1.2 All playbook embeddings are 384-dimensional vectors',
        v_bad_dim_cnt = 0);

    -- 3. Reject playbook with non-384 dimension (CHECK constraint 23514)
    PERFORM pg_temp.expect_error('T1.3 Reject embedding vector with dimension != 384',
        'INSERT INTO recovery_playbooks (trigger_tier, title, content_text, embedding) VALUES (''SAFE'', ''Bad Dim'', ''text'', ''{0.1, 0.2, 0.3}''::vector)',
        '23514');

    -- 4. Verify TRD Section 5.4 verbatim query (`1 - (embedding <=> $1::vector)`)
    SELECT embedding INTO v_safe_vec
    FROM recovery_playbooks
    WHERE category_tag = 'STRATEGIC_WEALTH'
    LIMIT 1;

    SELECT
        playbook_id,
        title,
        1 - (embedding <=> v_safe_vec) AS similarity_score
    INTO r_top
    FROM recovery_playbooks
    WHERE trigger_tier = 'SAFE'::policy_tier
    ORDER BY embedding <=> v_safe_vec
    LIMIT 1;

    PERFORM pg_temp.ok('T1.4 TRD Section 5.4 cosine query returns exact match with similarity ~1.0',
        r_top.title = 'Age-Aligned Strategic Asset Allocation & Compounding'
        AND r_top.similarity_score > 0.999);

    -- 5. Hard Tier Filter Guarantee: Passing a SAFE wealth vector while filtering for CRITICAL
    --    must NEVER return any SAFE, CAUTION, or FREEZE playbook!
    PERFORM pg_temp.ok('T1.5 Hard tier filter guarantees CRITICAL query never leaks SAFE playbooks',
        NOT EXISTS (
            SELECT 1 FROM fn_match_recovery_playbooks(v_safe_vec, 'CRITICAL', 5)
            WHERE trigger_tier <> 'CRITICAL'
        ));

    -- 6. Contextual Routing: High-DTI CRITICAL household -> ranks HIGH_DTI_MITIGATION #1
    --    Income 100k, Baseline 20k, EMI 50k (DTI 50% > 45%), Reserves 450k (Runway 6.43 mos)
    h_high_dti := pg_temp.mk_hh('P4HighDtiHH', 100000, 20000, 50000, 450000);
    SELECT * INTO r_top FROM fn_get_playbooks_for_household(h_high_dti, NULL, 3) LIMIT 1;
    PERFORM pg_temp.ok('T1.6 High-DTI CRITICAL household retrieves HIGH_DTI_MITIGATION playbook #1',
        r_top.trigger_tier = 'CRITICAL' AND r_top.category_tag = 'HIGH_DTI_MITIGATION');

    -- 7. Contextual Routing: Low-Runway CRITICAL household -> ranks LOW_RUNWAY_REBUILD #1
    --    Income 100k, Baseline 35k, EMI 15k (DTI 15%), Reserves 75k (Runway 1.50 mos < 3)
    h_low_runway := pg_temp.mk_hh('P4LowRunwayHH', 100000, 35000, 15000, 75000);
    SELECT * INTO r_top FROM fn_get_playbooks_for_household(h_low_runway, NULL, 3) LIMIT 1;
    PERFORM pg_temp.ok('T1.7 Low-Runway CRITICAL household retrieves LOW_RUNWAY_REBUILD playbook #1',
        r_top.trigger_tier = 'CRITICAL' AND r_top.category_tag = 'LOW_RUNWAY_REBUILD');

    -- 8. Contextual Routing: Overspend CAUTION household -> ranks CAP_BREACH_GUARDRAIL #1
    --    Income 100k, Baseline 30k, EMI 20k (Surplus 50k, Cap 25k), Reserves 400k -> MTD spend 30k
    h_overspend := pg_temp.mk_hh('P4OverspendHH', 100000, 30000, 20000, 400000);
    PERFORM fn_set_discretionary_mtd(h_overspend, 30000.00);
    SELECT * INTO r_top FROM fn_get_playbooks_for_household(h_overspend, NULL, 3) LIMIT 1;
    PERFORM pg_temp.ok('T1.8 Overspend CAUTION household retrieves CAP_BREACH_GUARDRAIL playbook #1',
        r_top.trigger_tier = 'CAUTION' AND r_top.category_tag = 'CAP_BREACH_GUARDRAIL');
END $$;

------------------------------------------------------------------------
-- T2: Non-Destructive What-If Scenario Simulator (PRD Feature 3)
------------------------------------------------------------------------
\echo '--- T2: Non-Destructive What-If Scenario Simulator'
DO $$
DECLARE
    h      UUID;
    u_sec  UUID;
    sc_id  UUID;
    sim    RECORD;
    snap   financial_snapshots;
BEGIN
    -- Create Dual-Earner SAFE household:
    -- Primary earner: 80,000 | Secondary earner: 40,000 -> Total Income = 120,000
    -- Baseline: 30,000 | EMI: 20,000 -> Total Costs = 50,000 | Surplus = 70,000
    -- Reserves: 350,000 -> Runway = 7.00 months | DTI = 16.67% | Tier = SAFE
    h := pg_temp.mk_hh('P4SimHH', 80000, 30000, 20000, 350000);
    INSERT INTO users (household_id, full_name, email, password_hash)
        VALUES (h, 'Spouse Earner', 'spouse_p4@test.example', 'x') RETURNING user_id INTO u_sec;
    INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month)
        VALUES (u_sec, 'spouse_salary', 40000, FALSE, 1);

    -- 1. Empty scenario {} matches live state identically
    SELECT * INTO sim FROM fn_simulate_scenario(h, '{}'::jsonb);
    PERFORM pg_temp.ok('T2.1 Baseline simulation with {} matches live SAFE state',
        sim.live_tier = 'SAFE' AND sim.sim_tier = 'SAFE' AND sim.tier_changed = FALSE
        AND sim.sim_income = 120000.00 AND sim.sim_runway_months = 7.00);

    -- 2. What-If: 20% Rent/Baseline Hike -> Costs become 36k + 20k = 56k, Runway = 350k / 56k = 6.25 (SAFE)
    --    50% Baseline Hike -> Costs become 45k + 20k = 65k, Runway = 350k / 65k = 5.38 (< 6 -> CAUTION!)
    SELECT * INTO sim FROM fn_simulate_scenario(h, '{"baseline_pct_change": 50}'::jsonb);
    PERFORM pg_temp.ok('T2.2 What-If 50% baseline hike drops simulated runway to 5.38 (CAUTION)',
        sim.sim_baseline = 45000.00
        AND sim.sim_runway_months = 5.38
        AND sim.sim_tier = 'CAUTION'
        AND sim.tier_changed = TRUE);

    -- 3. What-If: Primary Earner Job Loss (`drop_primary_earner: true`)
    --    Income drops 120k -> 40k. Costs = 50k. Surplus = -10k (< 0 -> FREEZE!)
    SELECT * INTO sim FROM fn_simulate_scenario(h, '{"drop_primary_earner": true}'::jsonb);
    PERFORM pg_temp.ok('T2.3 What-If primary earner loss drops income to 40k, surplus -10k -> FREEZE',
        sim.sim_income = 40000.00
        AND sim.sim_surplus = -10000.00
        AND sim.sim_tier = 'FREEZE'
        AND sim.tier_changed = TRUE);

    -- 4. What-If: Sudden Medical Emergency Reserve Shock (`reserve_delta: -250000`)
    --    Reserves drop 350k -> 100k. Runway = 100k / 50k = 2.00 months (< 3 -> CRITICAL!)
    SELECT * INTO sim FROM fn_simulate_scenario(h, '{"reserve_delta": -250000}'::jsonb);
    PERFORM pg_temp.ok('T2.4 What-If -250k reserve shock drops runway to 2.00 months -> CRITICAL',
        sim.sim_reserves = 100000.00
        AND sim.sim_runway_months = 2.00
        AND sim.sim_tier = 'CRITICAL');

    -- 5. Verify Live Snapshot was NEVER touched by any of the stress simulations!
    SELECT * INTO snap FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T2.5 Live financial_snapshots row is 100% untouched after stress simulations',
        snap.total_monthly_income = 120000.00
        AND snap.total_baseline_costs = 30000.00
        AND snap.total_liquid_reserves = 350000.00
        AND snap.current_tier = 'SAFE');

    -- 6. Saved Scenario execution via `scenarios` table + `fn_run_saved_scenario`
    INSERT INTO scenarios (household_id, created_by, scenario_name, params)
    VALUES (
        h,
        pg_temp.primary_user_of(h),
        'Primary Job Loss + 15% Rent Hike',
        '{"drop_primary_earner": true, "baseline_pct_change": 15}'::jsonb
    )
    RETURNING scenario_id INTO sc_id;

    SELECT * INTO sim FROM fn_run_saved_scenario(sc_id);
    PERFORM pg_temp.ok('T2.6 fn_run_saved_scenario executes persisted scenario accurately',
        sim.scenario_name = 'Primary Job Loss + 15% Rent Hike'
        AND sim.sim_tier = 'FREEZE'
        AND sim.sim_surplus = -14500.00);
END $$;

------------------------------------------------------------------------
-- T3: 30/60/90-Day Cashflow Trajectory Forecaster (`fn_forecast_cashflow_90d`)
------------------------------------------------------------------------
\echo '--- T3: 30/60/90-Day Cashflow Trajectory Forecaster'
DO $$
DECLARE
    h_def       UUID;
    u_def       UUID;
    v_days      INT;
    v_first_def INT;
    v_m1_emi    NUMERIC;
    v_m2_emi    NUMERIC;
BEGIN
    -- Create a household starting on 2026-01-01:
    -- Initial Emergency Reserve = 10,000
    -- Rent (Baseline) = 25,000 due on Day 5 of month
    -- Salary (Income) = 40,000 paid on Day 20 of month
    -- Loan EMI = 8,000 due on Day 10 of month, with `remaining_tenure_months = 1` (expires after Month 1!)
    INSERT INTO households (household_name) VALUES ('P4ForecastHH') RETURNING household_id INTO h_def;
    INSERT INTO users (household_id, full_name, email, password_hash)
        VALUES (h_def, 'Forecast User', 'forecast_p4@test.example', 'x') RETURNING user_id INTO u_def;

    INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund)
        VALUES (h_def, 'Starter Buffer', 10000, TRUE);
    INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month)
        VALUES (h_def, 'Rent', 25000, 5);
    INSERT INTO incomes (user_id, source_name, monthly_amount, pay_day_of_month)
        VALUES (u_def, 'Salary', 40000, 20);
    INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day, remaining_tenure_months)
        VALUES (u_def, 'Short Tenure Loan', 8000, 12.0, 8000, 10, 1);

    -- 1. Forecast generates 90 daily trajectory points
    SELECT COUNT(*) INTO v_days
    FROM fn_forecast_cashflow_90d(h_def, 90, '2026-01-01'::date);
    PERFORM pg_temp.ok('T3.1 Forecast generates exact 90 daily trajectory rows', v_days = 90);

    -- 2. On Day 5 (2026-01-05), 25,000 Rent hits against 10,000 reserve -> balance -15,000 -> Deficit flagged!
    --    On Day 20 (2026-01-20), 40,000 Salary lands -> balance recovers to +17,000!
    SELECT MIN(day_offset) INTO v_first_def
    FROM fn_forecast_cashflow_90d(h_def, 90, '2026-01-01'::date)
    WHERE is_deficit = TRUE;

    PERFORM pg_temp.ok('T3.2 Forecaster flags balance deficit on exact due date (Day 5: 2026-01-05)',
        v_first_def = 5
        AND (SELECT projected_balance FROM fn_forecast_cashflow_90d(h_def, 90, '2026-01-01'::date) WHERE day_offset = 5) = -15000.00
        AND (SELECT projected_balance FROM fn_forecast_cashflow_90d(h_def, 90, '2026-01-01'::date) WHERE day_offset = 20) = 17000.00);

    -- 3. Loan with `remaining_tenure_months = 1` bills 8,000 on 2026-01-10,
    --    and stops billing on 2026-02-10 (Month 2)!
    SELECT daily_outflow INTO v_m1_emi
    FROM fn_forecast_cashflow_90d(h_def, 90, '2026-01-01'::date)
    WHERE forecast_date = '2026-01-10'::date;

    SELECT daily_outflow INTO v_m2_emi
    FROM fn_forecast_cashflow_90d(h_def, 90, '2026-01-01'::date)
    WHERE forecast_date = '2026-02-10'::date;

    PERFORM pg_temp.ok('T3.3 Loan with remaining_tenure_months=1 bills in Month 1 and stops in Month 2',
        v_m1_emi = 8000.00 AND v_m2_emi = 0.00);
END $$;

------------------------------------------------------------------------
-- T4: Multi-Tenant RLS on scenarios & recovery_playbooks
------------------------------------------------------------------------
\echo '--- T4: Multi-Tenant RLS on Scenarios & Recovery Playbooks'
DO $$
DECLARE
    h1 UUID; u1 UUID;
    h2 UUID; u2 UUID;
    v_sc_cnt INT;
    v_pb_cnt INT;
BEGIN
    h1 := pg_temp.mk_hh('P4RlsHH1', 100000, 30000, 20000, 400000);
    u1 := pg_temp.primary_user_of(h1);

    h2 := pg_temp.mk_hh('P4RlsHH2', 100000, 30000, 20000, 400000);
    u2 := pg_temp.primary_user_of(h2);

    INSERT INTO scenarios (household_id, created_by, scenario_name, params)
        VALUES (h1, u1, 'HH1 Scenario', '{"baseline_pct_change": 10}'::jsonb);
    INSERT INTO scenarios (household_id, created_by, scenario_name, params)
        VALUES (h2, u2, 'HH2 Scenario', '{"baseline_pct_change": 20}'::jsonb);

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finshield_rls_tester') THEN
        CREATE ROLE finshield_rls_tester NOLOGIN;
    END IF;
    GRANT USAGE ON SCHEMA public TO finshield_rls_tester;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finshield_rls_tester;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO finshield_rls_tester;

    SET LOCAL ROLE finshield_rls_tester;
    PERFORM set_config('app.current_user_id', u1::text, true);
    PERFORM set_config('app.current_user_role', 'USER', true);

    SELECT COUNT(*) INTO v_sc_cnt FROM scenarios;
    PERFORM pg_temp.ok('T4.1 RLS USER sees only own household scenarios',
        v_sc_cnt = 1 AND EXISTS (SELECT 1 FROM scenarios WHERE household_id = h1));

    SELECT COUNT(*) INTO v_pb_cnt FROM recovery_playbooks;
    PERFORM pg_temp.ok('T4.2 RLS USER can read all recovery playbooks',
        v_pb_cnt >= 12);

    -- Attempting DELETE as USER filters out all rows via RLS USING clause (0 rows deleted)
    DELETE FROM recovery_playbooks;
    SELECT COUNT(*) INTO v_pb_cnt FROM recovery_playbooks;
    PERFORM pg_temp.ok('T4.3 RLS prevents USER from deleting recovery_playbooks (all 12 remain intact)',
        v_pb_cnt >= 12);

    -- Attempting INSERT as USER violates RLS WITH CHECK policy (SQLSTATE 42501)
    BEGIN
        INSERT INTO recovery_playbooks (trigger_tier, title, content_text, embedding)
        VALUES ('SAFE', 'Hack', 'x', fn_build_384_embedding(1,0,0,0,0,0));
        PERFORM pg_temp.ok('T4.4 RLS blocks USER from inserting into recovery_playbooks', FALSE);
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok('T4.4 RLS blocks USER from inserting into recovery_playbooks (SQLSTATE 42501)', TRUE);
    END;

    RESET ROLE;
    PERFORM set_config('app.current_user_id', '', true);
    PERFORM set_config('app.current_user_role', '', true);
END $$;

\echo '=== Phase 4 Tests Complete: All 21 assertions passed ==='
ROLLBACK;
