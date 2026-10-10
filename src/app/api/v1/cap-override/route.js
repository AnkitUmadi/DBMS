// src/app/api/v1/cap-override/route.js
// Next.js App Router Route Handler: POST /api/v1/cap-override

import { NextResponse } from "next/server";
import { withPgClient } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { household_id, cap_override } = body;

    if (!household_id) {
      return NextResponse.json(
        { error: "household_id is required" },
        { status: 400 }
      );
    }

    const parsedCap =
      cap_override === null || cap_override === "" || cap_override === undefined
        ? null
        : Number(cap_override);

    const row = await withPgClient(null, async (pgClient) => {
      const r = await pgClient.query(
        `SELECT
            household_id,
            cap_override::float8 AS cap_override,
            effective_cap::float8 AS effective_cap,
            structural_surplus::float8 AS structural_surplus,
            discretionary_mtd::float8 AS discretionary_mtd,
            current_tier,
            tier_reasons
         FROM fn_set_discretionary_cap_override($1::uuid, $2::numeric)`,
        [household_id, parsedCap]
      );
      return r.rows[0];
    });

    return NextResponse.json({
      status: "cap_updated",
      snapshot: row,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to update cap override" },
      { status: 400 }
    );
  }
}
