// db/mongo/init_mongo.js
// FinShield — Phase 3: MongoDB Schema Initialiser, JSON Schema Validator & Indexes
// Implements TRD Section 5.3 (Collection: daily_expenses)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
const { MongoClient } = require("mongodb");

const COLLECTION_NAME = "daily_expenses";

// Official JSON Schema Validator per TRD Section 5.3
const DAILY_EXPENSES_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: [
      "expense_id",
      "household_id",
      "user_id",
      "amount",
      "category",
      "timestamp",
    ],
    properties: {
      expense_id: {
        bsonType: "string",
        minLength: 1,
        description: "Unique identifier for the expense transaction",
      },
      household_id: {
        bsonType: "string",
        minLength: 1,
        description: "UUID string referencing PostgreSQL households.household_id",
      },
      user_id: {
        bsonType: "string",
        minLength: 1,
        description: "UUID string referencing PostgreSQL users.user_id",
      },
      amount: {
        bsonType: ["double", "int", "long", "decimal"],
        minimum: 0,
        description: "Non-negative transaction amount",
      },
      category: {
        bsonType: "string",
        minLength: 1,
        description: "Spend category name",
      },
      is_discretionary: {
        bsonType: "bool",
        description:
          "True if variable discretionary spend; False if reconciled baseline/EMI",
      },
      merchant_metadata: {
        bsonType: "object",
        properties: {
          name: { bsonType: "string" },
          location: { bsonType: "string" },
          tags: {
            bsonType: "array",
            items: { bsonType: "string" },
          },
        },
      },
      timestamp: {
        bsonType: "date",
        description: "BSON Date when the transaction occurred",
      },
    },
  },
};

/**
 * Ensures the `daily_expenses` collection exists with strict $jsonSchema validation
 * and production compound indexes for the MTD aggregation pipeline.
 * Idempotent: safe to call repeatedly.
 */
async function initMongoSchema(db) {
  const collections = await db
    .listCollections({ name: COLLECTION_NAME })
    .toArray();

  if (collections.length === 0) {
    await db.createCollection(COLLECTION_NAME, {
      validator: DAILY_EXPENSES_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
  } else {
    await db.command({
      collMod: COLLECTION_NAME,
      validator: DAILY_EXPENSES_VALIDATOR,
      validationLevel: "strict",
      validationAction: "error",
    });
  }

  const col = db.collection(COLLECTION_NAME);

  // 1. Unique index on expense_id prevents duplicate webhook/transaction ingestion
  await col.createIndex(
    { expense_id: 1 },
    { unique: true, name: "idx_expense_id_uq" }
  );

  // 2. Compound index covering the Phase 3 MTD Aggregation Pipeline ($match stage)
  await col.createIndex(
    { household_id: 1, is_discretionary: 1, timestamp: -1 },
    { name: "idx_household_mtd_agg" }
  );

  // 3. Index for per-user chronological transaction history
  await col.createIndex(
    { user_id: 1, timestamp: -1 },
    { name: "idx_user_timestamp" }
  );

  return col;
}

if (require.main === module) {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/finshield";
  const client = new MongoClient(uri);

  (async () => {
    try {
      await client.connect();
      const db = client.db();
      await initMongoSchema(db);
      console.log(
        `[MongoDB] Collection '${COLLECTION_NAME}' validator and indexes initialised on ${db.databaseName}.`
      );
    } catch (err) {
      console.error("[MongoDB] Failed to initialise schema:", err);
      process.exit(1);
    } finally {
      await client.close();
    }
  })();
}

module.exports = {
  COLLECTION_NAME,
  DAILY_EXPENSES_VALIDATOR,
  initMongoSchema,
};
