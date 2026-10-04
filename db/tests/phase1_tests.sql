-- phase1_tests.sql
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/phase1_tests.sql
-- Everything runs in one transaction that is ROLLED BACK at the end, so the
-- database is left untouched. Any failed check raises and aborts the run.

\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages = notice;
BEGIN;

------------------------------------------------------------------------
-- Test helpers (live in pg_temp, vanish with the session)
------------------------------------------------------------------------
CREATE FUNCTION pg_temp.ok(p_name TEXT, p_cond BOOLEAN) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS TRUE THEN
        RAISE NOTICE 'PASS  %', p_name;
    ELSE
        RAISE EXCEPTION 'FAIL  %', p_name;
    END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(p_name TEXT, p_sql TEXT, p_state TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
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

-- Build a household with one user and the given monthly figures.
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

CREATE FUNCTION pg_temp.tier_of(h UUID) RETURNS TEXT LANGUAGE sql AS $$
    SELECT current_tier::text FROM financial_snapshots WHERE household_id = h $$;

------------------------------------------------------------------------
-- T1. Pure classifier vectors (no tables involved)
------------------------------------------------------------------------
\echo '--- T1: classifier vectors'
CREATE TEMP TABLE vec (
    name TEXT, income NUMERIC, baseline NUMERIC, emi NUMERIC, reserves NUMERIC,
    disc NUMERIC, cap NUMERIC, exp_tier TEXT, exp_runway NUMERIC, exp_dti NUMERIC);

INSERT INTO vec VALUES
 -- the six spec vectors (Phase 0 section 10)
 ('A safe',                     100000, 30000, 20000,  400000,     0, NULL, 'SAFE',     8.00, 20.00),
 ('B caution (DTI 35)',         100000, 30000, 35000,  400000,     0, NULL, 'CAUTION',  6.15, 35.00),
 ('C critical (DTI 50)',         60000, 25000, 30000,  100000,     0, NULL, 'CRITICAL', 1.82, 50.00),
 ('D freeze (deficit)',          40000, 25000, 20000,  100000,     0, NULL, 'FREEZE',   2.22, 50.00),
 ('E boundary DTI30 runway6',   100000, 30000, 30000,  360000,     0, NULL, 'SAFE',     6.00, 30.00),
 ('F 24mo runway, DTI 46',      100000, 10000, 46000, 1344000,     0, NULL, 'CRITICAL',24.00, 46.00),
 -- runway boundaries
 ('runway exactly 3 -> CAUTION',100000, 30000, 20000,  150000,     0, NULL, 'CAUTION',  3.00, 20.00),
 ('runway exactly 1 -> CRITICAL',100000,30000, 20000,   50000,     0, NULL, 'CRITICAL', 1.00, 20.00),
 ('runway 0.99998 -> FREEZE',   100000, 30000, 20000,   49999,     0, NULL, 'FREEZE',   1.00, 20.00),
 -- DTI boundaries (reserves = 100x monthly costs, so runway is exactly 100.00 and never interferes)
 ('DTI 30.01 -> CAUTION',       100000, 10000, 30010,  4001000,    0, NULL, 'CAUTION',  100.00, 30.01),
 ('DTI exactly 45 -> CAUTION',  100000, 10000, 45000,  5500000,    0, NULL, 'CAUTION',  100.00, 45.00),
 ('DTI 45.01 -> CRITICAL',      100000, 10000, 45010,  5501000,    0, NULL, 'CRITICAL', 100.00, 45.01),
 -- degenerate inputs
 ('no income -> FREEZE, DTI NULL', 0,    10000,     0,   50000,     0, NULL, 'FREEZE',   5.00, NULL),
 ('zero costs -> runway 999',   100000,     0,     0,        0,     0, NULL, 'SAFE',   999.00, 0.00),
 -- overspend escalator (A: surplus 50000, default cap 25000)
 ('SAFE, spend = cap -> SAFE',  100000, 30000, 20000,  400000, 25000, NULL, 'SAFE',     8.00, 20.00),
 ('SAFE, spend > cap -> CAUTION',100000,30000, 20000,  400000, 25001, NULL, 'CAUTION',  8.00, 20.00),
 ('spend = surplus -> not FREEZE',100000,30000,20000,  400000, 50000, NULL, 'CAUTION',  8.00, 20.00),
 ('spend > surplus -> FREEZE',  100000, 30000, 20000,  400000, 50001, NULL, 'FREEZE',   8.00, 20.00),
 ('CAUTION + overspend -> CRITICAL',100000,30000,35000,400000, 20000, NULL, 'CRITICAL', 6.15, 35.00),
 ('CRITICAL + overspend stays', 60000,  25000, 30000,  100000,  3000, NULL, 'CRITICAL', 1.82, 50.00),
 -- cap override can only go DOWN
 ('lower cap override applies', 100000, 30000, 20000,  400000, 10001, 10000, 'CAUTION', 8.00, 20.00),
 ('higher cap override ignored',100000, 30000, 20000,  400000, 30000, 40000, 'CAUTION', 8.00, 20.00);

\o NUL
SELECT pg_temp.ok('T1 ' || v.name,
       c.tier::text = v.exp_tier
       AND c.emergency_runway_months = v.exp_runway
       AND c.dti_ratio IS NOT DISTINCT FROM v.exp_dti)
  FROM vec v
 CROSS JOIN LATERAL fn_classify_tier(v.income, v.baseline, v.emi, v.reserves, v.disc, v.cap) c
 ORDER BY v.name;
\o

\o NUL
-- No overflow when costs are 20x income (original NUMERIC(5,2) would have died)
SELECT pg_temp.ok('T1 rigidity 2000% does not overflow',
       (SELECT rigidity_ratio FROM fn_classify_tier(1000, 20000, 0, 0, 0)) = 2000.00);

-- Reasons are explainable text
SELECT pg_temp.ok('T1 reasons populated for DTI 52',
       (SELECT tier_reasons FROM fn_classify_tier(4000, 1470, 2080, 100000, 0))
         @> ARRAY['DTI 52.00% is above 45%']);
\o

------------------------------------------------------------------------
-- T2. End to end: same vectors through the real triggers
------------------------------------------------------------------------
\echo '--- T2: triggers produce the same tiers'
DO $$
DECLARE h UUID;
BEGIN
    h := pg_temp.mk_hh('t2a', 100000, 30000, 20000,  400000);
    PERFORM pg_temp.ok('T2 A -> SAFE',     pg_temp.tier_of(h) = 'SAFE');
    h := pg_temp.mk_hh('t2b', 100000, 30000, 35000,  400000);
    PERFORM pg_temp.ok('T2 B -> CAUTION',  pg_temp.tier_of(h) = 'CAUTION');
    h := pg_temp.mk_hh('t2c',  60000, 25000, 30000,  100000);
    PERFORM pg_temp.ok('T2 C -> CRITICAL', pg_temp.tier_of(h) = 'CRITICAL');
    h := pg_temp.mk_hh('t2d',  40000, 25000, 20000,  100000);
    PERFORM pg_temp.ok('T2 D -> FREEZE',   pg_temp.tier_of(h) = 'FREEZE');
    h := pg_temp.mk_hh('t2e', 100000, 30000, 30000,  360000);
    PERFORM pg_temp.ok('T2 E -> SAFE (boundary)', pg_temp.tier_of(h) = 'SAFE');
    h := pg_temp.mk_hh('t2f', 100000, 10000, 46000, 1344000);
    PERFORM pg_temp.ok('T2 F -> CRITICAL', pg_temp.tier_of(h) = 'CRITICAL');
END $$;

DO $$
DECLARE h UUID; s financial_snapshots;
BEGIN
    INSERT INTO households (household_name) VALUES ('t2-empty') RETURNING household_id INTO h;
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T2 new household gets a snapshot immediately', s.snapshot_id IS NOT NULL);
    PERFORM pg_temp.ok('T2 empty household is FREEZE with NULL DTI',
                       s.current_tier = 'FREEZE' AND s.dti_ratio IS NULL);

    h := pg_temp.mk_hh('t2g', 100000, 30000, 20000, 400000);
    INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund)
        VALUES (h, 'vacation fund', 9000000, FALSE);
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T2 non-emergency assets do NOT count toward runway',
                       s.emergency_runway_months = 8.00 AND s.total_liquid_reserves = 400000);
END $$;

------------------------------------------------------------------------
-- T3. Mutations: the cases the original schema got wrong
------------------------------------------------------------------------
\echo '--- T3: mutations keep the snapshot correct'
DO $$
DECLARE h UUID; u UUID; s financial_snapshots; hx UUID; hy UUID;
BEGIN
    -- (a) income change flips tier (original: no trigger on incomes at all)
    h := pg_temp.mk_hh('t3a', 100000, 30000, 20000, 400000);
    UPDATE incomes SET monthly_amount = 50000
     WHERE user_id = (SELECT user_id FROM users WHERE household_id = h);
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T3a income 100k->50k: DTI 40, CAUTION',
                       s.dti_ratio = 40.00 AND s.current_tier = 'CAUTION');

    -- (b) DELETE a loan (original: NEW is null on delete, function returned early)
    DELETE FROM liabilities
     WHERE user_id = (SELECT user_id FROM users WHERE household_id = h);
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T3b delete loan: EMI 0, back to SAFE',
                       s.total_monthly_emi = 0 AND s.current_tier = 'SAFE');

    -- (c) paying a loan off (principal -> 0) stops its EMI counting
    h := pg_temp.mk_hh('t3c', 100000, 30000, 35000, 400000);
    PERFORM pg_temp.ok('T3c before payoff: CAUTION', pg_temp.tier_of(h) = 'CAUTION');
    UPDATE liabilities SET principal_remaining = 0
     WHERE user_id = (SELECT user_id FROM users WHERE household_id = h);
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T3c principal=0: EMI excluded, SAFE',
                       s.total_monthly_emi = 0 AND s.current_tier = 'SAFE');

    -- (d) move a user between households: BOTH snapshots must update
    hx := pg_temp.mk_hh('t3d-from', 100000, 30000, 20000, 400000);
    INSERT INTO households (household_name) VALUES ('t3d-to') RETURNING household_id INTO hy;
    UPDATE users SET household_id = hy WHERE household_id = hx;
    PERFORM pg_temp.ok('T3d old household lost the income -> FREEZE',
                       (SELECT total_monthly_income FROM financial_snapshots WHERE household_id = hx) = 0
                       AND pg_temp.tier_of(hx) = 'FREEZE');
    PERFORM pg_temp.ok('T3d new household gained income and EMI',
                       (SELECT total_monthly_income FROM financial_snapshots WHERE household_id = hy) = 100000
                       AND (SELECT total_monthly_emi FROM financial_snapshots WHERE household_id = hy) = 20000);

    -- (e) flipping is_emergency_fund changes runway
    h := pg_temp.mk_hh('t3e', 100000, 30000, 20000, 400000);
    UPDATE liquid_assets SET is_emergency_fund = FALSE WHERE household_id = h;
    PERFORM pg_temp.ok('T3e asset no longer emergency: runway 0, FREEZE',
                       (SELECT emergency_runway_months FROM financial_snapshots WHERE household_id = h) = 0
                       AND pg_temp.tier_of(h) = 'FREEZE');

    -- (f) deleting a USER cascades incomes/loans; snapshot must still refresh
    h := pg_temp.mk_hh('t3f', 100000, 30000, 20000, 400000);
    DELETE FROM users WHERE household_id = h;
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T3f user deleted (cascade): income 0, EMI 0, FREEZE',
                       s.total_monthly_income = 0 AND s.total_monthly_emi = 0 AND s.current_tier = 'FREEZE');

    -- (g) deleting a HOUSEHOLD must not error or resurrect a snapshot row
    h := pg_temp.mk_hh('t3g', 100000, 30000, 20000, 400000);
    DELETE FROM households WHERE household_id = h;
    PERFORM pg_temp.ok('T3g household delete: no snapshot left behind',
                       NOT EXISTS (SELECT 1 FROM financial_snapshots WHERE household_id = h));

    -- (h) deleting the only income row
    h := pg_temp.mk_hh('t3h', 100000, 30000, 20000, 400000);
    DELETE FROM incomes WHERE user_id = (SELECT user_id FROM users WHERE household_id = h);
    PERFORM pg_temp.ok('T3h income deleted -> FREEZE', pg_temp.tier_of(h) = 'FREEZE');

    -- (i) baseline + balance edits
    h := pg_temp.mk_hh('t3i', 100000, 30000, 20000, 400000);
    UPDATE baseline_expenses SET monthly_amount = 60000 WHERE household_id = h;
    SELECT * INTO s FROM financial_snapshots WHERE household_id = h;
    PERFORM pg_temp.ok('T3i baseline 30k->60k: surplus 20000, runway 5.00, CAUTION',
                       s.structural_surplus = 20000 AND s.emergency_runway_months = 5.00
                       AND s.current_tier = 'CAUTION');
    UPDATE liquid_assets SET current_balance = 100000 WHERE household_id = h;
    PERFORM pg_temp.ok('T3i balance 400k->100k: runway 1.25, CRITICAL',
                       (SELECT emergency_runway_months FROM financial_snapshots WHERE household_id = h) = 1.25
                       AND pg_temp.tier_of(h) = 'CRITICAL');
END $$;

\echo '--- T3: spend sync + cap override (Flow B path)'
DO $$
DECLARE h UUID; s financial_snapshots; m DATE := date_trunc('month', CURRENT_DATE)::date;
BEGIN
    h := pg_temp.mk_hh('t3j', 100000, 30000, 20000, 400000);   -- SAFE, default cap 25000
    INSERT INTO household_discretionary_monthly (household_id, month_start, discretionary_total)
        VALUES (h, m, 26000);
    PERFORM pg_temp.ok('T3j spend 26000 > cap 25000: SAFE -> CAUTION', pg_temp.tier_of(h) = 'CAUTION');

    UPDATE household_discretionary_monthly SET discretionary_total = 51000
     WHERE household_id = h AND month_start = m;
    PERFORM pg_temp.ok('T3j spend 51000 > surplus 50000: FREEZE', pg_temp.tier_of(h) = 'FREEZE');

    UPDATE household_discretionary_monthly SET discretionary_total = 1000
     WHERE household_id = h AND month_start = m;
    PERFORM pg_temp.ok('T3j spend back to 1000: recovers to SAFE', pg_temp.tier_of(h) = 'SAFE');

    INSERT INTO discretionary_caps (household_id, cap_override) VALUES (h, 500);
    PERFORM pg_temp.ok('T3j user lowers cap to 500: 1000 spend now escalates', pg_temp.tier_of(h) = 'CAUTION');

    DELETE FROM discretionary_caps WHERE household_id = h;
    PERFORM pg_temp.ok('T3j cap override removed: back to SAFE', pg_temp.tier_of(h) = 'SAFE');

    -- last month's spend must not count against this month
    INSERT INTO household_discretionary_monthly (household_id, month_start, discretionary_total)
        VALUES (h, (m - INTERVAL '1 month')::date, 99999);
    PERFORM pg_temp.ok('T3j previous month row ignored', pg_temp.tier_of(h) = 'SAFE');
END $$;

------------------------------------------------------------------------
-- T4. Constraints and integrity rules
------------------------------------------------------------------------
\echo '--- T4: database-level validation'
DO $$
DECLARE h UUID; u UUID; c UUID;
BEGIN
    h := pg_temp.mk_hh('t4', 100000, 30000, 20000, 400000);
    SELECT user_id INTO u FROM users WHERE household_id = h;

    PERFORM pg_temp.expect_error('T4 negative income rejected',
        format('INSERT INTO incomes (user_id, source_name, monthly_amount) VALUES (%L, ''x'', -5)', u), '23514');
    PERFORM pg_temp.expect_error('T4 zero income rejected',
        format('INSERT INTO incomes (user_id, source_name, monthly_amount) VALUES (%L, ''x'', 0)', u), '23514');
    PERFORM pg_temp.expect_error('T4 due day 32 rejected',
        format('INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month) VALUES (%L, ''rent'', 100, 32)', h), '23514');
    PERFORM pg_temp.expect_error('T4 pay day 0 rejected',
        format('INSERT INTO incomes (user_id, source_name, monthly_amount, pay_day_of_month) VALUES (%L, ''x'', 100, 0)', u), '23514');
    PERFORM pg_temp.expect_error('T4 penalty 150% rejected',
        format('INSERT INTO liabilities (user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, prepayment_penalty_pct) VALUES (%L, ''x'', 1000, 10, 100, 150)', u), '23514');
    PERFORM pg_temp.expect_error('T4 negative balance rejected',
        format('INSERT INTO liquid_assets (household_id, asset_name, current_balance) VALUES (%L, ''x'', -1)', h), '23514');
    PERFORM pg_temp.expect_error('T4 month_start not first-of-month rejected',
        format('INSERT INTO household_discretionary_monthly (household_id, month_start, discretionary_total) VALUES (%L, ''2026-03-15'', 10)', h), '23514');
    PERFORM pg_temp.expect_error('T4 duplicate email (different case) rejected',
        'INSERT INTO users (full_name, email, password_hash) VALUES (''dup'', ''T4@TEST.EXAMPLE'', ''x'')', '23505');
    PERFORM pg_temp.expect_error('T4 malformed email rejected',
        'INSERT INTO users (full_name, email, password_hash) VALUES (''bad'', ''not-an-email'', ''x'')', '23514');
    PERFORM pg_temp.expect_error('T4 FK: income for nonexistent user rejected',
        'INSERT INTO incomes (user_id, source_name, monthly_amount) VALUES (gen_random_uuid(), ''x'', 100)', '23503');
    PERFORM pg_temp.expect_error('T4 scenario params must be a JSON object',
        format('INSERT INTO scenarios (household_id, scenario_name, params) VALUES (%L, ''s'', ''[1,2]'')', h), '23514');

    -- coach integrity
    PERFORM pg_temp.expect_error('T4 USER cannot be assigned households',
        format('INSERT INTO coach_assignments (coach_id, household_id) VALUES (%L, %L)', u, h), 'FS002');

    INSERT INTO users (full_name, email, password_hash, role)
        VALUES ('coach', 't4coach@test.example', 'x', 'COACH') RETURNING user_id INTO c;
    INSERT INTO coach_assignments (coach_id, household_id) VALUES (c, h);
    PERFORM pg_temp.ok('T4 COACH can be assigned a household',
                       EXISTS (SELECT 1 FROM coach_assignments WHERE coach_id = c));
    PERFORM pg_temp.expect_error('T4 coach with assignments cannot be demoted',
        format('UPDATE users SET role = ''USER'' WHERE user_id = %L', c), 'FS003');

    -- updated_at trigger (start from an old timestamp; now() is frozen inside a transaction)
    INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, updated_at)
        VALUES (h, 'stale-row', 10, '2020-01-01');
    UPDATE baseline_expenses SET monthly_amount = 11 WHERE household_id = h AND category_name = 'stale-row';
    PERFORM pg_temp.ok('T4 updated_at advances on update',
                       (SELECT updated_at FROM baseline_expenses
                         WHERE household_id = h AND category_name = 'stale-row') > '2020-01-02');
END $$;

\echo '--- ALL PHASE 1 TESTS PASSED'
ROLLBACK;
