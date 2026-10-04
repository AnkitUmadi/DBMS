-- 005_gatekeeper_and_allocations.sql
-- FinShield — Phase 2: Allocation Gatekeeper, Stored Procedures, Audit Logs, and RLS
-- Implements Phase 0 Spec / TRD Section 5.2 & App Flow C & D.
--
-- Custom SQLSTATE codes used:
--   FS001  Action blocked by FinShield Gatekeeper (allocation exceeds tier safety cap)
--   FS002  coach_assignments.coach_id is not a COACH/ADMIN (from Phase 1)
--   FS003  role change would orphan existing coach assignments (from Phase 1)

------------------------------------------------------------------------
-- 1. Policy Override Audit Logs (TRD Section 5.1 #10)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS policy_audit_logs (
    log_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    attempted_action VARCHAR(100) NOT NULL,
    enforced_tier    policy_tier  NOT NULL,
    action_blocked   BOOLEAN      NOT NULL,
    override_reason  TEXT,
    logged_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON policy_audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_tier   ON policy_audit_logs (enforced_tier);
CREATE INDEX IF NOT EXISTS idx_audit_logged ON policy_audit_logs (logged_at DESC);

------------------------------------------------------------------------
-- 2. Asset Allocations Model (TRD Flow C)
-- Represents planned/active portfolio allocations constrained by tier.
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset_allocations (
    allocation_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id    UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    created_by      UUID NOT NULL REFERENCES users(user_id)           ON DELETE CASCADE,
    equity_pct      NUMERIC(5,2) NOT NULL CHECK (equity_pct BETWEEN 0 AND 100),
    debt_pct        NUMERIC(5,2) NOT NULL CHECK (debt_pct BETWEEN 0 AND 100),
    emergency_pct   NUMERIC(5,2) NOT NULL CHECK (emergency_pct BETWEEN 0 AND 100),
    is_override     BOOLEAN      NOT NULL DEFAULT FALSE,
    override_reason TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT chk_total_allocation
        CHECK ((equity_pct + debt_pct + emergency_pct) = 100.00),
    CONSTRAINT chk_override_reason_required
        CHECK (is_override = FALSE OR (override_reason IS NOT NULL AND length(trim(override_reason)) >= 5))
);
CREATE INDEX IF NOT EXISTS idx_allocations_household ON asset_allocations (household_id);

DROP TRIGGER IF EXISTS trg_allocations_touch ON asset_allocations;
CREATE TRIGGER trg_allocations_touch
    BEFORE UPDATE ON asset_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

------------------------------------------------------------------------
-- 3. Allocation Policy Gatekeeper Trigger (FS001)
-- Intercepts any proposed asset allocation before INSERT or UPDATE.
-- Evaluates snapshot tier:
--   SAFE:             Full equity allocation permitted (up to 100%).
--   CAUTION:          Equity capped at 25.00%. Excess must route to buffer.
--   CRITICAL / FREEZE: Equity capped at 0.00%. 100% of surplus to buffer/debt.
-- Overrides are permitted only with an explicit override_reason.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_allocation_policy()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_tier policy_tier;
BEGIN
    -- Query the current tier from the household's snapshot
    SELECT current_tier INTO v_tier
    FROM financial_snapshots
    WHERE household_id = NEW.household_id;

    -- If no snapshot exists yet, default to safest stance (FREEZE)
    IF v_tier IS NULL THEN
        v_tier := 'FREEZE';
    END IF;

    -- Gatekeeper Rule Evaluation
    IF v_tier IN ('CRITICAL', 'FREEZE') THEN
        IF NEW.equity_pct > 0.00 THEN
            IF NEW.is_override = FALSE THEN
                RAISE EXCEPTION 'Action blocked by FinShield Gatekeeper: Household is in % tier. Wealth/equity allocations are restricted (equity_pct must be 0.00%%). 100%% of surplus must be routed to emergency reserves or debt.', v_tier
                    USING ERRCODE = 'FS001';
            END IF;
        END IF;
    ELSIF v_tier = 'CAUTION' THEN
        IF NEW.equity_pct > 25.00 THEN
            IF NEW.is_override = FALSE THEN
                RAISE EXCEPTION 'Action blocked by FinShield Gatekeeper: Household is in CAUTION tier. Equity allocation is capped at 25.00%% (attempted: %s%%). Surplus must prioritize emergency runway.', NEW.equity_pct
                    USING ERRCODE = 'FS001';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gatekeeper_allocation ON asset_allocations;
CREATE TRIGGER trg_gatekeeper_allocation
    BEFORE INSERT OR UPDATE ON asset_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_enforce_allocation_policy();

------------------------------------------------------------------------
-- 4. Audit Log Trigger for Overrides & Actions
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_allocation_action()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_tier policy_tier;
BEGIN
    SELECT current_tier INTO v_tier
    FROM financial_snapshots
    WHERE household_id = NEW.household_id;

    IF NEW.is_override = TRUE THEN
        INSERT INTO policy_audit_logs (
            user_id, attempted_action, enforced_tier, action_blocked, override_reason
        ) VALUES (
            NEW.created_by,
            'MANUAL_ALLOCATION_OVERRIDE',
            COALESCE(v_tier, 'FREEZE'),
            FALSE,
            NEW.override_reason
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_allocation_action ON asset_allocations;
CREATE TRIGGER trg_audit_allocation_action
    AFTER INSERT OR UPDATE ON asset_allocations
    FOR EACH ROW EXECUTE FUNCTION fn_audit_allocation_action();

------------------------------------------------------------------------
-- 5. Stored Function: sp_evaluate_allocation_policy
-- Evaluates allocation policy for the UI Explainability Modal.
-- Returns allowed equity limits, status ('ALLOWED', 'CAPPED', 'BLOCKED'),
-- recommended breakdown, and propagates tier_reasons TEXT[].
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sp_evaluate_allocation_policy(
    p_household_id     UUID,
    p_requested_equity NUMERIC DEFAULT NULL
)
RETURNS TABLE (
    household_id          UUID,
    current_tier          policy_tier,
    action_status         TEXT,
    allowed_equity_max    NUMERIC(5,2),
    recommended_equity    NUMERIC(5,2),
    recommended_debt      NUMERIC(5,2),
    recommended_emergency NUMERIC(5,2),
    policy_message        TEXT,
    tier_reasons          TEXT[]
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_tier          policy_tier;
    v_reasons       TEXT[];
    v_age           INT;
    v_appetite      risk_appetite;
    v_target_equity NUMERIC(5,2);
    v_status        TEXT;
    v_allowed_max   NUMERIC(5,2);
    v_rec_eq        NUMERIC(5,2);
    v_rec_debt      NUMERIC(5,2);
    v_rec_emerg     NUMERIC(5,2);
    v_msg           TEXT;
BEGIN
    -- 1. Read snapshot
    SELECT fs.current_tier, fs.tier_reasons
    INTO v_tier, v_reasons
    FROM financial_snapshots fs
    WHERE fs.household_id = p_household_id;

    IF v_tier IS NULL THEN
        v_tier    := 'FREEZE';
        v_reasons := ARRAY['No financial snapshot found for household'];
    END IF;

    -- 2. Read primary user risk profile for baseline asset mix
    SELECT rp.age, rp.risk_appetite
    INTO v_age, v_appetite
    FROM users u
    JOIN risk_profiles rp ON u.user_id = rp.user_id
    WHERE u.household_id = p_household_id
    ORDER BY u.created_at ASC
    LIMIT 1;

    -- Baseline formula: (100 - age) adjusted by risk appetite
    v_target_equity := GREATEST(LEAST(100 - COALESCE(v_age, 35), 80), 20);
    IF v_appetite = 'AGGRESSIVE' THEN
        v_target_equity := LEAST(v_target_equity + 10.00, 90.00);
    ELSIF v_appetite = 'CONSERVATIVE' THEN
        v_target_equity := GREATEST(v_target_equity - 10.00, 15.00);
    END IF;

    -- 3. Apply Tier Policy Gatekeeper constraints
    CASE v_tier
        WHEN 'SAFE' THEN
            v_allowed_max := 100.00;
            v_status      := 'ALLOWED';
            v_rec_eq      := v_target_equity;
            v_rec_debt    := 20.00;
            v_rec_emerg   := 100.00 - v_rec_eq - v_rec_debt;
            v_msg         := 'Full strategic wealth allocation permitted based on risk profile.';

        WHEN 'CAUTION' THEN
            v_allowed_max := 25.00;
            IF p_requested_equity IS NOT NULL AND p_requested_equity > 25.00 THEN
                v_status := 'CAPPED';
            ELSE
                v_status := 'ALLOWED';
            END IF;
            v_rec_eq    := 25.00;
            v_rec_debt  := 35.00;
            v_rec_emerg := 40.00;
            v_msg       := 'Equity allocation capped at 25.00%. Unallocated surplus routed to emergency reserves.';

        WHEN 'CRITICAL' THEN
            v_allowed_max := 0.00;
            v_status      := 'BLOCKED';
            v_rec_eq      := 0.00;
            v_rec_debt    := 50.00;
            v_rec_emerg   := 50.00;
            v_msg         := 'All wealth creation investments are blocked until DTI drops below 45% and emergency runway exceeds 3 months.';

        WHEN 'FREEZE' THEN
            v_allowed_max := 0.00;
            v_status      := 'BLOCKED';
            v_rec_eq      := 0.00;
            v_rec_debt    := 0.00;
            v_rec_emerg   := 100.00;
            v_msg         := 'Complete capital preservation freeze. 100% of available surplus directed to baseline liquidity survival.';
    END CASE;

    RETURN QUERY SELECT
        p_household_id,
        v_tier,
        v_status,
        v_allowed_max,
        v_rec_eq,
        v_rec_debt,
        v_rec_emerg,
        v_msg,
        v_reasons;
END;
$$;

------------------------------------------------------------------------
-- 6. Stored Procedure: sp_generate_debt_plan (TRD Section 5.2 #2)
-- Executes payoff prioritization logic for AVALANCHE and SNOWBALL strategies.
------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_generate_debt_plan(
    IN p_user_id       UUID,
    IN p_strategy      debt_strategy,
    IN p_extra_surplus NUMERIC(12,2)
)
LANGUAGE plpgsql AS $$
DECLARE
    r_debt RECORD;
BEGIN
    IF p_strategy = 'AVALANCHE' THEN
        FOR r_debt IN
            SELECT debt_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi
            FROM liabilities
            WHERE user_id = p_user_id AND principal_remaining > 0
            ORDER BY annual_interest_rate DESC, principal_remaining ASC
        LOOP
            RAISE NOTICE '[AVALANCHE] Debt: %, Rate: % pct, Remaining: %, EMI: %',
                r_debt.lender_name, r_debt.annual_interest_rate, r_debt.principal_remaining, r_debt.monthly_emi;
        END LOOP;
    ELSIF p_strategy = 'SNOWBALL' THEN
        FOR r_debt IN
            SELECT debt_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi
            FROM liabilities
            WHERE user_id = p_user_id AND principal_remaining > 0
            ORDER BY principal_remaining ASC, annual_interest_rate DESC
        LOOP
            RAISE NOTICE '[SNOWBALL] Debt: %, Remaining: %, Rate: % pct, EMI: %',
                r_debt.lender_name, r_debt.principal_remaining, r_debt.annual_interest_rate, r_debt.monthly_emi;
        END LOOP;
    END IF;
END;
$$;

------------------------------------------------------------------------
-- Companion Function: fn_get_debt_payoff_schedule
-- Returns a queryable schedule with priority ranks and extra allocation.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_get_debt_payoff_schedule(
    p_user_id       UUID,
    p_strategy      debt_strategy,
    p_extra_surplus NUMERIC(12,2) DEFAULT 0.00
)
RETURNS TABLE (
    priority_rank       INT,
    debt_id             UUID,
    lender_name         VARCHAR(100),
    principal_remaining NUMERIC(14,2),
    annual_rate         NUMERIC(6,2),
    monthly_emi         NUMERIC(14,2),
    extra_payment_alloc NUMERIC(14,2),
    total_monthly_pay   NUMERIC(14,2)
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH ranked_debts AS (
        SELECT
            l.debt_id,
            l.lender_name,
            l.principal_remaining,
            l.annual_interest_rate,
            l.monthly_emi,
            CASE
                WHEN p_strategy = 'AVALANCHE' THEN
                    ROW_NUMBER() OVER (ORDER BY l.annual_interest_rate DESC, l.principal_remaining ASC)::INT
                ELSE
                    ROW_NUMBER() OVER (ORDER BY l.principal_remaining ASC, l.annual_interest_rate DESC)::INT
            END AS rnk
        FROM liabilities l
        WHERE l.user_id = p_user_id AND l.principal_remaining > 0
    )
    SELECT
        rnk,
        rd.debt_id,
        rd.lender_name,
        rd.principal_remaining,
        rd.annual_interest_rate,
        rd.monthly_emi,
        CASE WHEN rnk = 1 THEN GREATEST(p_extra_surplus, 0.00) ELSE 0.00 END AS extra_alloc,
        rd.monthly_emi + (CASE WHEN rnk = 1 THEN GREATEST(p_extra_surplus, 0.00) ELSE 0.00 END) AS total_pay
    FROM ranked_debts rd
    ORDER BY rnk ASC;
END;
$$;

------------------------------------------------------------------------
-- 7. Complex Analytical View: view_high_risk_households (TRD Section 5.2 #3)
-- Coaches query this to inspect the most vulnerable cohorts.
------------------------------------------------------------------------
CREATE OR REPLACE VIEW view_high_risk_households AS
SELECT
    h.household_id,
    h.household_name,
    fs.total_monthly_income,
    fs.total_monthly_emi,
    fs.dti_ratio,
    fs.emergency_runway_months,
    fs.current_tier,
    DENSE_RANK() OVER (ORDER BY fs.dti_ratio DESC NULLS LAST) AS dti_risk_rank,
    COUNT(l.debt_id) AS active_debt_count
FROM households h
JOIN financial_snapshots fs ON h.household_id = fs.household_id
LEFT JOIN users u ON h.household_id = u.household_id
LEFT JOIN liabilities l ON u.user_id = l.user_id AND l.principal_remaining > 0
WHERE fs.current_tier IN ('CRITICAL', 'FREEZE')
GROUP BY h.household_id, h.household_name, fs.total_monthly_income,
         fs.total_monthly_emi, fs.dti_ratio, fs.emergency_runway_months, fs.current_tier
HAVING fs.dti_ratio > 40.0 OR fs.current_tier = 'FREEZE';

------------------------------------------------------------------------
-- 8. Row-Level Security (RLS) Policies (Rubric Sections 11 & 13)
-- Multi-tenant security based on session variables:
--   app.current_user_id   UUID of the authenticated user
--   app.current_user_role user_role ('USER', 'ADMIN', 'COACH')
-- Superuser / migration / background roles (when app.current_user_id is not set)
-- bypass filtering so migrations and administrative tasks operate cleanly.
------------------------------------------------------------------------
ALTER TABLE households           ENABLE ROW LEVEL SECURITY;
ALTER TABLE households           FORCE ROW LEVEL SECURITY;
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_snapshots  FORCE ROW LEVEL SECURITY;
ALTER TABLE baseline_expenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_expenses    FORCE ROW LEVEL SECURITY;
ALTER TABLE liabilities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE liabilities          FORCE ROW LEVEL SECURITY;
ALTER TABLE liquid_assets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquid_assets        FORCE ROW LEVEL SECURITY;
ALTER TABLE asset_allocations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_allocations    FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_audit_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_audit_logs    FORCE ROW LEVEL SECURITY;

-- Helper function: determine if the current caller is in bypass/maintenance mode
CREATE OR REPLACE FUNCTION fn_rls_is_bypass()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '') IS NULL
        OR current_setting('app.current_user_role', true) = 'ADMIN';
$$;

-- Helper function: current session user UUID
CREATE OR REPLACE FUNCTION fn_rls_user_id()
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::UUID;
$$;

-- Helper function: check if caller has access to a household
CREATE OR REPLACE FUNCTION fn_rls_has_household_access(p_household_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_role TEXT := current_setting('app.current_user_role', true);
    v_uid  UUID := fn_rls_user_id();
BEGIN
    IF fn_rls_is_bypass() THEN
        RETURN TRUE;
    END IF;

    IF v_role = 'COACH' THEN
        RETURN EXISTS (
            SELECT 1 FROM coach_assignments
            WHERE coach_id = v_uid AND household_id = p_household_id
        );
    ELSIF v_role = 'USER' THEN
        RETURN EXISTS (
            SELECT 1 FROM users
            WHERE user_id = v_uid AND household_id = p_household_id
        );
    END IF;

    RETURN FALSE;
END;
$$;

-- RLS: households
DROP POLICY IF EXISTS p_households_isolation ON households;
CREATE POLICY p_households_isolation ON households
    FOR ALL USING (fn_rls_has_household_access(household_id));

-- RLS: users (direct check without calling fn_rls_has_household_access to prevent recursion)
DROP POLICY IF EXISTS p_users_isolation ON users;
CREATE POLICY p_users_isolation ON users
    FOR ALL USING (
        fn_rls_is_bypass()
        OR user_id = fn_rls_user_id()
        OR EXISTS (
            SELECT 1 FROM coach_assignments ca
            WHERE ca.coach_id = fn_rls_user_id()
              AND ca.household_id = users.household_id
        )
    );

-- RLS: financial_snapshots
DROP POLICY IF EXISTS p_snapshots_isolation ON financial_snapshots;
CREATE POLICY p_snapshots_isolation ON financial_snapshots
    FOR ALL USING (fn_rls_has_household_access(household_id));

-- RLS: baseline_expenses
DROP POLICY IF EXISTS p_baseline_isolation ON baseline_expenses;
CREATE POLICY p_baseline_isolation ON baseline_expenses
    FOR ALL USING (fn_rls_has_household_access(household_id));

-- RLS: liabilities
DROP POLICY IF EXISTS p_liabilities_isolation ON liabilities;
CREATE POLICY p_liabilities_isolation ON liabilities
    FOR ALL USING (
        fn_rls_is_bypass()
        OR user_id = fn_rls_user_id()
        OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.user_id = liabilities.user_id
              AND fn_rls_has_household_access(u.household_id)
        )
    );

-- RLS: liquid_assets
DROP POLICY IF EXISTS p_liquid_isolation ON liquid_assets;
CREATE POLICY p_liquid_isolation ON liquid_assets
    FOR ALL USING (fn_rls_has_household_access(household_id));

-- RLS: asset_allocations
DROP POLICY IF EXISTS p_allocations_isolation ON asset_allocations;
CREATE POLICY p_allocations_isolation ON asset_allocations
    FOR ALL USING (fn_rls_has_household_access(household_id));

-- RLS: policy_audit_logs
DROP POLICY IF EXISTS p_audit_isolation ON policy_audit_logs;
CREATE POLICY p_audit_isolation ON policy_audit_logs
    FOR ALL USING (
        fn_rls_is_bypass()
        OR user_id = fn_rls_user_id()
        OR current_setting('app.current_user_role', true) = 'COACH'
    );
