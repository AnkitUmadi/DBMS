// db/mongo/spend_sync_service.js
// FinShield — Phase 3: Polyglot Spend Logging, Aggregation Pipeline & Postgres Sync Service
// Implements App Flow B: [User Logs Daily Spend] -> MongoDB -> Aggregation ($match/$group/$sum)
// -> PostgreSQL fn_set_discretionary_mtd -> Snapshot Trigger Recalculates Tier.

const { Double } = require("mongodb");
const { COLLECTION_NAME } = require("./init_mongo");

/**
 * Computes UTC month start/end boundaries and YYYY-MM-01 date string.
 * @param {Date|string} referenceDate
 */
function getMonthBounds(referenceDate = new Date()) {
  const d = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed

  const monthStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const nextMonthStart = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  const monthStartIsoDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;

  return { monthStart, nextMonthStart, monthStartIsoDate };
}

/**
 * Runs the MongoDB Aggregation Pipeline ($match -> $group -> $sum) to compute
 * the authoritative Month-To-Date discretionary spend for a household.
 * Strictly filters for `is_discretionary: true` so reconciled EMIs/baseline bills
 * stored in MongoDB are never double-counted against discretionary surplus.
 */
async function computeHouseholdDiscretionaryMtd(
  mongoDb,
  householdId,
  referenceDate = new Date()
) {
  const { monthStart, nextMonthStart, monthStartIsoDate } =
    getMonthBounds(referenceDate);

  const pipeline = [
    {
      $match: {
        household_id: String(householdId),
        is_discretionary: true,
        timestamp: { $gte: monthStart, $lt: nextMonthStart },
      },
    },
    {
      $group: {
        _id: "$household_id",
        discretionary_mtd: { $sum: "$amount" },
        transaction_count: { $sum: 1 },
      },
    },
  ];

  const results = await mongoDb
    .collection(COLLECTION_NAME)
    .aggregate(pipeline)
    .toArray();

  if (results.length === 0) {
    return {
      household_id: String(householdId),
      month_start: monthStartIsoDate,
      discretionary_mtd: 0.0,
      transaction_count: 0,
    };
  }

  return {
    household_id: String(householdId),
    month_start: monthStartIsoDate,
    discretionary_mtd: Number(Number(results[0].discretionary_mtd).toFixed(2)),
    transaction_count: results[0].transaction_count,
  };
}

/**
 * Secondary analytical MongoDB Aggregation Pipeline:
 * Groups household monthly transactions by category and discretionary status.
 */
async function computeCategoryBreakdown(
  mongoDb,
  householdId,
  referenceDate = new Date()
) {
  const { monthStart, nextMonthStart } = getMonthBounds(referenceDate);

  const pipeline = [
    {
      $match: {
        household_id: String(householdId),
        timestamp: { $gte: monthStart, $lt: nextMonthStart },
      },
    },
    {
      $group: {
        _id: {
          category: "$category",
          is_discretionary: "$is_discretionary",
        },
        total_amount: { $sum: "$amount" },
        tx_count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        category: "$_id.category",
        is_discretionary: "$_id.is_discretionary",
        total_amount: { $round: ["$total_amount", 2] },
        tx_count: 1,
      },
    },
    {
      $sort: { total_amount: -1, category: 1 },
    },
  ];

  return mongoDb.collection(COLLECTION_NAME).aggregate(pipeline).toArray();
}

/**
 * Aggregates a household's MTD discretionary spend in MongoDB and synchronises
 * the absolute total into PostgreSQL via `fn_set_discretionary_mtd`.
 * Idempotent: safe to call on every transaction or from a background cron job.
 */
async function syncHouseholdMtdToPostgres(
  mongoDb,
  pgClient,
  householdId,
  referenceDate = new Date()
) {
  const agg = await computeHouseholdDiscretionaryMtd(
    mongoDb,
    householdId,
    referenceDate
  );

  const pgRes = await pgClient.query(
    `SELECT
        household_id,
        month_start::text AS month_start,
        discretionary_mtd::numeric(14,2) AS discretionary_mtd,
        discretionary_cap::numeric(14,2) AS discretionary_cap,
        structural_surplus::numeric(14,2) AS structural_surplus,
        base_tier,
        current_tier,
        tier_reasons,
        synced_at
     FROM fn_set_discretionary_mtd($1::uuid, $2::numeric, $3::date)`,
    [householdId, agg.discretionary_mtd, agg.month_start]
  );

  const row = pgRes.rows[0];
  return {
    household_id: row.household_id,
    month_start: row.month_start,
    discretionary_mtd: Number(row.discretionary_mtd),
    discretionary_cap: Number(row.discretionary_cap),
    structural_surplus: Number(row.structural_surplus),
    base_tier: row.base_tier,
    current_tier: row.current_tier,
    tier_reasons: row.tier_reasons || [],
    transaction_count: agg.transaction_count,
    synced_at: row.synced_at,
  };
}

/**
 * App Flow B Entrypoint:
 * 1. Validates and inserts a daily expense document into MongoDB `daily_expenses`.
 * 2. Runs the MongoDB MTD aggregation pipeline and syncs the updated total to PostgreSQL.
 * 3. Returns the inserted document metadata and the refreshed PostgreSQL snapshot tier.
 */
async function logDailyExpenseAndSync(mongoDb, pgClient, expense) {
  const doc = {
    expense_id: expense.expense_id,
    household_id: expense.household_id,
    user_id: expense.user_id,
    amount:
      typeof expense.amount === "number"
        ? new Double(expense.amount)
        : expense.amount,
    category: expense.category,
    is_discretionary:
      typeof expense.is_discretionary === "boolean"
        ? expense.is_discretionary
        : true,
    timestamp:
      expense.timestamp instanceof Date
        ? expense.timestamp
        : new Date(expense.timestamp || Date.now()),
  };

  if (expense.merchant_metadata !== undefined) {
    doc.merchant_metadata = expense.merchant_metadata;
  }

  const insertResult = await mongoDb
    .collection(COLLECTION_NAME)
    .insertOne(doc);

  const snapshot = await syncHouseholdMtdToPostgres(
    mongoDb,
    pgClient,
    doc.household_id,
    doc.timestamp
  );

  return {
    inserted_id: insertResult.insertedId,
    expense_id: doc.expense_id,
    snapshot,
  };
}

/**
 * Deletes an expense from MongoDB (e.g. refund or user deletion) and immediately
 * re-synchronises the household's MTD total and risk tier in PostgreSQL.
 */
async function deleteDailyExpenseAndSync(mongoDb, pgClient, expenseId) {
  const deletedDoc = await mongoDb
    .collection(COLLECTION_NAME)
    .findOneAndDelete({ expense_id: String(expenseId) });

  if (!deletedDoc) {
    return { deleted: false, snapshot: null };
  }

  const snapshot = await syncHouseholdMtdToPostgres(
    mongoDb,
    pgClient,
    deletedDoc.household_id,
    deletedDoc.timestamp
  );

  return {
    deleted: true,
    expense_id: deletedDoc.expense_id,
    snapshot,
  };
}

/**
 * Handles incoming reimbursements, bill splits (e.g. friend sends half of dinner bill),
 * or partial/full merchant refunds against an existing expense in MongoDB:
 * - If refundAmount >= expense.amount, deletes the expense document.
 * - If refundAmount < expense.amount, reduces expense.amount to (amount - refundAmount).
 * Immediately re-runs the MongoDB aggregation pipeline and updates PostgreSQL.
 */
async function recordReimbursementOrRefund(
  mongoDb,
  pgClient,
  expenseId,
  refundAmount
) {
  const numRefund = Number(refundAmount);
  if (isNaN(numRefund) || numRefund <= 0) {
    throw new Error("refundAmount must be a positive number");
  }

  const col = mongoDb.collection(COLLECTION_NAME);
  const existing = await col.findOne({ expense_id: String(expenseId) });
  if (!existing) {
    return { updated: false, deleted: false, snapshot: null };
  }

  const currentAmt = Number(existing.amount);
  const newAmt = Number((currentAmt - numRefund).toFixed(2));

  if (newAmt <= 0) {
    await col.deleteOne({ expense_id: String(expenseId) });
  } else {
    await col.updateOne(
      { expense_id: String(expenseId) },
      { $set: { amount: new Double(newAmt) } }
    );
  }

  const snapshot = await syncHouseholdMtdToPostgres(
    mongoDb,
    pgClient,
    existing.household_id,
    existing.timestamp
  );

  return {
    updated: newAmt > 0,
    deleted: newAmt <= 0,
    new_amount: Math.max(newAmt, 0),
    snapshot,
  };
}

module.exports = {
  getMonthBounds,
  computeHouseholdDiscretionaryMtd,
  computeCategoryBreakdown,
  syncHouseholdMtdToPostgres,
  logDailyExpenseAndSync,
  deleteDailyExpenseAndSync,
  recordReimbursementOrRefund,
};
