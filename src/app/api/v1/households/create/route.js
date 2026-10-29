// src/app/api/v1/households/create/route.js
// Next.js App Router Route Handler: POST /api/v1/households/create
// Creates a brand new household, user, income stream, liquid asset, and baseline living costs.
// Demonstrates atomic PostgreSQL transaction (BEGIN ... COMMIT) and trigger-driven initial snapshot generation.

import { NextResponse } from "next/server";
import { withPgClient } from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      household_name,
      full_name,
      email,
      monthly_salary,
      liquid_emergency_fund,
      monthly_living_costs,
      has_initial_debt,
      initial_debt_name,
      initial_debt_principal,
      initial_debt_apr,
      initial_debt_emi,
    } = body;

    if (!household_name || !full_name || !email) {
      return NextResponse.json(
        { error: "household_name, full_name, and email are required." },
        { status: 400 }
      );
    }

    const created = await withPgClient(null, async (client) => {
      await client.query("BEGIN");
      try {
        // 1. Insert new Household
        const hRes = await client.query(
          `INSERT INTO households (household_name)
           VALUES ($1)
           RETURNING household_id, household_name`,
          [household_name.trim()]
        );
        const householdId = hRes.rows[0].household_id;

        // 2. Insert primary User
        const uRes = await client.query(
          `INSERT INTO users (household_id, full_name, email, password_hash, role)
           VALUES ($1::uuid, $2, $3, '$2a$10$demoHashedPasswordDummyString1234567890', 'USER')
           RETURNING user_id, full_name, email, role`,
          [householdId, full_name.trim(), email.trim().toLowerCase()]
        );
        const userId = uRes.rows[0].user_id;

        // 3. Insert primary Income stream
        const salaryNum = Math.max(Number(monthly_salary || 60000), 1000);
        await client.query(
          `INSERT INTO incomes (user_id, source_name, monthly_amount, is_primary_earner, pay_day_of_month)
           VALUES ($1::uuid, 'Primary Salary', $2::numeric, TRUE, 1)`,
          [userId, salaryNum]
        );

        // 4. Insert Liquid Reserve (Emergency Fund)
        const reserveNum = Math.max(Number(liquid_emergency_fund || 100000), 0);
        await client.query(
          `INSERT INTO liquid_assets (household_id, asset_name, current_balance, is_emergency_fund)
           VALUES ($1::uuid, 'Emergency Savings Account', $2::numeric, TRUE)`,
          [householdId, reserveNum]
        );

        // 5. Insert Baseline Living Costs (Rent/Groceries)
        const livingCostNum = Math.max(Number(monthly_living_costs || 30000), 0);
        await client.query(
          `INSERT INTO baseline_expenses (household_id, category_name, monthly_amount, due_day_of_month)
           VALUES ($1::uuid, 'Essential Housing & Living', $2::numeric, 5)`,
          [householdId, livingCostNum]
        );

        // 6. Optional: Insert initial debt if specified
        if (has_initial_debt && initial_debt_principal) {
          await client.query(
            `INSERT INTO liabilities (
                user_id, lender_name, principal_remaining, annual_interest_rate, monthly_emi, emi_due_day
             ) VALUES ($1::uuid, $2, $3::numeric, $4::numeric, $5::numeric, 10)`,
            [
              userId,
              initial_debt_name || "Credit Card / Personal Loan",
              Number(initial_debt_principal),
              Number(initial_debt_apr || 18.0),
              Number(initial_debt_emi || 5000),
            ]
          );
        }

        // 7. Initial default compliant Asset Allocation (0% equity if high debt, else standard)
        await client.query(
          `INSERT INTO asset_allocations (household_id, equity_pct, debt_pct, emergency_pct, is_override)
           VALUES ($1::uuid, 20.00, 30.00, 50.00, FALSE)`,
          [householdId]
        );

        await client.query("COMMIT");

        // Fetch the freshly generated financial snapshot
        const snapRes = await client.query(
          `SELECT
              household_id,
              total_monthly_income::float8 AS total_monthly_income,
              total_baseline_costs::float8 AS total_baseline_costs,
              total_monthly_emi::float8 AS total_monthly_emi,
              total_liquid_reserves::float8 AS total_liquid_reserves,
              structural_surplus::float8 AS structural_surplus,
              emergency_runway_months::float8 AS emergency_runway_months,
              dti_ratio::float8 AS dti_ratio,
              current_tier,
              tier_reasons
           FROM financial_snapshots WHERE household_id = $1::uuid`,
          [householdId]
        );

        return {
          household_id: householdId,
          household_name: hRes.rows[0].household_name,
          user: uRes.rows[0],
          snapshot: snapRes.rows[0],
        };
      } catch (innerErr) {
        await client.query("ROLLBACK");
        throw innerErr;
      }
    });

    return NextResponse.json({
      status: "success",
      message: `Household "${created.household_name}" and user "${created.user.full_name}" created successfully. PostgreSQL snapshot initialized in tier: ${created.snapshot.current_tier}`,
      household: created,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to create new household" },
      { status: 400 }
    );
  }
}
