// src/app/api/v1/debt-plan/[householdId]/route.js
// Next.js App Router Route Handler: GET /api/v1/debt-plan/:householdId

import { NextResponse } from "next/server";
import {
  withPgClient,
  extractRlsContext,
  simulateAmortizationSummary,
} from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { householdId } = await params;
    const url = new URL(request.url, "http://localhost:3000");
    const strategy =
      (url.searchParams.get("strategy") || "AVALANCHE").toUpperCase() ===
      "SNOWBALL"
        ? "SNOWBALL"
        : "AVALANCHE";
    const extraSurplus = Math.max(
      Number(url.searchParams.get("surplus") || 0),
      0
    );
    const rlsContext = extractRlsContext(request);

    const data = await withPgClient(rlsContext, async (client) => {
      const uRes = await client.query(
        `SELECT u.user_id, u.full_name
         FROM users u
         WHERE u.household_id = $1::uuid
         ORDER BY
           (SELECT COUNT(*) FROM liabilities l WHERE l.user_id = u.user_id) DESC,
           u.created_at ASC
         LIMIT 1`,
        [householdId]
      );
      if (uRes.rows.length === 0) return null;

      const userId = uRes.rows[0].user_id;

      await client.query(
        `CALL sp_generate_debt_plan($1::uuid, $2::debt_strategy, $3::numeric)`,
        [userId, strategy, extraSurplus]
      );

      const schedRes = await client.query(
        `SELECT
            priority_rank,
            debt_id,
            lender_name,
            principal_remaining::float8 AS principal_remaining,
            annual_rate::float8 AS annual_rate,
            monthly_emi::float8 AS monthly_emi,
            extra_payment_alloc::float8 AS extra_payment_alloc,
            total_monthly_pay::float8 AS total_monthly_pay
         FROM fn_get_debt_payoff_schedule($1::uuid, $2::debt_strategy, $3::numeric)`,
        [userId, strategy, extraSurplus]
      );

      const rawLiabRes = await client.query(
        `SELECT debt_id, lender_name,
                principal_remaining::float8 AS principal_remaining,
                annual_interest_rate::float8 AS annual_interest_rate,
                monthly_emi::float8 AS monthly_emi,
                prepayment_penalty_pct::float8 AS prepayment_penalty_pct,
                remaining_tenure_months
         FROM liabilities
         WHERE user_id = $1::uuid AND principal_remaining > 0`,
        [userId]
      );

      const avalancheSim = simulateAmortizationSummary(
        rawLiabRes.rows,
        "AVALANCHE",
        extraSurplus
      );
      const snowballSim = simulateAmortizationSummary(
        rawLiabRes.rows,
        "SNOWBALL",
        extraSurplus
      );
      const baselineSim = simulateAmortizationSummary(
        rawLiabRes.rows,
        strategy,
        0
      );

      const penaltyMap = new Map(
        rawLiabRes.rows.map((r) => [
          r.debt_id,
          {
            prepayment_penalty_pct: r.prepayment_penalty_pct,
            remaining_tenure_months: r.remaining_tenure_months,
          },
        ])
      );

      const schedule = schedRes.rows.map((r) => ({
        ...r,
        ...(penaltyMap.get(r.debt_id) || {
          prepayment_penalty_pct: 0,
          remaining_tenure_months: null,
        }),
      }));

      const activeSim =
        strategy === "AVALANCHE" ? avalancheSim : snowballSim;

      return {
        household_id: householdId,
        borrower: uRes.rows[0],
        strategy,
        extra_surplus: extraSurplus,
        schedule,
        comparison: {
          active_strategy: activeSim,
          without_extra_surplus: baselineSim,
          avalanche: avalancheSim,
          snowball: snowballSim,
          interest_saved_vs_baseline: Number(
            Math.max(
              baselineSim.total_interest_paid - activeSim.total_interest_paid,
              0
            ).toFixed(2)
          ),
          months_saved_vs_baseline: Math.max(
            baselineSim.total_months - activeSim.total_months,
            0
          ),
          avalanche_interest_advantage: Number(
            Math.max(
              snowballSim.total_interest_paid - avalancheSim.total_interest_paid,
              0
            ).toFixed(2)
          ),
        },
      };
    });

    if (!data) {
      return NextResponse.json(
        { error: "Household borrower not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to generate debt payoff schedule" },
      { status: 500 }
    );
  }
}
