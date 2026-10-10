// src/app/api/v1/seed/reset/route.js
// Next.js App Router Route Handler: POST /api/v1/seed/reset

import { NextResponse } from "next/server";
import {
  pgPool,
  mongoClient,
  getMongoDb,
  seedDemoData,
} from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await getMongoDb();
    const seeded = await seedDemoData({
      existingPool: pgPool,
      existingMongoClient: mongoClient,
      silent: true,
    });
    return NextResponse.json({
      status: "demo_reset_complete",
      summary: seeded.summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to reset demo data" },
      { status: 500 }
    );
  }
}
