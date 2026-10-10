// src/app/api/v1/dashboard/[householdId]/route.js
// Next.js App Router Route Handler: GET /api/v1/dashboard/:householdId

import { NextResponse } from "next/server";
import {
  extractRlsContext,
  getHouseholdDashboard,
} from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { householdId } = await params;
    const rlsContext = extractRlsContext(request);
    const payload = await getHouseholdDashboard(householdId, rlsContext);

    if (!payload) {
      return NextResponse.json(
        { error: "Household not found or access denied by PostgreSQL RLS." },
        { status: 404 }
      );
    }

    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to load dashboard" },
      { status: 500 }
    );
  }
}
