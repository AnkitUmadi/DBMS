-- 001_types.sql
-- Enumerated types. Enum declaration order IS the sort order, so
-- SAFE < CAUTION < CRITICAL < FREEZE and MAX(current_tier) gives the worst tier.

CREATE TYPE user_role     AS ENUM ('USER', 'ADMIN', 'COACH');
CREATE TYPE policy_tier   AS ENUM ('SAFE', 'CAUTION', 'CRITICAL', 'FREEZE');
CREATE TYPE debt_strategy AS ENUM ('AVALANCHE', 'SNOWBALL');
CREATE TYPE risk_appetite AS ENUM ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');
