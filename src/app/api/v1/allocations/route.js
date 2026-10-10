// src/app/api/v1/allocations/route.js
// Next.js App Router Route Handler: POST /api/v1/allocations
// Enforces PostgreSQL Gatekeeper Trigger (SQLSTATE FS001) and returns Explainability Modal payload.

import { NextResponse } from "next/server";
import { withPgClient } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    household_id,
    user_id,
    equity_pct,
    debt_pct,
    emergency_pct,
    is_override = false,
    override_reason = null,
  } = body;

  if (
    !household_id ||
    !user_id ||
    equity_pct === undefined ||
    debt_pct === undefined ||
    emergency_pct === undefined
  ) {
    return NextResponse.json(
      {
        error:
          "household_id, user_id, equity_pct, debt_pct, and emergency_pct are required.",
      },
      { status: 400 }
    );
  }

  const eq = Number(Number(equity_pct).toFixed(2));
  const dt = Number(Number(debt_pct).toFixed(2));
  const em = Number(Number(emergency_pct).toFixed(2));

  if (Math.abs(eq + dt + em - 100.0) > 0.01) {
    return NextResponse.json(
      {
        error: `Total allocation must equal 100.00% (received ${(eq + dt + em).toFixed(2)}%).`,
      },
      { status: 400 }
    );
  }

  try {
    const saved = await withPgClient(null, async (client) => {
      const ins = await client.query(
        `INSERT INTO asset_allocations (
            household_id, created_by, equity_pct, debt_pct, emergency_pct,
            is_override, override_reason
         ) VALUES ($1::uuid, $2::uuid, $3::numeric, $4::numeric, $5::numeric, $6::boolean, $7)
         RETURNING
            allocation_id,
            household_id,
            created_by,
            equity_pct::float8 AS equity_pct,
            debt_pct::float8 AS debt_pct,
            emergency_pct::float8 AS emergency_pct,
            is_override,
            override_reason,
            created_at`,
        [
          household_id,
          user_id,
          eq,
          dt,
          em,
          Boolean(is_override),
          override_reason ? String(override_reason).trim() : null,
        ]
      );
      return ins.rows[0];
    });

    return NextResponse.json(
      {
        status: is_override
          ? "override_accepted_and_audited"
          : "allocation_saved",
        allocation: saved,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err && err.code === "FS001") {
      const explainability = await withPgClient(null, async (client) => {
        const polRes = await client.query(
          `SELECT
              household_id,
              current_tier,
              action_status,
              allowed_equity_max::float8 AS allowed_equity_max,
              recommended_equity::float8 AS recommended_equity,
              recommended_debt::float8 AS recommended_debt,
              recommended_emergency::float8 AS recommended_emergency,
              policy_message,
              tier_reasons
           FROM sp_evaluate_allocation_policy($1::uuid, $2::numeric)`,
          [household_id, eq]
        );
        const snapRes = await client.query(
          `SELECT
              total_monthly_income::float8 AS total_monthly_income,
              total_baseline_costs::float8 AS total_baseline_costs,
              total_monthly_emi::float8 AS total_monthly_emi,
              total_liquid_reserves::float8 AS total_liquid_reserves,
              structural_surplus::float8 AS structural_surplus,
              discretionary_mtd::float8 AS discretionary_mtd,
              discretionary_cap::float8 AS discretionary_cap,
              emergency_runway_months::float8 AS emergency_runway_months,
              dti_ratio::float8 AS dti_ratio,
              rigidity_ratio::float8 AS rigidity_ratio,
              current_tier,
              tier_reasons
           FROM financial_snapshots WHERE household_id = $1::uuid`,
          [household_id]
        );

        const pol = polRes.rows[0];
        await client.query(
          `INSERT INTO policy_audit_logs (
              user_id, attempted_action, enforced_tier, action_blocked, override_reason
           ) VALUES ($1::uuid, $2, $3::policy_tier, TRUE, $4)`,
          [
            user_id,
            `ATTEMPT_EQUITY_${eq}_PCT`,
            pol.current_tier,
            `Blocked by FS001 Gatekeeper (Max allowed equity: ${pol.allowed_equity_max}%)`,
          ]
        );

        return {
          policy: pol,
          snapshot: snapRes.rows[0],
        };
      });

      return NextResponse.json(
        {
          status: "blocked_by_gatekeeper",
          code: "FS001",
          gatekeeper_error: err.message,
          attempted: {
            equity_pct: eq,
            debt_pct: dt,
            emergency_pct: em,
          },
          explainability: {
            what_happened: err.message,
            why_it_happened: explainability.policy.tier_reasons,
            policy_message: explainability.policy.policy_message,
            data_used: explainability.snapshot,
            recommendation: {
              allowed_equity_max: explainability.policy.allowed_equity_max,
              equity_pct: explainability.policy.recommended_equity,
              debt_pct: explainability.policy.recommended_debt,
              emergency_pct: explainability.policy.recommended_emergency,
            },
          },
        },
        { status: 403 }
      );
    }

    if (err && err.code === "23514") {
      return NextResponse.json(
        {
          error:
            "Override requires a meaningful justification reason (minimum 5 characters) per CHK_OVERRIDE_REASON_REQUIRED.",
          code: err.code,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: err.message || "Failed to save allocation" },
      { status: 500 }
    );
  }
}
