// src/app/api/v1/health/route.js
// Next.js App Router Route Handler: GET /api/v1/health

import { NextResponse } from "next/server";
import {
  withPgClient,
  getMongoDb,
  COLLECTION_NAME,
  DEMO_IDS,
} from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const mongoDb = await getMongoDb();
    const pgCheck = await withPgClient(null, (c) =>
      c.query(
        `SELECT version() AS pg_version,
                (SELECT COUNT(*)::int FROM households) AS household_count,
                (SELECT COUNT(*)::int FROM recovery_playbooks) AS playbook_count`
      )
    );
    const mongoCount = await mongoDb
      .collection(COLLECTION_NAME)
      .countDocuments();

    return NextResponse.json({
      status: "ok",
      framework: "Next.js App Router",
      postgres: {
        connected: true,
        household_count: pgCheck.rows[0].household_count,
        playbook_count: pgCheck.rows[0].playbook_count,
      },
      mongodb: {
        connected: true,
        collection: COLLECTION_NAME,
        expense_document_count: mongoCount,
      },
      demo_ids: DEMO_IDS,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Health check failed" },
      { status: 500 }
    );
  }
}
