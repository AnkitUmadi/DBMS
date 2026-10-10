// src/app/api/v1/expenses/refund/route.js
// Next.js App Router Route Handler: POST /api/v1/expenses/refund
// Reconciles P2P bill splits and merchant refunds in MongoDB and re-syncs PostgreSQL tier.

import { NextResponse } from "next/server";
import {
  withPgClient,
  getMongoDb,
  deleteDailyExpenseAndSync,
  recordReimbursementOrRefund,
} from "../../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      expense_id,
      refund_amount,
      reason = "P2P Bill Split / Refund",
    } = body;

    if (!expense_id) {
      return NextResponse.json(
        { error: "expense_id is required" },
        { status: 400 }
      );
    }

    const mongoDb = await getMongoDb();
    const result = await withPgClient(null, async (pgClient) => {
      if (
        refund_amount === undefined ||
        refund_amount === null ||
        refund_amount === "FULL"
      ) {
        return await deleteDailyExpenseAndSync(mongoDb, pgClient, expense_id);
      }
      return await recordReimbursementOrRefund(
        mongoDb,
        pgClient,
        expense_id,
        Number(refund_amount),
        reason
      );
    });

    return NextResponse.json({
      status: "reconciled",
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err.message || "Failed to process refund" },
      { status: 500 }
    );
  }
}
