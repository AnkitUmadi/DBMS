// src/app/api/v1/debt-payoff/route.js
// Next.js App Router Route Handler: POST /api/v1/debt-payoff
// Allows making actual debt payments or paying off a loan completely.
// Automatically fires PostgreSQL's trg_snap_liabilities trigger to refresh the snapshot.

import { NextResponse } from "next/server";
import { withPgClient } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { debt_id, household_id, pay_amount, full_payoff } = body;

    if (!debt_id) {
      return NextResponse.json(
        { error: "debt_id is required" },
        { status: 400 }
      );
    }

    const updated = await withPgClient(null, async (client) => {
      let q;
      let params;

      if (full_payoff) {
        // Complete debt payoff: balance and EMI become 0
        q = `UPDATE liabilities
             SET principal_remaining = 0.00, monthly_emi = 0.00
             WHERE debt_id = $1::uuid
             RETURNING debt_id, lender_name, principal_remaining, monthly_emi`;
        params = [debt_id];
      } else {
        const payNum = Number(pay_amount || 0);
        if (payNum <= 0) {
          throw new Error("pay_amount must be greater than 0");
        }
        // Partial payoff: subtract from principal
        q = `UPDATE liabilities
             SET principal_remaining = GREATEST(0.00, principal_remaining - $2::numeric),
                 monthly_emi = CASE WHEN principal_remaining - $2::numeric <= 0 THEN 0.00 ELSE monthly_emi END
             WHERE debt_id = $1::uuid
             RETURNING debt_id, lender_name, principal_remaining, monthly_emi`;
        params = [debt_id, payNum];
      }

      const res = await client.query(q, params);
      if (res.rows.length === 0) {
        throw new Error("Debt liability record not found.");
      }

      // Read the newly refreshed financial snapshot
      const snapRes = await client.query(
        `SELECT
            total_monthly_emi::float8 AS total_monthly_emi,
            dti_ratio::float8 AS dti_ratio,
            emergency_runway_months::float8 AS emergency_runway_months,
            current_tier,
            tier_reasons
         FROM financial_snapshots
         WHERE household_id = $1::uuid`,
        [household_id]
      );

      return {
        liability: res.rows[0],
        snapshot: snapRes.rows[0],
      };
    });

    return NextResponse.json({
      status: "success",
      message: full_payoff
        ? `Debt "${updated.liability.lender_name}" paid off in full (Balance: ₹0.00). PostgreSQL trigger recalculated DTI and Tier.`
        : `Payment applied to "${updated.liability.lender_name}". Remaining balance: ₹${updated.liability.principal_remaining}.`,
      data: updated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to execute debt payoff" },
      { status: 400 }
    );
  }
}
