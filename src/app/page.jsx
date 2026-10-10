// src/app/page.jsx
// FinShield — Next.js App Router Main Dashboard Page (React Server Component)
// Implements TRD Section 2.2:
// "Frontend Framework: Next.js (React) using Server Components for performant
//  dashboard rendering and Client Components for interactive calculators."

import React from "react";
import { getHouseholdsList, getHouseholdDashboard } from "../lib/db";
import FinShieldDashboardClient from "../components/FinShieldDashboardClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Server-side data fetch directly from PostgreSQL 18 & MongoDB 8.2 pools
  const householdsPayload = await getHouseholdsList(null);
  const households = householdsPayload.households || [];
  const defaultHouseholdId =
    households.length > 0 ? households[0].household_id : null;

  const initialDashboard = defaultHouseholdId
    ? await getHouseholdDashboard(defaultHouseholdId, null)
    : null;

  return (
    <FinShieldDashboardClient
      initialHouseholds={households}
      initialHouseholdId={defaultHouseholdId}
      initialDashboard={initialDashboard}
    />
  );
}
