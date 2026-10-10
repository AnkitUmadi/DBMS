// src/app/api/v1/expenses/route.js
// Next.js App Router Route Handler: POST /api/v1/expenses
// Validates against MongoDB $jsonSchema, aggregates MTD spend, and syncs to PostgreSQL.

import { NextResponse } from "next/server";
import {
  withPgClient,
  getMongoDb,
  logDailyExpenseAndSync,
} from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const {
      household_id,
      user_id,
      amount,
      category,
      is_discretionary = true,
      merchant_name = "Retail Merchant",
      location = "Bengaluru",
      payment_mode = "UPI",
    } = body;

    if (!household_id || !user_id || amount === undefined || !category) {
      return NextResponse.json(
        { error: "household_id, user_id, amount, and category are required." },
        { status: 400 }
      );
    }

    const expenseDoc = {
      expense_id:
        body.expense_id ||
        `tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      household_id: String(household_id),
      user_id: String(user_id),
      amount: Number(amount),
      category: String(category).trim(),
      is_discretionary: Boolean(is_discretionary),
      timestamp: new Date(),
      merchant_metadata: {
        name: String(merchant_name || "Retail Merchant"),
        location: String(location || "India"),
        tags: [
          String(payment_mode || "UPI"),
          is_discretionary ? "Discretionary" : "Baseline",
        ],
      },
    };

    const mongoDb = await getMongoDb();
    const result = await withPgClient(null, async (pgClient) => {
      return await logDailyExpenseAndSync(mongoDb, pgClient, expenseDoc);
    });

    return NextResponse.json(
      {
        status: "logged_and_synced",
        expense_id: result.expense_id,
        snapshot: result.snapshot,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err && err.code === 121) {
      return NextResponse.json(
        {
          error: "Blocked by MongoDB $jsonSchema Validator (MongoError 121)",
          code: 121,
          details: err.message,
        },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Failed to log expense" },
      { status: 500 }
    );
  }
}
