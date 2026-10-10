-- 007_vector_playbooks_and_simulator.sql
-- FinShield — Phase 4: pgvector Semantic Recovery Playbooks, What-If Scenario Simulator,
-- and 30/60/90-Day Cashflow Trajectory Forecaster.
-- Implements TRD Sections 5.1 (#11) & 5.4, PRD Features 3 & 6, and UI/UX Spec Section 4.2.

------------------------------------------------------------------------
-- 1. Vector Extension / Pure-SQL Vector Compatibility Layer (384-dim)
-- Uses native C pgvector extension when installed on the host server;
-- otherwise provides a drop-in SQL `vector` domain + `<=>` cosine distance
-- operator so `embedding <=> $1::vector` executes identically on any
-- standalone PostgreSQL 16/17/18 installation.
------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
    ELSIF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        EXECUTE 'CREATE DOMAIN vector AS float8[]';
    END IF;
END $$;

-- Cosine distance function for float8[] / domain vector: d(u,v) = 1 - (u.v)/(||u||*||v||)
CREATE OR REPLACE FUNCTION fn_vector_cosine_distance(a vector, b vector)
RETURNS float8
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE
        WHEN norm_a = 0 OR norm_b = 0 THEN 1.0::float8
        ELSE GREATEST(0.0::float8, 1.0::float8 - (dot / (sqrt(norm_a) * sqrt(norm_b))))
    END
    FROM (
        SELECT
            COALESCE(SUM(x * y), 0.0) AS dot,
            COALESCE(SUM(x * x), 0.0) AS norm_a,
            COALESCE(SUM(y * y), 0.0) AS norm_b
        FROM unnest(a::float8[], b::float8[]) AS t(x, y)
    ) s;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_operator o
        JOIN pg_type t ON o.oprleft = t.oid AND o.oprright = t.oid
        WHERE o.oprname = '<=>' AND t.typname = 'vector'
    ) THEN
        EXECUTE 'CREATE OPERATOR <=> (
            LEFTARG = vector,
            RIGHTARG = vector,
            FUNCTION = fn_vector_cosine_distance
        )';
    END IF;
END $$;

-- Helper to convert either pgvector bracket syntax '[0.1, 0.2, ...]' or
-- array brace syntax '{0.1, 0.2, ...}' into `vector`
CREATE OR REPLACE FUNCTION fn_parse_vector(p_text TEXT)
RETURNS vector
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT translate(trim(p_text), '[]', '{}')::vector;
$$;

-- Helper to deterministic-embed a 6-feature financial signal into a normalised 384-dim vector
-- Signal slots: [dti_weight, low_runway_weight, overspend_weight, deficit_weight, debt_payoff_weight, wealth_growth_weight]
CREATE OR REPLACE FUNCTION fn_build_384_embedding(
    p_w1 FLOAT8, p_w2 FLOAT8, p_w3 FLOAT8,
    p_w4 FLOAT8, p_w5 FLOAT8, p_w6 FLOAT8
)
RETURNS vector
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
    v_arr  FLOAT8[] := ARRAY[]::FLOAT8[];
    v_norm FLOAT8   := 0.0;
    v_val  FLOAT8;
    i      INT;
    v_weights FLOAT8[] := ARRAY[p_w1, p_w2, p_w3, p_w4, p_w5, p_w6];
BEGIN
    -- Project the 6 semantic financial axes across 384 dimensions (64 dims per axis)
    FOR i IN 1..384 LOOP
        v_val := v_weights[((i - 1) / 64) + 1] * (1.0 + 0.05 * cos(i::float8));
        v_arr := array_append(v_arr, v_val);
        v_norm := v_norm + (v_val * v_val);
    END LOOP;

    v_norm := sqrt(v_norm);
    IF v_norm > 0 THEN
        FOR i IN 1..384 LOOP
            v_arr[i] := round((v_arr[i] / v_norm)::numeric, 6)::float8;
        END LOOP;
    END IF;

    RETURN v_arr::vector;
END;
$$;

------------------------------------------------------------------------
-- 2. Recovery Playbooks Table (TRD Section 5.1 #11 & Section 5.4)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recovery_playbooks (
    playbook_id  SERIAL PRIMARY KEY,
    trigger_tier policy_tier  NOT NULL,
    category_tag VARCHAR(50)  NOT NULL DEFAULT 'GENERAL',
    title        VARCHAR(150) NOT NULL UNIQUE,
    content_text TEXT         NOT NULL,
    action_steps TEXT[]       NOT NULL DEFAULT '{}',
    embedding    vector       NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_playbook_embedding_384
        CHECK (array_length(embedding::float8[], 1) = 384)
);

CREATE INDEX IF NOT EXISTS idx_playbooks_tier ON recovery_playbooks (trigger_tier);

------------------------------------------------------------------------
-- 3. Semantic Guidance Retrieval Functions (TRD Section 5.4)
-- Strictly hard-filters by `trigger_tier` first so vector similarity NEVER
-- overrides deterministic PostgreSQL safety policy!
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_match_recovery_playbooks(
    p_query_embedding vector,
    p_trigger_tier    policy_tier,
    p_limit           INT DEFAULT 3
)
RETURNS TABLE (
    playbook_id      INT,
    trigger_tier     policy_tier,
    category_tag     VARCHAR(50),
    title            VARCHAR(150),
    content_text     TEXT,
    action_steps     TEXT[],
    similarity_score NUMERIC(6,4)
)
LANGUAGE sql STABLE AS $$
    SELECT
        rp.playbook_id,
        rp.trigger_tier,
        rp.category_tag,
        rp.title,
        rp.content_text,
        rp.action_steps,
        ROUND((1.0 - (rp.embedding <=> p_query_embedding))::numeric, 4) AS similarity_score
    FROM recovery_playbooks rp
    WHERE rp.trigger_tier = p_trigger_tier
    ORDER BY rp.embedding <=> p_query_embedding ASC, rp.playbook_id ASC
    LIMIT GREATEST(COALESCE(p_limit, 3), 1);
$$;

-- Derives a 384-dim semantic query vector directly from a household's live
-- financial snapshot metrics (DTI, runway, overspend, deficit) and retrieves
-- the top matching playbooks for that household's active tier.
CREATE OR REPLACE FUNCTION fn_get_playbooks_for_household(
    p_household_id    UUID,
    p_custom_query_vec vector DEFAULT NULL,
    p_limit           INT DEFAULT 3
)
RETURNS TABLE (
    playbook_id      INT,
    trigger_tier     policy_tier,
    category_tag     VARCHAR(50),
    title            VARCHAR(150),
    content_text     TEXT,
    action_steps     TEXT[],
    similarity_score NUMERIC(6,4)
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    s      financial_snapshots;
    v_qvec vector;
    v_w_dti       FLOAT8 := 0.1;
    v_w_runway    FLOAT8 := 0.1;
    v_w_overspend FLOAT8 := 0.1;
    v_w_deficit   FLOAT8 := 0.1;
    v_w_debt      FLOAT8 := 0.1;
    v_w_wealth    FLOAT8 := 0.1;
BEGIN
    SELECT * INTO s FROM financial_snapshots WHERE household_id = p_household_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_custom_query_vec IS NOT NULL THEN
        v_qvec := p_custom_query_vec;
    ELSE
        -- Map household stress signals into semantic axes
        IF COALESCE(s.dti_ratio, 0) > 45 THEN v_w_dti := 1.0; v_w_debt := 0.9;
        ELSIF COALESCE(s.dti_ratio, 0) > 30 THEN v_w_dti := 0.8; v_w_debt := 0.7;
        END IF;

        IF s.emergency_runway_months < 1 THEN v_w_runway := 1.0;
        ELSIF s.emergency_runway_months < 3 THEN v_w_runway := 0.9;
        ELSIF s.emergency_runway_months < 6 THEN v_w_runway := 0.75;
        END IF;

        IF s.discretionary_mtd > s.discretionary_cap AND s.discretionary_cap > 0 THEN
            v_w_overspend := 0.95;
        END IF;

        IF s.structural_surplus < 0 OR s.discretionary_mtd > s.structural_surplus THEN
            v_w_deficit := 1.0;
        END IF;

        IF s.current_tier = 'SAFE' THEN
            v_w_wealth := 1.0;
            v_w_debt   := CASE WHEN s.total_monthly_emi > 0 THEN 0.6 ELSE 0.2 END;
        END IF;

        v_qvec := fn_build_384_embedding(
            v_w_dti, v_w_runway, v_w_overspend, v_w_deficit, v_w_debt, v_w_wealth
        );
    END IF;

    RETURN QUERY
    SELECT * FROM fn_match_recovery_playbooks(v_qvec, s.current_tier, p_limit);
END;
$$;

------------------------------------------------------------------------
-- 4. Seed Curated Recovery Playbooks (12 Playbooks: 3 per Policy Tier)
------------------------------------------------------------------------
INSERT INTO recovery_playbooks (trigger_tier, category_tag, title, content_text, action_steps, embedding)
VALUES
    -- FREEZE TIER PLAYBOOKS
    (
        'FREEZE',
        'CASHFLOW_DEFICIT',
        'Emergency Cashflow Deficit & Insolvency Triage',
        'Your monthly outflow exceeds incoming cash flow or discretionary burn has breached total monthly surplus. Immediate expenditure lockdown is required to protect essential housing and utility commitments.',
        ARRAY[
            'Halt all non-essential discretionary spending for the remainder of the billing cycle',
            'Cancel or pause recurring digital subscriptions and lifestyle memberships immediately',
            'Contact non-collateral lenders to request a 30-day hardship payment deferral'
        ],
        fn_build_384_embedding(0.3, 0.6, 0.8, 1.0, 0.3, 0.0)
    ),
    (
        'FREEZE',
        'DEPLETED_RUNWAY',
        'Sub-30-Day Survival Runway Restoration Protocol',
        'Liquid emergency reserves have fallen below 1.0 month of baseline survival costs. Any unexpected shock risks immediate default on rent or EMIs.',
        ARRAY[
            'Redirect 100% of upcoming salary surplus into the designated liquid emergency account',
            'Liquidate non-essential secondary holdings or idle items to establish a 1-month floor',
            'Strict FS001 lockout active: zero equity or speculative transfers permitted'
        ],
        fn_build_384_embedding(0.2, 1.0, 0.3, 0.8, 0.2, 0.0)
    ),
    (
        'FREEZE',
        'INCOME_LOSS',
        'Primary Income Interruption & Survival Budget Mode',
        'Household income is zero or severely disrupted. Transition immediately to bare-bones baseline survival mode to maximise remaining liquid runway days.',
        ARRAY[
            'Switch household budget to strictly cover rent, essential groceries, and basic utilities',
            'File formal EMI moratorium or restructuring requests with primary loan servicers',
            'Draw down liquid emergency reserves strictly on scheduled baseline due dates'
        ],
        fn_build_384_embedding(0.4, 0.9, 0.1, 1.0, 0.4, 0.0)
    ),

    -- CRITICAL TIER PLAYBOOKS
    (
        'CRITICAL',
        'HIGH_DTI_MITIGATION',
        'High DTI (>45%) Debt Avalanche Acceleration',
        'Debt-to-Income ratio exceeds the 45% critical threshold. Debt servicing is consuming nearly half of gross household income, creating severe vulnerability.',
        ARRAY[
            'Execute Debt Avalanche: route 100% of surplus toward the highest-APR liability first',
            'Avoid taking any new BNPL, credit card EMI, or personal loan obligations',
            'Evaluate debt consolidation only if effective APR drops by at least 400 basis points'
        ],
        fn_build_384_embedding(1.0, 0.3, 0.2, 0.2, 1.0, 0.0)
    ),
    (
        'CRITICAL',
        'LOW_RUNWAY_REBUILD',
        'Critical Emergency Buffer Rebuild (1 to 3 Months Runway)',
        'Emergency reserves cover less than 3 months of mandatory baseline expenses and EMIs. Wealth creation allocations are paused until the 3-month safety floor is restored.',
        ARRAY[
            'Automate a Pay-Yourself-First transfer on salary day directly into the emergency fund',
            'Cap variable discretionary spending to 25% of structural surplus until runway reaches 3.0 months',
            'Keep emergency reserves in instant-liquidity savings or sweep FD accounts'
        ],
        fn_build_384_embedding(0.2, 1.0, 0.3, 0.3, 0.3, 0.0)
    ),
    (
        'CRITICAL',
        'OVERSPEND_ESCALATION',
        'Caution-to-Critical Discretionary Overspend Recovery',
        'Excessive month-to-date variable spending pushed an already vulnerable household from CAUTION into CRITICAL status.',
        ARRAY[
            'Review top discretionary merchant categories from the current month spend breakdown',
            'Enforce a 14-day cooling-off rule on all non-essential online and retail purchases',
            'Use the custom discretionary cap override to lock a stricter monthly spend ceiling'
        ],
        fn_build_384_embedding(0.5, 0.5, 1.0, 0.4, 0.4, 0.0)
    ),

    -- CAUTION TIER PLAYBOOKS
    (
        'CAUTION',
        'MODERATE_DTI_OPTIMIZATION',
        'Moderate DTI (30% to 45%) Prepayment & Snowball Momentum',
        'DTI ratio sits in the 30-45% caution band. Equity allocations are capped at 25% while the remaining 75% of surplus strengthens reserves and retires debt.',
        ARRAY[
            'Compare Avalanche vs Snowball schedules in the Debt Optimizer panel',
            'Check loan prepayment penalty clauses before making lump-sum principal reductions',
            'Route at least 45% of monthly surplus to liquid emergency reserves'
        ],
        fn_build_384_embedding(0.85, 0.3, 0.2, 0.1, 0.85, 0.2)
    ),
    (
        'CAUTION',
        'RUNWAY_EXPANSION',
        'Mid-Tier Runway Expansion (3 to 6 Months Buffer)',
        'Your household has passed the 3-month survival mark but remains below the 6-month gold-standard resilience buffer.',
        ARRAY[
            'Maintain equity SIPs at the 25% Caution cap while directing 50% of surplus to reserves',
            'Audit mandatory baseline expenses (utilities, insurance) for annual cost reductions',
            'Unlock full 100% strategic wealth allocation once runway reaches 6.0 months'
        ],
        fn_build_384_embedding(0.2, 0.9, 0.2, 0.1, 0.2, 0.4)
    ),
    (
        'CAUTION',
        'CAP_BREACH_GUARDRAIL',
        'Monthly Discretionary Cap Breach Containment',
        'Your core fundamentals are healthy, but month-to-date discretionary spending exceeded 50% of your structural surplus, elevating your tier to CAUTION.',
        ARRAY[
            'Hold discretionary spending flat for the remaining days of the current month',
            'Reconcile any shared group bills or refunds so net discretionary spend reflects reality',
            'Tier will automatically restore to SAFE on the 1st of next month if fundamentals hold'
        ],
        fn_build_384_embedding(0.1, 0.2, 1.0, 0.2, 0.1, 0.3)
    ),

    -- SAFE TIER PLAYBOOKS
    (
        'SAFE',
        'STRATEGIC_WEALTH',
        'Age-Aligned Strategic Asset Allocation & Compounding',
        'Your household maintains a 6+ month emergency runway and a low DTI ratio (<30%). Full strategic wealth allocation is unlocked.',
        ARRAY[
            'Deploy monthly surplus across Large-Cap/Index Equity, Debt Instruments, and Gold per risk profile',
            'Rebalance portfolio allocations semi-annually or after major income milestones',
            'Keep emergency fund isolated from market volatility in liquid high-yield instruments'
        ],
        fn_build_384_embedding(0.1, 0.1, 0.1, 0.0, 0.1, 1.0)
    ),
    (
        'SAFE',
        'LOW_RATE_DEBT_ARBITRAGE',
        'Strategic Prepayment vs Investment Arbitrage',
        'While in SAFE tier with low-to-moderate EMI obligations, optimise between early loan closure and long-term market compounding.',
        ARRAY[
            'Prepay any remaining debt carrying an effective interest rate above 10% APR',
            'Account for prepayment penalty percentages before executing lump-sum closures',
            'Channel freed-up EMI cash flow directly into automated monthly investment SIPs'
        ],
        fn_build_384_embedding(0.3, 0.1, 0.1, 0.0, 0.8, 0.8)
    ),
    (
        'SAFE',
        'DUAL_INCOME_RESILIENCE',
        'Dual-Earner Stress Testing & Inflation Shielding',
        'Use your position of strength to stress-test household resilience against single-earner income interruption or baseline cost inflation.',
        ARRAY[
            'Run the What-If Scenario Simulator with primary earner income drop enabled',
            'Verify that emergency runway stays above 3.0 months even under a 15% rent increase',
            'Update baseline expense figures annually to keep runway math accurate against inflation'
        ],
        fn_build_384_embedding(0.1, 0.4, 0.1, 0.1, 0.2, 0.9)
    )
ON CONFLICT (title) DO NOTHING;

------------------------------------------------------------------------
-- 5. Non-Destructive What-If Scenario Simulator (PRD Feature 3)
-- Reuses the pure `fn_classify_tier` function from Phase 1.
-- Marked STABLE (read-only): guaranteed by PostgreSQL never to modify live data.
-- Supported JSONB `p_params` keys:
--   - income_delta          NUMERIC (e.g. -20000 or +15000)
--   - income_pct_change     NUMERIC (e.g. -25 for a 25% pay cut)
--   - drop_primary_earner   BOOLEAN (simulates losing primary earner's income)
--   - baseline_delta        NUMERIC (e.g. +5000)
--   - baseline_pct_change   NUMERIC (e.g. +15 for a 15% rent/living hike)
--   - emi_delta             NUMERIC (e.g. +8000 for a new loan EMI or penalty)
--   - reserve_delta         NUMERIC (e.g. -150000 for an emergency medical shock)
--   - simulated_disc_mtd    NUMERIC (override month-to-date discretionary spend)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_simulate_scenario(
    p_household_id UUID,
    p_params       JSONB DEFAULT '{}'::JSONB
)
RETURNS TABLE (
    household_id            UUID,
    live_income             NUMERIC(14,2),
    sim_income              NUMERIC(14,2),
    live_baseline           NUMERIC(14,2),
    sim_baseline            NUMERIC(14,2),
    live_emi                NUMERIC(14,2),
    sim_emi                 NUMERIC(14,2),
    live_reserves           NUMERIC(14,2),
    sim_reserves            NUMERIC(14,2),
    live_surplus            NUMERIC(14,2),
    sim_surplus             NUMERIC(14,2),
    live_runway_months      NUMERIC(10,2),
    sim_runway_months       NUMERIC(10,2),
    live_dti_ratio          NUMERIC(10,2),
    sim_dti_ratio           NUMERIC(10,2),
    live_rigidity_ratio     NUMERIC(10,2),
    sim_rigidity_ratio      NUMERIC(10,2),
    live_tier               policy_tier,
    sim_tier                policy_tier,
    tier_changed            BOOLEAN,
    sim_tier_reasons        TEXT[]
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    s              financial_snapshots;
    v_primary_inc  NUMERIC := 0;
    v_sim_inc      NUMERIC;
    v_sim_base     NUMERIC;
    v_sim_emi      NUMERIC;
    v_sim_res      NUMERIC;
    v_sim_disc     NUMERIC;
    v_cap_override NUMERIC;
    r_sim          RECORD;
BEGIN
    SELECT * INTO s FROM financial_snapshots fs WHERE fs.household_id = p_household_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Household % does not exist or has no snapshot', p_household_id
            USING ERRCODE = 'P0002';
    END IF;

    SELECT cap_override INTO v_cap_override
    FROM discretionary_caps dc WHERE dc.household_id = p_household_id;

    -- Start from live numbers
    v_sim_inc  := s.total_monthly_income;
    v_sim_base := s.total_baseline_costs;
    v_sim_emi  := s.total_monthly_emi;
    v_sim_res  := s.total_liquid_reserves;
    v_sim_disc := s.discretionary_mtd;

    -- 1. Optional: Drop primary earner income stream(s)
    IF COALESCE((p_params->>'drop_primary_earner')::boolean, FALSE) IS TRUE THEN
        SELECT COALESCE(SUM(i.monthly_amount), 0) INTO v_primary_inc
        FROM incomes i
        JOIN users u ON u.user_id = i.user_id
        WHERE u.household_id = p_household_id AND i.is_primary_earner = TRUE;

        v_sim_inc := GREATEST(v_sim_inc - v_primary_inc, 0);
    END IF;

    -- 2. Income percentage & absolute adjustments
    IF p_params ? 'income_pct_change' THEN
        v_sim_inc := v_sim_inc * (1.0 + ((p_params->>'income_pct_change')::numeric / 100.0));
    END IF;
    IF p_params ? 'income_delta' THEN
        v_sim_inc := v_sim_inc + (p_params->>'income_delta')::numeric;
    END IF;
    v_sim_inc := GREATEST(round(v_sim_inc, 2), 0);

    -- 3. Baseline cost percentage & absolute adjustments (e.g. 15% rent increase)
    IF p_params ? 'baseline_pct_change' THEN
        v_sim_base := v_sim_base * (1.0 + ((p_params->>'baseline_pct_change')::numeric / 100.0));
    END IF;
    IF p_params ? 'baseline_delta' THEN
        v_sim_base := v_sim_base + (p_params->>'baseline_delta')::numeric;
    END IF;
    v_sim_base := GREATEST(round(v_sim_base, 2), 0);

    -- 4. EMI / penalty adjustments
    IF p_params ? 'emi_delta' THEN
        v_sim_emi := v_sim_emi + (p_params->>'emi_delta')::numeric;
    END IF;
    v_sim_emi := GREATEST(round(v_sim_emi, 2), 0);

    -- 5. Liquid emergency reserve shock (e.g. unplanned medical expenditure)
    IF p_params ? 'reserve_delta' THEN
        v_sim_res := v_sim_res + (p_params->>'reserve_delta')::numeric;
    END IF;
    v_sim_res := GREATEST(round(v_sim_res, 2), 0);

    -- 6. Simulated discretionary MTD spend
    IF p_params ? 'simulated_disc_mtd' THEN
        v_sim_disc := GREATEST((p_params->>'simulated_disc_mtd')::numeric, 0);
    END IF;

    -- Evaluate simulated state using the exact pure classifier from Phase 1
    SELECT * INTO r_sim
    FROM fn_classify_tier(v_sim_inc, v_sim_base, v_sim_emi, v_sim_res, v_sim_disc, v_cap_override);

    RETURN QUERY SELECT
        s.household_id,
        s.total_monthly_income,
        v_sim_inc::numeric(14,2),
        s.total_baseline_costs,
        v_sim_base::numeric(14,2),
        s.total_monthly_emi,
        v_sim_emi::numeric(14,2),
        s.total_liquid_reserves,
        v_sim_res::numeric(14,2),
        s.structural_surplus,
        r_sim.structural_surplus::numeric(14,2),
        s.emergency_runway_months,
        r_sim.emergency_runway_months::numeric(10,2),
        s.dti_ratio,
        r_sim.dti_ratio::numeric(10,2),
        s.rigidity_ratio,
        r_sim.rigidity_ratio::numeric(10,2),
        s.current_tier,
        r_sim.tier,
        (s.current_tier IS DISTINCT FROM r_sim.tier),
        r_sim.tier_reasons;
END;
$$;

-- Convenience wrapper to execute a persisted scenario from the `scenarios` table by ID
CREATE OR REPLACE FUNCTION fn_run_saved_scenario(p_scenario_id UUID)
RETURNS TABLE (
    scenario_id             UUID,
    scenario_name           VARCHAR(100),
    household_id            UUID,
    live_tier               policy_tier,
    sim_tier                policy_tier,
    tier_changed            BOOLEAN,
    live_runway_months      NUMERIC(10,2),
    sim_runway_months       NUMERIC(10,2),
    live_dti_ratio          NUMERIC(10,2),
    sim_dti_ratio           NUMERIC(10,2),
    live_surplus            NUMERIC(14,2),
    sim_surplus             NUMERIC(14,2),
    sim_tier_reasons        TEXT[]
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_sc scenarios;
BEGIN
    SELECT * INTO v_sc FROM scenarios WHERE scenarios.scenario_id = p_scenario_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Scenario % not found', p_scenario_id USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    SELECT
        v_sc.scenario_id,
        v_sc.scenario_name,
        sim.household_id,
        sim.live_tier,
        sim.sim_tier,
        sim.tier_changed,
        sim.live_runway_months,
        sim.sim_runway_months,
        sim.live_dti_ratio,
        sim.sim_dti_ratio,
        sim.live_surplus,
        sim.sim_surplus,
        sim.sim_tier_reasons
    FROM fn_simulate_scenario(v_sc.household_id, v_sc.params) sim;
END;
$$;

------------------------------------------------------------------------
-- 6. 30/60/90-Day Cashflow Trajectory Forecaster (PRD Feature 3 & Migration 004)
-- Projects daily cash balance over `p_horizon_days` (default 90 days) using:
--   - `incomes.pay_day_of_month` (default day 1)
--   - `baseline_expenses.due_day_of_month` (default day 5)
--   - `liabilities.emi_due_day` (default day 10) & `remaining_tenure_months`
-- Flags any day where `projected_balance < 0` (`is_deficit = TRUE`).
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_forecast_cashflow_90d(
    p_household_id UUID,
    p_horizon_days INT DEFAULT 90,
    p_start_date   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    day_offset        INT,
    forecast_date     DATE,
    daily_inflow      NUMERIC(14,2),
    daily_outflow     NUMERIC(14,2),
    net_daily_flow    NUMERIC(14,2),
    projected_balance NUMERIC(14,2),
    is_deficit        BOOLEAN
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_running_bal NUMERIC(14,2);
    v_date        DATE;
    v_dom         INT;
    v_last_dom    INT;
    v_months_elapsed INT;
    v_inflow      NUMERIC(14,2);
    v_base_out    NUMERIC(14,2);
    v_emi_out     NUMERIC(14,2);
    v_outflow     NUMERIC(14,2);
    d             INT;
BEGIN
    -- Starting liquidity is the household's total liquid reserves
    SELECT COALESCE(SUM(current_balance), 0) INTO v_running_bal
    FROM liquid_assets
    WHERE household_id = p_household_id AND is_emergency_fund = TRUE;

    FOR d IN 1..GREATEST(COALESCE(p_horizon_days, 90), 1) LOOP
        v_date := p_start_date + (d - 1);
        v_dom  := EXTRACT(DAY FROM v_date)::INT;
        -- Last day of v_date's month (so due_day 31 triggers on the last day of 28/30-day months)
        v_last_dom := EXTRACT(DAY FROM (date_trunc('month', v_date) + INTERVAL '1 month - 1 day'))::INT;

        v_months_elapsed :=
            (EXTRACT(YEAR FROM v_date)::INT - EXTRACT(YEAR FROM p_start_date)::INT) * 12
            + (EXTRACT(MONTH FROM v_date)::INT - EXTRACT(MONTH FROM p_start_date)::INT);

        -- 1. Inflows scheduled on this day of month (default pay_day_of_month = 1)
        SELECT COALESCE(SUM(i.monthly_amount), 0) INTO v_inflow
        FROM incomes i
        JOIN users u ON u.user_id = i.user_id
        WHERE u.household_id = p_household_id
          AND (
              COALESCE(i.pay_day_of_month, 1) = v_dom
              OR (v_dom = v_last_dom AND COALESCE(i.pay_day_of_month, 1) > v_last_dom)
          );

        -- 2. Mandatory baseline expenses scheduled on this day of month (default due_day = 5)
        SELECT COALESCE(SUM(b.monthly_amount), 0) INTO v_base_out
        FROM baseline_expenses b
        WHERE b.household_id = p_household_id
          AND (
              COALESCE(b.due_day_of_month, 5) = v_dom
              OR (v_dom = v_last_dom AND COALESCE(b.due_day_of_month, 5) > v_last_dom)
          );

        -- 3. Active Loan EMIs scheduled on this day of month (default emi_due_day = 10)
        --    Respects `remaining_tenure_months`: once a loan's remaining tenure is exhausted, it stops billing!
        SELECT COALESCE(SUM(l.monthly_emi), 0) INTO v_emi_out
        FROM liabilities l
        JOIN users u ON u.user_id = l.user_id
        WHERE u.household_id = p_household_id
          AND l.principal_remaining > 0
          AND (l.remaining_tenure_months IS NULL OR l.remaining_tenure_months > v_months_elapsed)
          AND (
              COALESCE(l.emi_due_day, 10) = v_dom
              OR (v_dom = v_last_dom AND COALESCE(l.emi_due_day, 10) > v_last_dom)
          );

        v_outflow     := v_base_out + v_emi_out;
        v_running_bal := v_running_bal + v_inflow - v_outflow;

        day_offset        := d;
        forecast_date     := v_date;
        daily_inflow      := v_inflow;
        daily_outflow     := v_outflow;
        net_daily_flow    := v_inflow - v_outflow;
        projected_balance := v_running_bal;
        is_deficit        := (v_running_bal < 0);
        RETURN NEXT;
    END LOOP;
END;
$$;

------------------------------------------------------------------------
-- 7. Multi-Tenant RLS on Scenarios & Recovery Playbooks
------------------------------------------------------------------------
ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenarios FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_scenarios_isolation ON scenarios;
CREATE POLICY p_scenarios_isolation ON scenarios
    FOR ALL USING (fn_rls_has_household_access(household_id));

ALTER TABLE recovery_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_playbooks FORCE ROW LEVEL SECURITY;

-- All authenticated users/coaches/admins can read playbooks; only ADMIN or migration bypass can mutate
DROP POLICY IF EXISTS p_playbooks_read ON recovery_playbooks;
CREATE POLICY p_playbooks_read ON recovery_playbooks
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS p_playbooks_write ON recovery_playbooks;
CREATE POLICY p_playbooks_write ON recovery_playbooks
    FOR ALL USING (fn_rls_is_bypass())
    WITH CHECK (fn_rls_is_bypass());
