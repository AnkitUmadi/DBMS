// src/app/api/v1/forecast/[householdId]/route.js
// Next.js App Router Route Handler: GET /api/v1/forecast/:householdId

import { NextResponse } from "next/server";
import { withPgClient, extractRlsContext } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { householdId } = await params;
    const url = new URL(request.url, "http://localhost:3000");
    const days = Math.min(
      Math.max(Number(url.searchParams.get("days") || 90), 7),
      180
    );
    const rlsContext = extractRlsContext(request);

    const rows = await withPgClient(rlsContext, async (client) => {
      const fRes = await client.query(
        `SELECT
            day_offset,
            forecast_date::text AS forecast_date,
            daily_inflow::float8 AS daily_inflow,
            daily_outflow::float8 AS daily_outflow,
            net_daily_flow::float8 AS net_daily_flow,
            projected_balance::float8 AS projected_balance,
            is_deficit
         FROM fn_forecast_cashflow_90d($1::uuid, $2::int, CURRENT_DATE)
         ORDER BY day_offset ASC`,
        [householdId, days]
      );
      return fRes.rows;
    });

    const deficitDays = rows.filter((r) => r.is_deficit);
    const minBalanceRow = rows.reduce(
      (min, r) => (r.projected_balance < min.projected_balance ? r : min),
      rows[0] || { projected_balance: 0, forecast_date: null }
    );

    return NextResponse.json({
      household_id: householdId,
      horizon_days: days,
      deficit_day_count: deficitDays.length,
      first_deficit_date: deficitDays[0] ? deficitDays[0].forecast_date : null,
      lowest_projected_balance: minBalanceRow.projected_balance,
      lowest_balance_date: minBalanceRow.forecast_date,
      series: rows,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to generate cashflow forecast" },
      { status: 500 }
    );
  }
}
