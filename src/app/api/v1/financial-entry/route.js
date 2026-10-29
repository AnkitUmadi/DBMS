// src/app/api/v1/financial-entry/route.js
// Next.js App Router Route Handler: POST /api/v1/financial-entry
// Allows live web UI creation of Debts/Liabilities, Incomes, or Liquid Assets,
// directly triggering PostgreSQL's fn_refresh_snapshot state machine triggers.

import { NextResponse } from "next/server";
import { withPgClient } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { household_id, user_id, entry_type, payload } = body;

    if (!household_id) {
      return NextResponse.json(
        { error: "household_id is required" },
        { status: 400 }
      );
    }

    const result = await withPgClient(null, async (client) => {
      // Find a default user_id if not provided
      let targetUserId = user_id;
      if (!targetUserId) {
        const uRes = await client.query(
          `SELECT user_id FROM users WHERE household_id = $1::uuid ORDER BY created_at ASC LIMIT 1`,
          [household_id]
        );
        if (uRes.rows.length === 0) {
          throw new Error("No users found in this household to attach entry to.");
        }
        targetUserId = uRes.rows[0].user_id;
      }

      if (entry_type === "LIABILITY") {
        const { lender_name, principal_remaining, annual_interest_rate, monthly_emi, due_day } = payload;
        if (!lender_name || principal_remaining === undefined || annual_interest_rate === undefined || monthly_emi === undefined) {
          throw new Error("Missing required liability fields: lender_name, principal_remaining, annual_interest_rate, monthly_emi");
        }
        await client.query(
          `INSERT INTO liabilities (
              user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day
           ) VALUES ($1::uuid, $2, $3::numeric, $4::numeric, $5::numeric, $6::int)`,
          [
            targetUserId,
            lender_name.trim(),
            Number(principal_remaining),
            Number(annual_interest_rate),
            Number(monthly_emi),
            due_day ? Number(due_day) : 10,
          ]
        );
      } else if (entry_type === "INCOME") {
        const { source_name, monthly_amount, pay_day } = payload;
        if (!source_name || monthly_amount === undefined) {
          throw new Error("Missing required income fields: source_name, monthly_amount");
        }
        await client.query(
          `INSERT INTO incomes (
              user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month
           ) VALUES ($1::uuid, $2, $3::numeric, FALSE, $4::int)`,
          [
            targetUserId,
            source_name.trim(),
            Number(monthly_amount),
            pay_day ? Number(pay_day) : 1,
          ]
        );
      } else if (entry_type === "ASSET") {
        const { asset_name, current_balance, is_emergency_fund } = payload;
        if (!asset_name || current_balance === undefined) {
          throw new Error("Missing required asset fields: asset_name, current_balance");
        }
        await client.query(
          `INSERT INTO liquid_assets (
              household_id, asset_name, current_balance, is_emergency_fund
           ) VALUES ($1::uuid, $2, $3::numeric, $4::boolean)`,
          [
            household_id,
            asset_name.trim(),
            Number(current_balance),
            is_emergency_fund ?? true,
          ]
        );
      } else {
        throw new Error(`Unsupported entry_type: ${entry_type}`);
      }

      // Fetch the updated snapshot refreshed by trigger
      const snapRes = await client.query(
        `SELECT
            total_monthly_income::float8 AS total_monthly_income,
            total_monthly_emi::float8 AS total_monthly_emi,
            total_liquid_reserves::float8 AS total_liquid_reserves,
            emergency_runway_months::float8 AS emergency_runway_months,
            dti_ratio::float8 AS dti_ratio,
            current_tier,
            tier_reasons
         FROM financial_snapshots WHERE household_id = $1::uuid`,
        [household_id]
      );

      return snapRes.rows[0];
    });

    return NextResponse.json({
      status: "success",
      message: `${entry_type} added successfully. PostgreSQL trigger trg_snap_${entry_type.toLowerCase()} refreshed financial snapshot.`,
      updated_snapshot: result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to add financial entry" },
      { status: 400 }
    );
  }
}
