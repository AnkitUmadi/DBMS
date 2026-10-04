-- 002_core_tables.sql
-- Core relational schema (PostgreSQL = source of truth).
-- Money is NUMERIC(14,2); ratios are NUMERIC(10,2) so a distressed household
-- (costs >> income) cannot overflow the way the original NUMERIC(5,2) did.

CREATE TABLE households (
    household_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_name VARCHAR(100) NOT NULL CHECK (length(trim(household_name)) > 0),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id  UUID REFERENCES households(household_id) ON DELETE SET NULL,
    full_name     VARCHAR(100) NOT NULL CHECK (length(trim(full_name)) > 0),
    email         VARCHAR(150) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,          -- bcrypt hash, never plaintext
    role          user_role    NOT NULL DEFAULT 'USER',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));
CREATE INDEX idx_users_household ON users (household_id);

CREATE TABLE incomes (
    income_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    source_name       VARCHAR(100)  NOT NULL,
    monthly_amount    NUMERIC(14,2) NOT NULL CHECK (monthly_amount > 0),
    is_primary_earner BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_incomes_user ON incomes (user_id);

-- Mandatory baseline living costs (rent, groceries, utilities, transit).
CREATE TABLE baseline_expenses (
    expense_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id     UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    category_name    VARCHAR(50)   NOT NULL,
    monthly_amount   NUMERIC(14,2) NOT NULL CHECK (monthly_amount >= 0),
    due_day_of_month INT CHECK (due_day_of_month BETWEEN 1 AND 31),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_baseline_household ON baseline_expenses (household_id);

CREATE TABLE liabilities (
    debt_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    lender_name            VARCHAR(100)  NOT NULL,
    principal_remaining    NUMERIC(14,2) NOT NULL CHECK (principal_remaining >= 0),
    annual_interest_rate   NUMERIC(6,2)  NOT NULL CHECK (annual_interest_rate >= 0),
    monthly_emi            NUMERIC(14,2) NOT NULL CHECK (monthly_emi >= 0),
    emi_due_day            INT CHECK (emi_due_day BETWEEN 1 AND 31),
    prepayment_penalty_pct NUMERIC(5,2)  NOT NULL DEFAULT 0.00
                           CHECK (prepayment_penalty_pct BETWEEN 0 AND 100)
);
CREATE INDEX idx_liabilities_user ON liabilities (user_id);

-- Only is_emergency_fund = TRUE rows count toward runway.
CREATE TABLE liquid_assets (
    asset_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id      UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    asset_name        VARCHAR(100)  NOT NULL,
    current_balance   NUMERIC(14,2) NOT NULL CHECK (current_balance >= 0),
    is_emergency_fund BOOLEAN       NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_liquid_household ON liquid_assets (household_id);

-- A row exists only when a household LOWERED its discretionary cap below the
-- default (50% of structural surplus). It can never raise it.
CREATE TABLE discretionary_caps (
    household_id UUID PRIMARY KEY REFERENCES households(household_id) ON DELETE CASCADE,
    cap_override NUMERIC(14,2) NOT NULL CHECK (cap_override >= 0),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Month-to-date discretionary spend, synced from MongoDB (absolute totals, never deltas).
CREATE TABLE household_discretionary_monthly (
    household_id        UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    month_start         DATE NOT NULL CHECK (EXTRACT(DAY FROM month_start) = 1),
    discretionary_total NUMERIC(14,2) NOT NULL CHECK (discretionary_total >= 0),
    synced_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (household_id, month_start)
);

-- Computed snapshot, maintained ONLY by triggers (see 003).
CREATE TABLE financial_snapshots (
    snapshot_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id            UUID NOT NULL UNIQUE REFERENCES households(household_id) ON DELETE CASCADE,
    total_monthly_income    NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_baseline_costs    NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_monthly_emi       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_liquid_reserves   NUMERIC(14,2) NOT NULL DEFAULT 0,   -- emergency-fund assets only
    structural_surplus      NUMERIC(14,2) NOT NULL DEFAULT 0,
    discretionary_mtd       NUMERIC(14,2) NOT NULL DEFAULT 0,
    discretionary_cap       NUMERIC(14,2) NOT NULL DEFAULT 0,
    emergency_runway_months NUMERIC(10,2) NOT NULL DEFAULT 0,
    dti_ratio               NUMERIC(10,2),                      -- NULL when income = 0
    rigidity_ratio          NUMERIC(10,2),                      -- NULL when income = 0
    base_tier               policy_tier   NOT NULL DEFAULT 'FREEZE',  -- before overspend escalation
    current_tier            policy_tier   NOT NULL DEFAULT 'FREEZE',
    tier_reasons            TEXT[]        NOT NULL DEFAULT '{}',
    last_recalculated       TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_snapshots_tier ON financial_snapshots (current_tier);

-- Coach -> household assignments (drives coach-scoped RLS in Phase 2).
CREATE TABLE coach_assignments (
    coach_id     UUID NOT NULL REFERENCES users(user_id)          ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (coach_id, household_id)
);
CREATE INDEX idx_coach_household ON coach_assignments (household_id);

CREATE TABLE dependents (
    dependent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    full_name    VARCHAR(100) NOT NULL,
    relationship VARCHAR(30)  NOT NULL,
    age          INT NOT NULL CHECK (age BETWEEN 0 AND 120),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dependents_household ON dependents (household_id);

-- Saved what-if scenarios. Parameters only; running one never writes live data.
CREATE TABLE scenarios (
    scenario_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id  UUID NOT NULL REFERENCES households(household_id) ON DELETE CASCADE,
    created_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
    scenario_name VARCHAR(100) NOT NULL,
    params        JSONB NOT NULL CHECK (jsonb_typeof(params) = 'object'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scenarios_household ON scenarios (household_id);

-- Age + risk appetite feed the Phase 2 allocation engine.
CREATE TABLE risk_profiles (
    user_id       UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    age           INT NOT NULL CHECK (age BETWEEN 18 AND 100),
    risk_appetite risk_appetite NOT NULL DEFAULT 'MODERATE',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
