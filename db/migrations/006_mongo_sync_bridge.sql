-- 006_mongo_sync_bridge.sql
-- FinShield — Phase 3: MongoDB -> PostgreSQL MTD Discretionary Spend Sync Bridge
-- Implements App Flow B (Daily Spend Logging & Policy Evaluation) and Phase 0 Spec.

------------------------------------------------------------------------
-- 1. fn_set_discretionary_mtd
-- Authoritative upsert point called by the MongoDB aggregation sync worker.
-- Always writes absolute Month-To-Date totals (never deltas), making
-- repeated sync runs 100% idempotent.
-- Automatically normalises p_month_start to the 1st of the target month.
-- Returns the refreshed financial snapshot state in a single round-trip.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_discretionary_mtd(
    p_household_id        UUID,
    p_discretionary_total NUMERIC(14,2),
    p_month_start         DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS TABLE (
    household_id        UUID,
    month_start         DATE,
    discretionary_mtd   NUMERIC(14,2),
    discretionary_cap   NUMERIC(14,2),
    structural_surplus  NUMERIC(14,2),
    base_tier           policy_tier,
    current_tier        policy_tier,
    tier_reasons        TEXT[],
    synced_at           TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
    v_norm_month DATE;
    v_synced_at  TIMESTAMPTZ;
BEGIN
    IF p_household_id IS NULL THEN
        RAISE EXCEPTION 'p_household_id cannot be NULL' USING ERRCODE = '22004';
    END IF;

    IF p_discretionary_total IS NULL OR p_discretionary_total < 0 THEN
        RAISE EXCEPTION 'p_discretionary_total (%) must be non-negative', p_discretionary_total
            USING ERRCODE = '23514';
    END IF;

    -- Normalise any date within a month to the 1st of that month
    v_norm_month := date_trunc('month', COALESCE(p_month_start, CURRENT_DATE))::DATE;

    -- Upsert absolute MTD total; trg_snap_disc_monthly automatically fires fn_refresh_snapshot
    INSERT INTO household_discretionary_monthly (
        household_id, month_start, discretionary_total, synced_at
    ) VALUES (
        p_household_id, v_norm_month, p_discretionary_total, now()
    )
    ON CONFLICT ON CONSTRAINT household_discretionary_monthly_pkey
    DO UPDATE SET
        discretionary_total = EXCLUDED.discretionary_total,
        synced_at           = now()
    RETURNING household_discretionary_monthly.synced_at INTO v_synced_at;

    -- Return the freshly recalculated snapshot state
    RETURN QUERY
    SELECT
        fs.household_id,
        v_norm_month,
        fs.discretionary_mtd,
        fs.discretionary_cap,
        fs.structural_surplus,
        fs.base_tier,
        fs.current_tier,
        fs.tier_reasons,
        v_synced_at
    FROM financial_snapshots fs
    WHERE fs.household_id = p_household_id;
END;
$$;

------------------------------------------------------------------------
-- 2. fn_set_discretionary_cap_override
-- Allows a household (or assigned coach) to set/lower a custom discretionary
-- cap override, or pass NULL to clear the override and revert to the
-- default 50% of structural surplus.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_set_discretionary_cap_override(
    p_household_id UUID,
    p_cap_override NUMERIC(14,2) DEFAULT NULL
)
RETURNS TABLE (
    household_id       UUID,
    discretionary_mtd  NUMERIC(14,2),
    discretionary_cap  NUMERIC(14,2),
    structural_surplus NUMERIC(14,2),
    current_tier       policy_tier,
    tier_reasons       TEXT[]
)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_household_id IS NULL THEN
        RAISE EXCEPTION 'p_household_id cannot be NULL' USING ERRCODE = '22004';
    END IF;

    IF p_cap_override IS NULL THEN
        DELETE FROM discretionary_caps dc
        WHERE dc.household_id = p_household_id;
    ELSE
        IF p_cap_override < 0 THEN
            RAISE EXCEPTION 'p_cap_override (%) must be non-negative', p_cap_override
                USING ERRCODE = '23514';
        END IF;

        INSERT INTO discretionary_caps (household_id, cap_override, updated_at)
        VALUES (p_household_id, p_cap_override, now())
        ON CONFLICT ON CONSTRAINT discretionary_caps_pkey
        DO UPDATE SET
            cap_override = EXCLUDED.cap_override,
            updated_at   = now();
    END IF;

    RETURN QUERY
    SELECT
        fs.household_id,
        fs.discretionary_mtd,
        fs.discretionary_cap,
        fs.structural_surplus,
        fs.current_tier,
        fs.tier_reasons
    FROM financial_snapshots fs
    WHERE fs.household_id = p_household_id;
END;
$$;

------------------------------------------------------------------------
-- 3. Multi-Tenant Row-Level Security (RLS) on Discretionary Spend Tables
------------------------------------------------------------------------
ALTER TABLE household_discretionary_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_discretionary_monthly FORCE ROW LEVEL SECURITY;

ALTER TABLE discretionary_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE discretionary_caps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_disc_monthly_isolation ON household_discretionary_monthly;
CREATE POLICY p_disc_monthly_isolation ON household_discretionary_monthly
    FOR ALL USING (fn_rls_has_household_access(household_id));

DROP POLICY IF EXISTS p_disc_caps_isolation ON discretionary_caps;
CREATE POLICY p_disc_caps_isolation ON discretionary_caps
    FOR ALL USING (fn_rls_has_household_access(household_id));
