-- 003_snapshot_logic.sql
-- Tier logic lives here and nowhere else. See docs/FinShield_Phase0_Spec.md section 3.
--
-- Custom SQLSTATE codes used by FinShield:
--   FS002  coach_assignments.coach_id is not a COACH/ADMIN
--   FS003  role change would orphan existing coach assignments
--   (FS001 is reserved for the Phase 2 policy gatekeeper)

------------------------------------------------------------------------
-- Generic helper: keep updated_at honest
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_baseline_touch  BEFORE UPDATE ON baseline_expenses
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_liquid_touch    BEFORE UPDATE ON liquid_assets
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();
CREATE TRIGGER trg_caps_touch      BEFORE UPDATE ON discretionary_caps
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

------------------------------------------------------------------------
-- Pure classifier: numbers in, metrics + tier + reasons out.
-- No table access, so it is unit-testable and reusable by the simulator.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_classify_tier(
    p_income       NUMERIC,
    p_baseline     NUMERIC,
    p_emi          NUMERIC,
    p_reserves     NUMERIC,
    p_disc_mtd     NUMERIC,
    p_cap_override NUMERIC DEFAULT NULL
)
RETURNS TABLE (
    structural_surplus      NUMERIC,
    discretionary_cap       NUMERIC,
    emergency_runway_months NUMERIC,
    dti_ratio               NUMERIC,
    rigidity_ratio          NUMERIC,
    base_tier               policy_tier,
    tier                    policy_tier,
    tier_reasons            TEXT[]
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_costs   NUMERIC := p_baseline + p_emi;
    v_surplus NUMERIC := p_income - p_baseline - p_emi;
    v_dcap    NUMERIC := GREATEST(p_income - p_baseline - p_emi, 0) * 0.5;
    v_cap     NUMERIC;
    v_runway  NUMERIC;
    v_dti     NUMERIC;
    v_rigid   NUMERIC;
    v_base    policy_tier := 'SAFE';
    v_tier    policy_tier;
    v_reasons TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Cap: default 50% of surplus; an override may only LOWER it.
    v_cap := CASE WHEN p_cap_override IS NULL THEN v_dcap
                  ELSE LEAST(p_cap_override, v_dcap) END;

    -- Runway is capped at 999 (also covers zero costs: no division by zero).
    v_runway := CASE WHEN v_costs > 0 THEN LEAST(p_reserves / v_costs, 999) ELSE 999 END;

    IF p_income > 0 THEN
        v_dti   := p_emi   / p_income * 100;
        v_rigid := v_costs / p_income * 100;
    END IF;

    -- Tier is decided on UNROUNDED values; only the stored copies are rounded.
    -- Runway: <1 FREEZE, <3 CRITICAL, <6 CAUTION
    IF v_runway < 1 THEN
        v_base := GREATEST(v_base, 'FREEZE'::policy_tier);
        v_reasons := v_reasons || format('Emergency runway %s months is below 1', round(v_runway, 2));
    ELSIF v_runway < 3 THEN
        v_base := GREATEST(v_base, 'CRITICAL'::policy_tier);
        v_reasons := v_reasons || format('Emergency runway %s months is below 3', round(v_runway, 2));
    ELSIF v_runway < 6 THEN
        v_base := GREATEST(v_base, 'CAUTION'::policy_tier);
        v_reasons := v_reasons || format('Emergency runway %s months is below 6', round(v_runway, 2));
    END IF;

    -- DTI: >45 CRITICAL, >30 CAUTION (exactly 30 is SAFE, exactly 45 is CAUTION)
    IF v_dti > 45 THEN
        v_base := GREATEST(v_base, 'CRITICAL'::policy_tier);
        v_reasons := v_reasons || format('DTI %s%% is above 45%%', round(v_dti, 2));
    ELSIF v_dti > 30 THEN
        v_base := GREATEST(v_base, 'CAUTION'::policy_tier);
        v_reasons := v_reasons || format('DTI %s%% is above 30%%', round(v_dti, 2));
    END IF;

    -- Cash-flow FREEZE conditions
    IF p_income <= 0 THEN
        v_base := 'FREEZE';
        v_reasons := v_reasons || 'No income recorded'::TEXT;
    ELSIF v_surplus < 0 THEN
        v_base := 'FREEZE';
        v_reasons := v_reasons || format('Monthly cash flow is negative (%s)', round(v_surplus, 2));
    ELSIF p_disc_mtd > v_surplus THEN
        v_base := 'FREEZE';
        v_reasons := v_reasons || format(
            'Month-to-date discretionary spend %s exceeds monthly surplus %s',
            round(p_disc_mtd, 2), round(v_surplus, 2));
    END IF;

    -- Overspend escalator: spending past the cap raises the tier one level.
    v_tier := v_base;
    IF v_base <> 'FREEZE' AND p_disc_mtd > v_cap THEN
        v_tier := CASE v_base WHEN 'SAFE' THEN 'CAUTION'::policy_tier
                              ELSE 'CRITICAL'::policy_tier END;
        v_reasons := v_reasons || format(
            'Discretionary spend %s exceeds cap %s; tier raised one level',
            round(p_disc_mtd, 2), round(v_cap, 2));
    END IF;

    RETURN QUERY SELECT v_surplus, v_cap, round(v_runway, 2),
                        round(v_dti, 2), round(v_rigid, 2),
                        v_base, v_tier, v_reasons;
END $$;

------------------------------------------------------------------------
-- Recompute one household's snapshot from the base tables.
-- pg_advisory_xact_lock serialises concurrent recalculations per household:
-- the second writer waits, then reads the first writer's committed rows,
-- so the last writer can no longer overwrite with stale totals.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_refresh_snapshot(p_household UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_inc      NUMERIC;
    v_base     NUMERIC;
    v_emi      NUMERIC;
    v_res      NUMERIC;
    v_disc     NUMERIC;
    v_override NUMERIC;
    r          RECORD;
BEGIN
    IF p_household IS NULL THEN RETURN; END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_household::text, 0));

    -- Household may already be gone (cascade delete): nothing to maintain.
    IF NOT EXISTS (SELECT 1 FROM households WHERE household_id = p_household) THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(i.monthly_amount), 0) INTO v_inc
      FROM incomes i JOIN users u ON u.user_id = i.user_id
     WHERE u.household_id = p_household;

    SELECT COALESCE(SUM(monthly_amount), 0) INTO v_base
      FROM baseline_expenses WHERE household_id = p_household;

    -- A loan with nothing left to repay no longer costs an EMI.
    SELECT COALESCE(SUM(l.monthly_emi), 0) INTO v_emi
      FROM liabilities l JOIN users u ON u.user_id = l.user_id
     WHERE u.household_id = p_household AND l.principal_remaining > 0;

    SELECT COALESCE(SUM(current_balance), 0) INTO v_res
      FROM liquid_assets
     WHERE household_id = p_household AND is_emergency_fund;

    SELECT COALESCE(SUM(discretionary_total), 0) INTO v_disc
      FROM household_discretionary_monthly
     WHERE household_id = p_household
       AND month_start = date_trunc('month', CURRENT_DATE)::date;

    SELECT cap_override INTO v_override
      FROM discretionary_caps WHERE household_id = p_household;

    SELECT * INTO r FROM fn_classify_tier(v_inc, v_base, v_emi, v_res, v_disc, v_override);

    INSERT INTO financial_snapshots (
        household_id, total_monthly_income, total_baseline_costs, total_monthly_emi,
        total_liquid_reserves, structural_surplus, discretionary_mtd, discretionary_cap,
        emergency_runway_months, dti_ratio, rigidity_ratio,
        base_tier, current_tier, tier_reasons, last_recalculated
    ) VALUES (
        p_household, v_inc, v_base, v_emi,
        v_res, r.structural_surplus, v_disc, r.discretionary_cap,
        r.emergency_runway_months, r.dti_ratio, r.rigidity_ratio,
        r.base_tier, r.tier, r.tier_reasons, now()
    )
    ON CONFLICT (household_id) DO UPDATE SET
        total_monthly_income    = EXCLUDED.total_monthly_income,
        total_baseline_costs    = EXCLUDED.total_baseline_costs,
        total_monthly_emi       = EXCLUDED.total_monthly_emi,
        total_liquid_reserves   = EXCLUDED.total_liquid_reserves,
        structural_surplus      = EXCLUDED.structural_surplus,
        discretionary_mtd       = EXCLUDED.discretionary_mtd,
        discretionary_cap       = EXCLUDED.discretionary_cap,
        emergency_runway_months = EXCLUDED.emergency_runway_months,
        dti_ratio               = EXCLUDED.dti_ratio,
        rigidity_ratio          = EXCLUDED.rigidity_ratio,
        base_tier               = EXCLUDED.base_tier,
        current_tier            = EXCLUDED.current_tier,
        tier_reasons            = EXCLUDED.tier_reasons,
        last_recalculated       = now();
END $$;

CREATE OR REPLACE FUNCTION fn_household_of_user(p_user UUID)
RETURNS UUID LANGUAGE sql STABLE AS $$
    SELECT household_id FROM users WHERE user_id = p_user
$$;

------------------------------------------------------------------------
-- Trigger functions. TG_OP is branched explicitly so OLD/NEW are never
-- touched where they do not exist (INSERT has no OLD, DELETE has no NEW).
------------------------------------------------------------------------

-- Tables that carry household_id directly.
CREATE OR REPLACE FUNCTION fn_trg_refresh_by_household()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM fn_refresh_snapshot(NEW.household_id);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM fn_refresh_snapshot(NEW.household_id);
        IF OLD.household_id IS DISTINCT FROM NEW.household_id THEN
            PERFORM fn_refresh_snapshot(OLD.household_id);
        END IF;
    ELSE  -- DELETE
        PERFORM fn_refresh_snapshot(OLD.household_id);
    END IF;
    RETURN NULL;
END $$;

-- Tables that reach the household through users (incomes, liabilities).
CREATE OR REPLACE FUNCTION fn_trg_refresh_by_user()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM fn_refresh_snapshot(fn_household_of_user(NEW.user_id));
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM fn_refresh_snapshot(fn_household_of_user(NEW.user_id));
        IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
            PERFORM fn_refresh_snapshot(fn_household_of_user(OLD.user_id));
        END IF;
    ELSE  -- DELETE (if the user row was cascaded away, users' own trigger covers it)
        PERFORM fn_refresh_snapshot(fn_household_of_user(OLD.user_id));
    END IF;
    RETURN NULL;
END $$;

-- users: membership changes move income/EMI between households.
CREATE OR REPLACE FUNCTION fn_trg_refresh_from_users()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM fn_refresh_snapshot(NEW.household_id);
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.household_id IS DISTINCT FROM NEW.household_id THEN
            PERFORM fn_refresh_snapshot(OLD.household_id);
            PERFORM fn_refresh_snapshot(NEW.household_id);
        END IF;
    ELSE  -- DELETE
        PERFORM fn_refresh_snapshot(OLD.household_id);
    END IF;
    RETURN NULL;
END $$;

-- Every household gets a snapshot row the moment it exists.
CREATE OR REPLACE FUNCTION fn_trg_household_created()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_refresh_snapshot(NEW.household_id);
    RETURN NULL;
END $$;

------------------------------------------------------------------------
-- Triggers: every input to the snapshot
------------------------------------------------------------------------
CREATE TRIGGER trg_snap_households
    AFTER INSERT ON households
    FOR EACH ROW EXECUTE FUNCTION fn_trg_household_created();

CREATE TRIGGER trg_snap_users
    AFTER INSERT OR DELETE OR UPDATE OF household_id ON users
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_from_users();

CREATE TRIGGER trg_snap_incomes
    AFTER INSERT OR DELETE OR UPDATE OF monthly_amount, user_id ON incomes
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_by_user();

CREATE TRIGGER trg_snap_liabilities
    AFTER INSERT OR DELETE OR UPDATE OF monthly_emi, principal_remaining, user_id ON liabilities
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_by_user();

CREATE TRIGGER trg_snap_baseline
    AFTER INSERT OR DELETE OR UPDATE OF monthly_amount, household_id ON baseline_expenses
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_by_household();

CREATE TRIGGER trg_snap_liquid
    AFTER INSERT OR DELETE OR UPDATE OF current_balance, is_emergency_fund, household_id ON liquid_assets
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_by_household();

CREATE TRIGGER trg_snap_caps
    AFTER INSERT OR DELETE OR UPDATE OF cap_override, household_id ON discretionary_caps
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_by_household();

CREATE TRIGGER trg_snap_disc_monthly
    AFTER INSERT OR DELETE OR UPDATE OF discretionary_total, month_start, household_id
    ON household_discretionary_monthly
    FOR EACH ROW EXECUTE FUNCTION fn_trg_refresh_by_household();

------------------------------------------------------------------------
-- Integrity: only COACH/ADMIN users can be assigned households, and a
-- coach with assignments cannot be demoted out from under them.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_trg_check_coach_role()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users
                    WHERE user_id = NEW.coach_id AND role IN ('COACH', 'ADMIN')) THEN
        RAISE EXCEPTION 'User % is not a COACH or ADMIN and cannot hold assignments', NEW.coach_id
              USING ERRCODE = 'FS002';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_coach_assignment_role
    BEFORE INSERT OR UPDATE OF coach_id ON coach_assignments
    FOR EACH ROW EXECUTE FUNCTION fn_trg_check_coach_role();

CREATE OR REPLACE FUNCTION fn_trg_protect_coach_demotion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.role = 'USER' AND EXISTS (SELECT 1 FROM coach_assignments WHERE coach_id = NEW.user_id) THEN
        RAISE EXCEPTION 'User % still has coach assignments; remove them before changing role', NEW.user_id
              USING ERRCODE = 'FS003';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_users_protect_coach_demotion
    BEFORE UPDATE OF role ON users
    FOR EACH ROW EXECUTE FUNCTION fn_trg_protect_coach_demotion();
