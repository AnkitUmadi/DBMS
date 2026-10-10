// src/app/api/v1/households/route.js
// Next.js App Router Route Handler: GET /api/v1/households

import { NextResponse } from "next/server";
import { extractRlsContext, getHouseholdsList } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const rlsContext = extractRlsContext(request);
    const data = await getHouseholdsList(rlsContext);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to list households" },
      { status: 500 }
    );
  }
}
