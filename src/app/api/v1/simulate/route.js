// src/app/api/v1/simulate/route.js
// Next.js App Router Route Handler: POST /api/v1/simulate
// Calls non-destructive STABLE PostgreSQL function fn_simulate_scenario.

import { NextResponse } from "next/server";
import { withPgClient, extractRlsContext } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { household_id, params = {}, scenario_id = null } = body;
    const rlsContext = extractRlsContext(request);

    const simRow = await withPgClient(rlsContext, async (client) => {
      if (scenario_id) {
        const scRes = await client.query(
          `SELECT params, household_id FROM scenarios WHERE scenario_id = $1::uuid`,
          [scenario_id]
        );
        if (scRes.rows.length === 0) return null;
        const row = scRes.rows[0];
        const r = await client.query(
          `SELECT
              household_id,
              live_income::float8 AS live_income,
              sim_income::float8 AS sim_income,
              live_baseline::float8 AS live_baseline,
              sim_baseline::float8 AS sim_baseline,
              live_emi::float8 AS live_emi,
              sim_emi::float8 AS sim_emi,
              live_reserves::float8 AS live_reserves,
              sim_reserves::float8 AS sim_reserves,
              live_surplus::float8 AS live_surplus,
              sim_surplus::float8 AS sim_surplus,
              live_runway_months::float8 AS live_runway_months,
              sim_runway_months::float8 AS sim_runway_months,
              live_dti_ratio::float8 AS live_dti_ratio,
              sim_dti_ratio::float8 AS sim_dti_ratio,
              live_rigidity_ratio::float8 AS live_rigidity_ratio,
              sim_rigidity_ratio::float8 AS sim_rigidity_ratio,
              live_tier,
              sim_tier,
              tier_changed,
              sim_tier_reasons
           FROM fn_simulate_scenario($1::uuid, $2::jsonb)`,
          [row.household_id, row.params]
        );
        return { simulation: r.rows[0], applied_params: row.params };
      }

      if (!household_id) return null;
      const r = await client.query(
        `SELECT
            household_id,
            live_income::float8 AS live_income,
            sim_income::float8 AS sim_income,
            live_baseline::float8 AS live_baseline,
            sim_baseline::float8 AS sim_baseline,
            live_emi::float8 AS live_emi,
            sim_emi::float8 AS sim_emi,
            live_reserves::float8 AS live_reserves,
            sim_reserves::float8 AS sim_reserves,
            live_surplus::float8 AS live_surplus,
            sim_surplus::float8 AS sim_surplus,
            live_runway_months::float8 AS live_runway_months,
            sim_runway_months::float8 AS sim_runway_months,
            live_dti_ratio::float8 AS live_dti_ratio,
            sim_dti_ratio::float8 AS sim_dti_ratio,
            live_rigidity_ratio::float8 AS live_rigidity_ratio,
            sim_rigidity_ratio::float8 AS sim_rigidity_ratio,
            live_tier,
            sim_tier,
            tier_changed,
            sim_tier_reasons
         FROM fn_simulate_scenario($1::uuid, $2::jsonb)`,
        [household_id, JSON.stringify(params || {})]
      );
      return { simulation: r.rows[0], applied_params: params };
    });

    if (!simRow) {
      return NextResponse.json(
        { error: "Household or scenario not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(simRow);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to execute scenario simulation" },
      { status: 500 }
    );
  }
}
