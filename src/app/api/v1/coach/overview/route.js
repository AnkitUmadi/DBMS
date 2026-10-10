// src/app/api/v1/coach/overview/route.js
// Next.js App Router Route Handler: GET /api/v1/coach/overview
// Executes under COACH RLS context to query view_high_risk_households & policy_audit_logs.

import { NextResponse } from "next/server";
import { withPgClient, DEMO_IDS } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const coachContext = {
      userId: DEMO_IDS.coachUser,
      role: "COACH",
    };

    const data = await withPgClient(coachContext, async (client) => {
      const highRiskRes = await client.query(
        `SELECT
            household_id,
            household_name,
            total_monthly_income::float8 AS total_monthly_income,
            total_monthly_emi::float8 AS total_monthly_emi,
            dti_ratio::float8 AS dti_ratio,
            emergency_runway_months::float8 AS emergency_runway_months,
            current_tier,
            dti_risk_rank::int AS dti_risk_rank,
            active_debt_count::int AS active_debt_count
         FROM view_high_risk_households
         WHERE household_id = ANY($1::uuid[])
         ORDER BY dti_risk_rank ASC, emergency_runway_months ASC`,
        [Object.values(DEMO_IDS.households)]
      );
      const auditRes = await client.query(
        `SELECT
            pal.log_id,
            pal.user_id,
            u.full_name AS user_name,
            h.household_name,
            pal.attempted_action,
            pal.enforced_tier,
            pal.action_blocked,
            pal.override_reason,
            pal.logged_at
         FROM policy_audit_logs pal
         JOIN users u ON u.user_id = pal.user_id
         LEFT JOIN households h ON h.household_id = u.household_id
         WHERE u.household_id = ANY($1::uuid[])
         ORDER BY pal.logged_at DESC
         LIMIT 25`,
        [Object.values(DEMO_IDS.households)]
      );
      const allAssignedRes = await client.query(
        `SELECT
            h.household_id,
            h.household_name,
            fs.current_tier,
            fs.base_tier,
            fs.dti_ratio::float8 AS dti_ratio,
            fs.emergency_runway_months::float8 AS emergency_runway_months,
            fs.structural_surplus::float8 AS structural_surplus,
            fs.discretionary_mtd::float8 AS discretionary_mtd,
            fs.discretionary_cap::float8 AS discretionary_cap,
            fs.tier_reasons
         FROM households h
         JOIN financial_snapshots fs ON fs.household_id = h.household_id
         WHERE h.household_id = ANY($1::uuid[])
         ORDER BY
           CASE fs.current_tier
             WHEN 'FREEZE' THEN 1
             WHEN 'CRITICAL' THEN 2
             WHEN 'CAUTION' THEN 3
             WHEN 'SAFE' THEN 4
           END ASC`,
        [Object.values(DEMO_IDS.households)]
      );
      const rlsCheckRes = await client.query(
        `SELECT
            current_setting('app.current_user_id', true) AS active_rls_user_id,
            current_setting('app.current_user_role', true) AS active_rls_role`
      );

      return {
        rls_session: rlsCheckRes.rows[0],
        high_risk_cohort: highRiskRes.rows,
        assigned_households: allAssignedRes.rows,
        audit_logs: auditRes.rows,
      };
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to load coach overview" },
      { status: 500 }
    );
  }
}
