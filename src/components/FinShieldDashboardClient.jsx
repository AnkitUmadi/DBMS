"use client";

// src/components/FinShieldDashboardClient.jsx
// FinShield — Next.js App Router Interactive Client Component
// Implements UI/UX Specification Sections 4.1 & 4.2, PRD Features 1-6, and App Flows A-D.

import React, { useState, useEffect, useCallback } from "react";

const TIER_STYLES = {
  SAFE: {
    pill: "bg-[#10B981]/20 text-[#D1FAE5] border border-[#10B981]/50",
    dot: "bg-[#10B981]",
    badge: "bg-[#D1FAE5] text-[#065F46] border border-[#10B981]/40",
    hex: "#10B981",
    softHex: "#D1FAE5",
  },
  CAUTION: {
    pill: "bg-[#F59E0B]/20 text-[#FEF3C7] border border-[#F59E0B]/50",
    dot: "bg-[#F59E0B]",
    badge: "bg-[#FEF3C7] text-[#92400E] border border-[#F59E0B]/40",
    hex: "#F59E0B",
    softHex: "#FEF3C7",
  },
  CRITICAL: {
    pill: "bg-[#F43F5E]/25 text-[#FFE4E6] border border-[#F43F5E]/60",
    dot: "bg-[#F43F5E]",
    badge: "bg-[#FFE4E6] text-[#9F1239] border border-[#F43F5E]/40",
    hex: "#F43F5E",
    softHex: "#FFE4E6",
  },
  FREEZE: {
    pill: "bg-[#9F1239] text-white border border-rose-400",
    dot: "bg-rose-200",
    badge: "bg-[#4C0519] text-rose-100 border border-[#9F1239]",
    hex: "#9F1239",
    softHex: "#4C0519",
  },
};

function fmtINR(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val)))
    return "₹0";
  const num = Number(val);
  const sign = num < 0 ? "-" : "";
  return (
    sign +
    "₹" +
    Math.abs(num).toLocaleString("en-IN", {
      maximumFractionDigits: 0,
    })
  );
}

// ---------------------------------------------------------------------------
// Interactive SVG 30/60/90-Day Cashflow Projection Line Chart
// ---------------------------------------------------------------------------
function CashflowTrajectoryChart({ series = [], deficitCount = 0 }) {
  if (!series || series.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-xs text-slate-400">
        Loading cashflow projection...
      </div>
    );
  }

  const width = 680;
  const height = 220;
  const padL = 62;
  const padR = 18;
  const padT = 18;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const balances = series.map((d) => Number(d.projected_balance));
  const minVal = Math.min(...balances, 0);
  const maxVal = Math.max(...balances, 10000);
  const range = Math.max(maxVal - minVal, 1);

  const getX = (i) =>
    padL + (i / Math.max(series.length - 1, 1)) * plotW;
  const getY = (val) =>
    padT + plotH - ((val - minVal) / range) * plotH;

  const zeroY = getY(0);
  const points = series.map((d, i) => `${getX(i).toFixed(1)},${getY(d.projected_balance).toFixed(1)}`).join(" ");
  const areaPoints = `${getX(0).toFixed(1)},${(padT + plotH).toFixed(1)} ${points} ${getX(series.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}`;

  const strokeColor = deficitCount > 0 ? "#F43F5E" : "#6366F1";
  const fillColor =
    deficitCount > 0 ? "rgba(244, 63, 94, 0.12)" : "rgba(99, 102, 241, 0.12)";

  const yTicks = [minVal, minVal + range * 0.5, maxVal];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-56 select-none"
      >
        {/* Horizontal Grid Lines */}
        {yTicks.map((t, idx) => {
          const y = getY(t);
          return (
            <g key={idx}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray="3 3"
              />
              <text
                x={padL - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[9px] mono-num"
              >
                {fmtINR(t)}
              </text>
            </g>
          );
        })}

        {/* Zero Balance Threshold Line */}
        {minVal < 0 && (
          <line
            x1={padL}
            y1={zeroY}
            x2={width - padR}
            y2={zeroY}
            stroke="#9F1239"
            strokeWidth="1.5"
            strokeDasharray="4 2"
          />
        )}

        {/* Shaded Area & Trajectory Line */}
        <polygon points={areaPoints} fill={fillColor} />
        <polyline
          fill="none"
          stroke={strokeColor}
          strokeWidth="2.5"
          points={points}
        />

        {/* Key Inflow / Outflow / Deficit Markers */}
        {series.map((d, i) => {
          if (!d.is_deficit && d.daily_inflow === 0 && d.daily_outflow === 0)
            return null;
          const cx = getX(i);
          const cy = getY(d.projected_balance);
          const color = d.is_deficit
            ? "#F43F5E"
            : d.daily_inflow > 0
            ? "#10B981"
            : "#F59E0B";
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={d.is_deficit ? 4 : 3}
              fill={color}
            >
              <title>
                {`Day ${d.day_offset} (${d.forecast_date}): Balance ${fmtINR(
                  d.projected_balance
                )}${d.daily_inflow > 0 ? ` | +Inflow ${fmtINR(d.daily_inflow)}` : ""}${
                  d.daily_outflow > 0 ? ` | -Outflow ${fmtINR(d.daily_outflow)}` : ""
                }${d.is_deficit ? " [DEFICIT WARNING]" : ""}`}
              </title>
            </circle>
          );
        })}

        {/* X-Axis Date Labels */}
        {[0, Math.floor(series.length / 2), series.length - 1].map((idx) => {
          const item = series[idx];
          if (!item) return null;
          return (
            <text
              key={idx}
              x={getX(idx)}
              y={height - 6}
              textAnchor="middle"
              className="fill-slate-400 text-[10px] mono-num"
            >
              Day {item.day_offset} ({item.forecast_date.slice(5)})
            </text>
          );
        })}
      </svg>

      {/* 5. REGISTER NEW HOUSEHOLD & USER MODAL */}
      {showNewHouseholdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <span className="p-1 rounded bg-[#6366F1]/20 text-[#6366F1]">🏠</span>
                  Register New Household &amp; User
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Creates new entities in PostgreSQL under a single ACID transaction
                </p>
              </div>
              <button
                onClick={() => setShowNewHouseholdModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateNewHousehold} className="p-6 space-y-3.5 text-xs overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Household Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Gupta Family"
                    value={newHhForm.household_name}
                    onChange={(e) => setNewHhForm({ ...newHhForm, household_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Primary User Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rohan Gupta"
                    value={newHhForm.full_name}
                    onChange={(e) => setNewHhForm({ ...newHhForm, full_name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  User Email *
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. rohan.gupta@pes.edu"
                  value={newHhForm.email}
                  onChange={(e) => setNewHhForm({ ...newHhForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                    Monthly Income (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1000"
                    placeholder="85000"
                    value={newHhForm.monthly_salary}
                    onChange={(e) => setNewHhForm({ ...newHhForm, monthly_salary: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white mono-num font-bold text-emerald-700"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                    Emergency Reserves (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    placeholder="300000"
                    value={newHhForm.liquid_emergency_fund}
                    onChange={(e) => setNewHhForm({ ...newHhForm, liquid_emergency_fund: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white mono-num font-bold text-indigo-700"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                    Living Costs (₹/mo) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    placeholder="35000"
                    value={newHhForm.monthly_living_costs}
                    onChange={(e) => setNewHhForm({ ...newHhForm, monthly_living_costs: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white mono-num"
                  />
                </div>
              </div>

              {/* Optional Initial Debt checkbox */}
              <div className="pt-2 border-t border-slate-200">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={newHhForm.has_initial_debt}
                    onChange={(e) => setNewHhForm({ ...newHhForm, has_initial_debt: e.target.checked })}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span>Add an Initial Loan / Debt Liability to this Household</span>
                </label>
              </div>

              {newHhForm.has_initial_debt && (
                <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200 space-y-2.5 animate-in fade-in">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                      Debt Lender Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. ICICI Credit Card"
                      value={newHhForm.initial_debt_name}
                      onChange={(e) => setNewHhForm({ ...newHhForm, initial_debt_name: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                        Principal (₹)
                      </label>
                      <input
                        type="number"
                        placeholder="50000"
                        value={newHhForm.initial_debt_principal}
                        onChange={(e) => setNewHhForm({ ...newHhForm, initial_debt_principal: e.target.value })}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white mono-num"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                        APR (%)
                      </label>
                      <input
                        type="number"
                        placeholder="24.0"
                        value={newHhForm.initial_debt_apr}
                        onChange={(e) => setNewHhForm({ ...newHhForm, initial_debt_apr: e.target.value })}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white mono-num font-bold text-rose-600"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1 text-[11px]">
                        EMI (₹)
                      </label>
                      <input
                        type="number"
                        placeholder="5000"
                        value={newHhForm.initial_debt_emi}
                        onChange={(e) => setNewHhForm({ ...newHhForm, initial_debt_emi: e.target.value })}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white mono-num"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setShowNewHouseholdModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={newHhLoading}
                  className="px-5 py-2 rounded-lg bg-[#6366F1] hover:bg-indigo-600 text-white font-extrabold shadow-md transition disabled:opacity-50"
                >
                  {newHhLoading ? "Creating in PostgreSQL..." : "Create Household & Initialize"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proportional Asset Allocation SVG Donut Chart (UI/UX Spec Section 4.2)
// ---------------------------------------------------------------------------
function AllocationDonutChart({ equityPct, debtPct, emergencyPct }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  const eqLen = (equityPct / 100) * circumference;
  const dtLen = (debtPct / 100) * circumference;
  const emLen = (emergencyPct / 100) * circumference;

  return (
    <div className="relative w-32 h-32 mx-auto flex items-center justify-center">
      <svg viewBox="0 0 120 120" className="w-32 h-32 -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="transparent"
          stroke="#F1F5F9"
          strokeWidth="16"
        />
        {/* Equity Segment (#6366F1 Indigo) */}
        {equityPct > 0 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#6366F1"
            strokeWidth="16"
            strokeDasharray={`${eqLen} ${circumference}`}
            strokeDashoffset={0}
          />
        )}
        {/* Debt Segment (#F59E0B Amber) */}
        {debtPct > 0 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#F59E0B"
            strokeWidth="16"
            strokeDasharray={`${dtLen} ${circumference}`}
            strokeDashoffset={-eqLen}
          />
        )}
        {/* Emergency Reserve Segment (#10B981 Emerald) */}
        {emergencyPct > 0 && (
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="transparent"
            stroke="#10B981"
            strokeWidth="16"
            strokeDasharray={`${emLen} ${circumference}`}
            strokeDashoffset={-(eqLen + dtLen)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-bold uppercase text-slate-400">
          Equity
        </span>
        <span className="text-base font-extrabold mono-num text-slate-900">
          {equityPct}%
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Client Component
// ---------------------------------------------------------------------------
export default function FinShieldDashboardClient({
  initialHouseholds = [],
  initialHouseholdId = null,
  initialDashboard = null,
}) {
  const [households, setHouseholds] = useState(initialHouseholds);
  const [activeHouseholdId, setActiveHouseholdId] =
    useState(initialHouseholdId);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [viewMode, setViewMode] = useState("USER"); // 'USER' | 'COACH'
  const [toast, setToast] = useState(null);

  // Forecast State
  const [forecastDays, setForecastDays] = useState(90);
  const [forecastData, setForecastData] = useState(null);

  // Debt Optimizer State
  const [debtStrategy, setDebtStrategy] = useState("AVALANCHE");
  const [extraSurplus, setExtraSurplus] = useState(5000);
  const [debtPlan, setDebtPlan] = useState(null);

  // MongoDB Daily Expense Form State
  const [expAmount, setExpAmount] = useState("");
  const [expCategory, setExpCategory] = useState("Dining & Restaurants");
  const [expMerchant, setExpMerchant] = useState("Indiranagar Social");
  const [expMode, setExpMode] = useState("UPI");
  const [expDiscretionary, setExpDiscretionary] = useState(true);

  // Asset Allocation Sliders State
  const [allocEq, setAllocEq] = useState(60);
  const [allocDebt, setAllocDebt] = useState(20);
  const [allocEm, setAllocEm] = useState(20);

  // Explainability & Gatekeeper Modal State (FS001)
  const [gatekeeperModal, setGatekeeperModal] = useState(null);
  const [showOverrideInput, setShowOverrideInput] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  // What-If Scenario Simulator State
  const [simDropPrimary, setSimDropPrimary] = useState(false);
  const [simIncDelta, setSimIncDelta] = useState(0);
  const [simBasePct, setSimBasePct] = useState(0);
  const [simEmiDelta, setSimEmiDelta] = useState(0);
  const [simResDelta, setSimResDelta] = useState(0);
  const [simResult, setSimResult] = useState(null);

  // Coach Overview State
  const [coachData, setCoachData] = useState(null);

  // Financial Entry State (Add Debt / Add Income / Add Asset)
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [entryType, setEntryType] = useState("LIABILITY"); // 'LIABILITY' | 'INCOME' | 'ASSET'
  const [entryForm, setEntryForm] = useState({
    lender_name: "",
    principal_remaining: "",
    annual_interest_rate: "",
    monthly_emi: "",
    due_day: "10",
    source_name: "",
    monthly_amount: "",
    pay_day: "1",
    asset_name: "",
    current_balance: "",
  });
  const [entryLoading, setEntryLoading] = useState(false);

  // New Household Registration State
  const [showNewHouseholdModal, setShowNewHouseholdModal] = useState(false);
  const [newHhForm, setNewHhForm] = useState({
    household_name: "",
    full_name: "",
    email: "",
    monthly_salary: "85000",
    liquid_emergency_fund: "300000",
    monthly_living_costs: "35000",
    has_initial_debt: false,
    initial_debt_name: "Credit Card / Personal Loan",
    initial_debt_principal: "50000",
    initial_debt_apr: "18.0",
    initial_debt_emi: "5000",
  });
  const [newHhLoading, setNewHhLoading] = useState(false);
  const [debtPayLoading, setDebtPayLoading] = useState(null);

  const notify = useCallback((title, message, type = "info") => {
    setToast({ title, message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.title === title ? null : prev));
    }, 4800);
  }, []);

  // Sync allocation sliders when dashboard changes
  useEffect(() => {
    if (!dashboard) return;
    const act = dashboard.active_allocation;
    const pol = dashboard.allocation_policy;
    if (act) {
      setAllocEq(Number(act.equity_pct));
      setAllocDebt(Number(act.debt_pct));
      setAllocEm(Number(act.emergency_pct));
    } else if (pol) {
      setAllocEq(Number(pol.recommended_equity));
      setAllocDebt(Number(pol.recommended_debt));
      setAllocEm(Number(pol.recommended_emergency));
    }
  }, [dashboard]);

  // Fetch Forecast, Debt Plan, and Simulation whenever household changes
  const fetchAuxiliaryPanels = useCallback(
    async (hId, days = forecastDays, strat = debtStrategy, surp = extraSurplus) => {
      if (!hId) return;
      const [fcRes, dpRes, simRes] = await Promise.all([
        fetch(`/api/v1/forecast/${hId}?days=${days}`),
        fetch(`/api/v1/debt-plan/${hId}?strategy=${strat}&surplus=${surp}`),
        fetch(`/api/v1/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            household_id: hId,
            params: {
              drop_primary_earner: simDropPrimary,
              income_delta: Number(simIncDelta),
              baseline_pct_change: Number(simBasePct),
              emi_delta: Number(simEmiDelta),
              reserve_delta: Number(simResDelta),
            },
          }),
        }),
      ]);

      if (fcRes.ok) setForecastData(await fcRes.json());
      if (dpRes.ok) setDebtPlan(await dpRes.json());
      if (simRes.ok) {
        const sJson = await simRes.json();
        setSimResult(sJson.simulation);
      }
    },
    [
      forecastDays,
      debtStrategy,
      extraSurplus,
      simDropPrimary,
      simIncDelta,
      simBasePct,
      simEmiDelta,
      simResDelta,
    ]
  );

  useEffect(() => {
    if (activeHouseholdId) {
      fetchAuxiliaryPanels(activeHouseholdId);
    }
  }, [activeHouseholdId, fetchAuxiliaryPanels]);

  const refreshHouseholdAndList = async (targetHouseholdId = activeHouseholdId) => {
    const [hhRes, dashRes] = await Promise.all([
      fetch("/api/v1/households"),
      fetch(`/api/v1/dashboard/${targetHouseholdId}`),
    ]);
    if (hhRes.ok) {
      const hhData = await hhRes.json();
      setHouseholds(hhData.households || []);
    }
    if (dashRes.ok) {
      setDashboard(await dashRes.json());
    }
    await fetchAuxiliaryPanels(targetHouseholdId);
  };

  const handleSelectHousehold = async (hId) => {
    setActiveHouseholdId(hId);
    const dashRes = await fetch(`/api/v1/dashboard/${hId}`);
    if (dashRes.ok) {
      setDashboard(await dashRes.json());
    }
  };

  const loadCoachPortal = async () => {
    const res = await fetch("/api/v1/coach/overview");
    if (res.ok) {
      setCoachData(await res.json());
    }
  };

  const handleSwitchRoleView = (mode) => {
    setViewMode(mode);
    if (mode === "COACH") {
      loadCoachPortal();
    }
  };

  // -------------------------------------------------------------------------
  // MongoDB Spend Logging & P2P Refund Handlers (App Flow B)
  // -------------------------------------------------------------------------
  const postMongoExpense = async (payload) => {
    const prevTier = dashboard?.snapshot?.current_tier;
    const res = await fetch("/api/v1/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      notify(
        `MongoDB $jsonSchema Blocked Write (Code ${data.code || res.status})`,
        data.error || "Invalid expense document rejected by MongoDB validator.",
        "error"
      );
      return;
    }

    const newTier = data.snapshot.current_tier;
    if (prevTier && prevTier !== newTier) {
      notify(
        `Tier Escalated: ${prevTier} → ${newTier}`,
        `MongoDB MTD Spend (${fmtINR(
          data.snapshot.discretionary_mtd
        )}) breached the ${fmtINR(
          data.snapshot.discretionary_cap
        )} cap! PostgreSQL trigger escalated household tier.`,
        "warning"
      );
    } else {
      notify(
        "MongoDB → PostgreSQL Sync Complete",
        `Logged ${fmtINR(payload.amount)} (${payload.category}). Updated MTD Spend: ${fmtINR(
          data.snapshot.discretionary_mtd
        )} | Active Tier: ${newTier}`,
        "success"
      );
    }

    await refreshHouseholdAndList(activeHouseholdId);
  };

  const handleExpenseFormSubmit = async (e) => {
    e.preventDefault();
    if (!dashboard?.users?.[0]) return;
    await postMongoExpense({
      household_id: activeHouseholdId,
      user_id: dashboard.users[0].user_id,
      amount: Number(expAmount),
      category: expCategory,
      is_discretionary: expDiscretionary,
      merchant_name: expMerchant,
      payment_mode: expMode,
    });
    setExpAmount("");
  };

  const handleReconcileRefund = async (expenseId, refundAmount) => {
    const res = await fetch("/api/v1/expenses/refund", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expense_id: expenseId,
        refund_amount: refundAmount,
        reason: "P2P Bill Split / Merchant Refund",
      }),
    });
    const data = await res.json();
    if (res.ok) {
      notify(
        "P2P Split / Refund Reconciled",
        `MongoDB aggregation updated MTD Spend to ${fmtINR(
          data.snapshot.discretionary_mtd
        )}. Active Tier: ${data.snapshot.current_tier}`,
        "success"
      );
      await refreshHouseholdAndList(activeHouseholdId);
    }
  };

  const handlePromptCapOverride = async () => {
    if (!dashboard?.snapshot) return;
    const defaultCap = Math.max(
      Number(dashboard.snapshot.structural_surplus) * 0.5,
      0
    );
    const input = window.prompt(
      `Set stricter custom monthly discretionary cap in ₹ (Must be <= default 50% surplus cap of ${fmtINR(
        defaultCap
      )}).\nLeave blank to reset to default 50% cap:`,
      dashboard.custom_cap_override !== null
        ? dashboard.custom_cap_override
        : Math.round(defaultCap * 0.75)
    );
    if (input === null) return;

    const res = await fetch("/api/v1/cap-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        household_id: activeHouseholdId,
        cap_override: input.trim() === "" ? null : Number(input),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("Cap Override Rejected", data.error, "error");
      return;
    }
    notify(
      "Discretionary Cap Updated",
      `Effective Cap: ${fmtINR(data.snapshot.effective_cap)} | Active Tier: ${
        data.snapshot.current_tier
      }`,
      "info"
    );
    await refreshHouseholdAndList(activeHouseholdId);
  };

  // -------------------------------------------------------------------------
  // Asset Allocation & Gatekeeper FS001 Handlers (App Flow C)
  // -------------------------------------------------------------------------
  const handleSliderChange = (which, val) => {
    const v = Number(val);
    if (which === "eq") {
      const rem = 100 - v;
      const d = Math.min(allocDebt, rem);
      const em = rem - d;
      setAllocEq(v);
      setAllocDebt(d);
      setAllocEm(em);
    } else if (which === "debt") {
      const rem = 100 - v;
      const eq = Math.min(allocEq, rem);
      const em = rem - eq;
      setAllocDebt(v);
      setAllocEq(eq);
      setAllocEm(em);
    } else {
      const rem = 100 - v;
      const eq = Math.min(allocEq, rem);
      const d = rem - eq;
      setAllocEm(v);
      setAllocEq(eq);
      setAllocDebt(d);
    }
  };

  const submitAllocation = async (
    eq = allocEq,
    dt = allocDebt,
    em = allocEm,
    isOverride = false,
    reason = null
  ) => {
    if (!dashboard?.users?.[0]) return;
    const res = await fetch("/api/v1/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        household_id: activeHouseholdId,
        user_id: dashboard.users[0].user_id,
        equity_pct: eq,
        debt_pct: dt,
        emergency_pct: em,
        is_override: isOverride,
        override_reason: reason,
      }),
    });
    const data = await res.json();

    if (res.status === 403 && data.code === "FS001") {
      setGatekeeperModal(data);
      setShowOverrideInput(false);
      setOverrideReason("");
      return;
    }

    if (!res.ok) {
      notify("Allocation Error", data.error || "Failed to save", "error");
      return;
    }

    setGatekeeperModal(null);
    notify(
      isOverride
        ? "Audited Policy Override Logged"
        : "Compliant Asset Allocation Saved",
      `Saved ${eq}% Equity / ${dt}% Debt / ${em}% Emergency Reserve Buffer.`,
      isOverride ? "warning" : "success"
    );
    await refreshHouseholdAndList(activeHouseholdId);
  };

  const handleResetDemo = async () => {
    const res = await fetch("/api/v1/seed/reset", { method: "POST" });
    if (res.ok) {
      notify(
        "Demo State Reset Complete",
        "All 4 demo households (SAFE, CAUTION, CRITICAL, FREEZE), MongoDB expenses, and PostgreSQL snapshots restored.",
        "info"
      );
      await refreshHouseholdAndList(activeHouseholdId);
      if (viewMode === "COACH") await loadCoachPortal();
    }
  };

  const handleAddFinancialEntry = async (e) => {
    e.preventDefault();
    setEntryLoading(true);
    try {
      let payload = {};
      if (entryType === "LIABILITY") {
        if (!entryForm.lender_name || !entryForm.principal_remaining || !entryForm.annual_interest_rate || !entryForm.monthly_emi) {
          throw new Error("Please fill in all loan fields: lender name, principal, APR %, and EMI.");
        }
        payload = {
          lender_name: entryForm.lender_name,
          principal_remaining: Number(entryForm.principal_remaining),
          annual_interest_rate: Number(entryForm.annual_interest_rate),
          monthly_emi: Number(entryForm.monthly_emi),
          due_day: Number(entryForm.due_day || 10),
        };
      } else if (entryType === "INCOME") {
        if (!entryForm.source_name || !entryForm.monthly_amount) {
          throw new Error("Please enter income source name and monthly amount.");
        }
        payload = {
          source_name: entryForm.source_name,
          monthly_amount: Number(entryForm.monthly_amount),
          pay_day: Number(entryForm.pay_day || 1),
        };
      } else if (entryType === "ASSET") {
        if (!entryForm.asset_name || !entryForm.current_balance) {
          throw new Error("Please enter asset name and balance.");
        }
        payload = {
          asset_name: entryForm.asset_name,
          current_balance: Number(entryForm.current_balance),
          is_emergency_fund: true,
        };
      }

      const res = await fetch("/api/v1/financial-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          household_id: activeHouseholdId,
          entry_type: entryType,
          payload,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      notify(
        "PostgreSQL Trigger Executed",
        `${entryType} added! Database trigger trg_snap_${entryType.toLowerCase()} recalculated snapshot. New Tier: ${data.updated_snapshot.current_tier}`,
        "success"
      );
      setShowAddEntryModal(false);
      setEntryForm({
        lender_name: "",
        principal_remaining: "",
        annual_interest_rate: "",
        monthly_emi: "",
        due_day: "10",
        source_name: "",
        monthly_amount: "",
        pay_day: "1",
        asset_name: "",
        current_balance: "",
      });
      await refreshHouseholdAndList(activeHouseholdId);
      if (viewMode === "COACH") await loadCoachPortal();
    } catch (err) {
      notify("Failed to Add Financial Entry", err.message, "error");
    } finally {
      setEntryLoading(false);
    }
  };

  const handlePayDebt = async (debtId, payAmount, fullPayoff) => {
    setDebtPayLoading(debtId);
    try {
      const res = await fetch("/api/v1/debt-payoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debt_id: debtId,
          household_id: activeHouseholdId,
          pay_amount: payAmount,
          full_payoff: fullPayoff,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      notify("Debt Updated in PostgreSQL", data.message, "success");
      await refreshHouseholdAndList(activeHouseholdId);
      if (viewMode === "COACH") await loadCoachPortal();
    } catch (err) {
      notify("Debt Payoff Failed", err.message, "error");
    } finally {
      setDebtPayLoading(null);
    }
  };

  const handleCreateNewHousehold = async (e) => {
    e.preventDefault();
    setNewHhLoading(true);
    try {
      const res = await fetch("/api/v1/households/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newHhForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      notify("New Household Registered", data.message, "success");
      setShowNewHouseholdModal(false);
      setNewHhForm({
        household_name: "",
        full_name: "",
        email: "",
        monthly_salary: "85000",
        liquid_emergency_fund: "300000",
        monthly_living_costs: "35000",
        has_initial_debt: false,
        initial_debt_name: "Credit Card / Personal Loan",
        initial_debt_principal: "50000",
        initial_debt_apr: "18.0",
        initial_debt_emi: "5000",
      });
      const hhRes = await fetch("/api/v1/households");
      if (hhRes.ok) {
        const hhData = await hhRes.json();
        setHouseholds(hhData.households);
        await handleSelectHousehold(data.household.household_id);
      }
    } catch (err) {
      notify("Failed to Create Household", err.message, "error");
    } finally {
      setNewHhLoading(false);
    }
  };

  const snap = dashboard?.snapshot || {};
  const activeTier = snap.current_tier || "SAFE";
  const tStyle = TIER_STYLES[activeTier] || TIER_STYLES.FREEZE;
  const monthlyBurn =
    Number(snap.total_baseline_costs || 0) + Number(snap.total_monthly_emi || 0);
  const runway = Number(snap.emergency_runway_months || 0);
  const dti = Number(snap.dti_ratio || 0);
  const surplus = Number(snap.structural_surplus || 0);
  const mtd = Number(snap.discretionary_mtd || 0);
  const cap = Number(snap.discretionary_cap || 0);
  const rigidity = Number(snap.rigidity_ratio || 0);

  // Sub-asset breakdown per PRD Feature 5 (Large-Cap Equity, Mid/Small-Cap Equity, Debt Instruments, Gold/Buffer)
  const largeCapPct = Math.round(allocEq * 0.7);
  const midSmallCapPct = allocEq - largeCapPct;

  return (
    <div className="min-h-screen flex flex-col">
      {/* ================================================================= */}
      {/* 1. HEADER BAR (UI/UX Spec Section 4.2 #1)                         */}
      {/* ================================================================= */}
      <header className="sticky top-0 z-40 bg-[#0F172A] text-white border-b border-slate-800 shadow-lg">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#6366F1] flex items-center justify-center shadow-inner">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3l7 4v5c0 5-3.5 8.5-7 9-3.5-.5-7-4-7-9V7l7-4z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-lg tracking-tight">
                  FinShield
                </span>
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  Next.js App Router
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                PostgreSQL 18 (ACID + Triggers + RLS) &bull; MongoDB 8.2 (Spend
                Docs) &bull; pgvector (&lt;=&gt; Playbooks)
              </p>
            </div>
          </div>

          {/* Center: Household Profile Switcher & Active Risk Tier Badge */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center bg-slate-800/90 border border-slate-700 rounded-lg px-2.5 py-1.5">
              <label
                htmlFor="hh-switcher"
                className="text-xs text-slate-400 mr-2 font-medium"
              >
                Household:
              </label>
              <select
                id="hh-switcher"
                value={activeHouseholdId || ""}
                onChange={(e) => handleSelectHousehold(e.target.value)}
                className="bg-transparent text-sm font-semibold text-white focus:outline-none cursor-pointer pr-2"
              >
                {households.map((h) => (
                  <option
                    key={h.household_id}
                    value={h.household_id}
                    className="bg-slate-900 text-white"
                  >
                    [{h.current_tier}] {h.household_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowNewHouseholdModal(true)}
                className="ml-2 px-2.5 py-1 rounded bg-[#6366F1] hover:bg-indigo-500 text-white text-[11px] font-bold shadow-sm transition whitespace-nowrap"
                title="Register a completely new Household & User"
              >
                + New Household
              </button>
            </div>

            <div
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold tracking-wider uppercase flex items-center gap-2 shadow-sm ${tStyle.pill}`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full animate-pulse ${tStyle.dot}`}
              />
              <span>
                Status: <strong className="mono-num">{activeTier} TIER</strong>
              </span>
            </div>
          </div>

          {/* Right: Role Indicator & View Switcher + Reset Demo */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-800 p-1 border border-slate-700">
              <button
                onClick={() => handleSwitchRoleView("USER")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  viewMode === "USER"
                    ? "bg-[#6366F1] text-white shadow"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Role: USER Dashboard
              </button>
              <button
                onClick={() => handleSwitchRoleView("COACH")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
                  viewMode === "COACH"
                    ? "bg-[#6366F1] text-white shadow"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                Role: COACH Audit
              </button>
            </div>

            <button
              onClick={handleResetDemo}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            >
              Reset Demo
            </button>

            <button
              onClick={() => {
                setEntryType("LIABILITY");
                setShowAddEntryModal(true);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition flex items-center gap-1"
            >
              <span className="text-sm leading-none">+</span> Add Debt / Income
            </button>
          </div>
        </div>

        {/* Deterministic Tier Reasons Sub-Bar */}
        <div className="bg-slate-900/95 border-t border-slate-800 px-4 sm:px-6 py-2 text-xs">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold uppercase tracking-wider text-slate-400">
                Active Policy Diagnosis:
              </span>
              <span className="text-slate-200 font-medium">
                {snap.tier_reasons?.length > 0
                  ? snap.tier_reasons.join(" • ")
                  : "All safety guardrails satisfied (Runway >= 6m, DTI <= 30%, Spend <= Cap)."}
              </span>
            </div>
            <div className="text-slate-400 mono-num text-[11px]">
              Base Tier: <strong className="text-white">{snap.base_tier}</strong>{" "}
              &rarr; Enforced:{" "}
              <strong className="text-white">{snap.current_tier}</strong>
            </div>
          </div>
        </div>
      </header>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white border-l-4 border-[#6366F1] p-4 rounded-xl shadow-2xl text-xs">
          <div className="font-bold text-sm mb-1">{toast.title}</div>
          <div className="text-slate-300 leading-relaxed">{toast.message}</div>
        </div>
      )}

      {/* ================================================================= */}
      {/* 2. MAIN USER DASHBOARD LAYOUT (UI/UX Spec Section 4.2 #1)         */}
      {/* ================================================================= */}
      {viewMode === "USER" ? (
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* ------------------------------------------------------------- */}
          {/* TOP METRIC STRIP (4 CARDS)                                    */}
          {/* ------------------------------------------------------------- */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Emergency Runway Gauge */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Emergency Runway
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#D1FAE5] text-[#065F46]">
                    Target &ge; 6.0m
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold mono-num text-slate-900">
                    {runway.toFixed(2)}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    Mos
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 mono-num">
                  Reserves: {fmtINR(snap.total_liquid_reserves)} / Burn:{" "}
                  {fmtINR(monthlyBurn)}
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(Math.max((runway / 6) * 100, 4), 100)}%`,
                      backgroundColor:
                        runway >= 6
                          ? "#10B981"
                          : runway >= 3
                          ? "#F59E0B"
                          : "#F43F5E",
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                  <span>0m (Freeze &lt;1m)</span>
                  <span>3m (Crit)</span>
                  <span>6m+ (Safe)</span>
                </div>
              </div>
            </div>

            {/* Card 2: Debt-to-Income (DTI) Meter */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    DTI Ratio Meter
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    Safe &le; 30%
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold mono-num text-slate-900">
                    {dti.toFixed(2)}%
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    of income
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 mono-num">
                  Total EMIs: {fmtINR(snap.total_monthly_emi)} / Income:{" "}
                  {fmtINR(snap.total_monthly_income)}
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(Math.max(dti, 4), 100)}%`,
                      backgroundColor:
                        dti <= 30
                          ? "#10B981"
                          : dti <= 45
                          ? "#F59E0B"
                          : "#F43F5E",
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                  <span>0%</span>
                  <span>30% (Caution)</span>
                  <span>45%+ (Critical)</span>
                </div>
              </div>
            </div>

            {/* Card 3: Monthly Net Surplus & MongoDB Spend Guardrail */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Monthly Net Surplus
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-[#6366F1]">
                    MongoDB MTD Sync
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className={`text-3xl font-extrabold mono-num ${
                      surplus < 0 ? "text-[#F43F5E]" : "text-slate-900"
                    }`}
                  >
                    {fmtINR(surplus)}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    surplus
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 mono-num">
                  MTD Spend: {fmtINR(mtd)} / Cap: {fmtINR(cap)}
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${
                        cap > 0
                          ? Math.min((mtd / cap) * 100, 100)
                          : mtd > 0
                          ? 100
                          : 0
                      }%`,
                      backgroundColor: mtd > cap ? "#F43F5E" : "#6366F1",
                    }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono mt-1">
                  <span>
                    {cap > 0
                      ? `${((mtd / cap) * 100).toFixed(0)}% of Cap`
                      : "Deficit Cap = ₹0"}
                  </span>
                  <button
                    onClick={handlePromptCapOverride}
                    className="text-[#6366F1] hover:underline font-sans font-semibold"
                  >
                    Set Cap Override
                  </button>
                </div>
              </div>
            </div>

            {/* Card 4: Expense Rigidity Index */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Expense Rigidity Index
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                    Fixed Ratio
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold mono-num text-slate-900">
                    {rigidity.toFixed(1)}%
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    fixed burden
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 mono-num">
                  Baseline: {fmtINR(snap.total_baseline_costs)} + EMIs:{" "}
                  {fmtINR(snap.total_monthly_emi)}
                </p>
              </div>
              <div className="mt-4">
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-800 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(Math.max(rigidity, 4), 100)}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
                  <span>Flexible (0%)</span>
                  <span>50%</span>
                  <span>Rigid (100%+)</span>
                </div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------- */}
          {/* MIDDLE SECTION (SPLIT VIEW: 60% CASHFLOW / 40% DEBT ENGINE)   */}
          {/* ------------------------------------------------------------- */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left (60% -> 7 cols): 30/60/90-Day Cashflow Projection */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      30/60/90-Day Cashflow Projection
                    </h2>
                    <p className="text-xs text-slate-500">
                      PostgreSQL <code className="font-mono">fn_forecast_cashflow_90d</code>{" "}
                      incorporating salary paydays, baseline due dates &amp; EMI tenures.
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg bg-slate-100 p-1">
                    {[30, 60, 90].map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          setForecastDays(d);
                          fetchAuxiliaryPanels(
                            activeHouseholdId,
                            d,
                            debtStrategy,
                            extraSurplus
                          );
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-semibold transition ${
                          forecastDays === d
                            ? "bg-white text-slate-900 shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {d}D
                      </button>
                    ))}
                  </div>
                </div>

                {/* Deficit Warning Banner */}
                {forecastData?.deficit_day_count > 0 ? (
                  <div className="mt-3 p-3 rounded-lg bg-[#FFE4E6] border border-[#F43F5E]/40 text-xs text-[#9F1239] font-bold flex items-center justify-between">
                    <span>
                      * WARNING: Cashflow Deficit projected on{" "}
                      <span className="mono-num">
                        {forecastData.first_deficit_date}
                      </span>{" "}
                      ({forecastData.deficit_day_count} deficit days in{" "}
                      {forecastDays}D window)
                    </span>
                    <span className="mono-num">
                      Min Balance: {fmtINR(forecastData.lowest_projected_balance)}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 p-2.5 rounded-lg bg-[#D1FAE5]/60 border border-[#10B981]/30 text-xs text-[#065F46] font-semibold flex items-center justify-between">
                    <span>
                      &check; Solvent across all {forecastDays} projected days (0
                      deficit days)
                    </span>
                    <span className="mono-num">
                      Lowest Buffer:{" "}
                      {fmtINR(forecastData?.lowest_projected_balance || 0)}
                    </span>
                  </div>
                )}

                <div className="mt-3">
                  <CashflowTrajectoryChart
                    series={forecastData?.series || []}
                    deficitCount={forecastData?.deficit_day_count || 0}
                  />
                </div>
              </div>

              {/* Scheduled Paydays & Due Dates */}
              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5 text-[11px]">
                {(dashboard?.incomes || []).map((inc) => (
                  <span
                    key={inc.income_id}
                    className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 mono-num"
                  >
                    Day {inc.pay_day_of_month}: +{fmtINR(inc.monthly_amount)} (
                    {inc.source_name})
                  </span>
                ))}
                {(dashboard?.baseline_expenses || []).slice(0, 2).map((b) => (
                  <span
                    key={b.expense_id}
                    className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 mono-num"
                  >
                    Day {b.due_day_of_month}: -{fmtINR(b.monthly_amount)} (
                    {b.category_name})
                  </span>
                ))}
              </div>
            </div>

            {/* Right (40% -> 5 cols): Debt Payoff Optimizer (Avalanche vs Snowball) */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900">
                        Debt Payoff Optimizer
                      </h2>
                      <button
                        onClick={() => {
                          setEntryType("LIABILITY");
                          setShowAddEntryModal(true);
                        }}
                        className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                      >
                        + Add Debt
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      PostgreSQL <code className="font-mono">sp_generate_debt_plan</code>
                    </p>
                  </div>

                  {/* Strategy Toggle */}
                  <div className="inline-flex rounded-lg bg-slate-100 p-1">
                    {["AVALANCHE", "SNOWBALL"].map((strat) => (
                      <button
                        key={strat}
                        onClick={() => {
                          setDebtStrategy(strat);
                          fetchAuxiliaryPanels(
                            activeHouseholdId,
                            forecastDays,
                            strat,
                            extraSurplus
                          );
                        }}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition ${
                          debtStrategy === strat
                            ? "bg-[#6366F1] text-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {strat === "AVALANCHE"
                          ? "(o) Avalanche"
                          : "( ) Snowball"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Extra Monthly Prepayment Input */}
                <div className="mt-3 bg-slate-50 p-3 rounded-lg border border-slate-200/80 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold text-slate-700 block">
                      Extra Prepayment Surplus (₹/mo)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Routed to Priority #1 target debt
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      step="1000"
                      value={extraSurplus}
                      onChange={(e) => setExtraSurplus(Number(e.target.value))}
                      className="w-24 px-2.5 py-1 text-sm font-bold mono-num bg-white border border-slate-300 rounded-lg"
                    />
                    <button
                      onClick={() =>
                        fetchAuxiliaryPanels(
                          activeHouseholdId,
                          forecastDays,
                          debtStrategy,
                          extraSurplus
                        )
                      }
                      className="px-3 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                {/* Savings Comparison Strip */}
                {debtPlan?.comparison && (
                  <div className="grid grid-cols-3 gap-2 my-3">
                    <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                      <span className="text-[10px] font-bold uppercase text-emerald-700 block">
                        Interest Saved
                      </span>
                      <span className="text-xs font-extrabold mono-num text-emerald-950">
                        {fmtINR(
                          debtPlan.comparison.interest_saved_vs_baseline
                        )}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-200">
                      <span className="text-[10px] font-bold uppercase text-indigo-700 block">
                        Payoff Time
                      </span>
                      <span className="text-xs font-extrabold mono-num text-indigo-950">
                        {debtPlan.comparison.active_strategy.total_months} mos (
                        -{debtPlan.comparison.months_saved_vs_baseline}m)
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                      <span className="text-[10px] font-bold uppercase text-amber-800 block">
                        Avalanche Edge
                      </span>
                      <span className="text-xs font-extrabold mono-num text-amber-950">
                        {fmtINR(
                          debtPlan.comparison.avalanche_interest_advantage
                        )}
                      </span>
                    </div>
                  </div>
                )}

                {/* Priority-Ranked Liabilities List */}
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {(debtPlan?.schedule || []).map((d) => (
                    <div
                      key={d.debt_id}
                      className={`p-3 rounded-xl border text-xs ${
                        d.priority_rank === 1
                          ? "bg-indigo-50/60 border-[#6366F1]"
                          : "bg-white border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          {d.priority_rank}. {d.lender_name} (
                          {Number(d.annual_rate).toFixed(1)}% APR)
                        </span>
                        <span className="mono-num font-bold text-slate-900">
                          {fmtINR(d.total_monthly_pay)}/mo
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 mono-num">
                        <span>Balance: {fmtINR(d.principal_remaining)}</span>
                        <span>
                          Penalty: {Number(d.prepayment_penalty_pct || 0)}%
                        </span>
                        {d.extra_payment_alloc > 0 && (
                          <span className="text-emerald-700 font-bold">
                            +{fmtINR(d.extra_payment_alloc)} extra
                          </span>
                        )}
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-medium">Pay Down Debt:</span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={debtPayLoading === d.debt_id}
                            onClick={() => handlePayDebt(d.debt_id, 10000, false)}
                            className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] transition disabled:opacity-50"
                            title="Apply ₹10,000 partial payment"
                          >
                            Pay ₹10k
                          </button>
                          <button
                            type="button"
                            disabled={debtPayLoading === d.debt_id}
                            onClick={() => handlePayDebt(d.debt_id, 0, true)}
                            className="px-2.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] shadow-sm transition disabled:opacity-50"
                            title="Clear entire remaining balance to ₹0"
                          >
                            ✓ Mark Paid Off (₹0)
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------- */}
          {/* BOTTOM SECTION (SPLIT VIEW: 50% ASSET DONUT / 50% PLAYBOOKS)  */}
          {/* ------------------------------------------------------------- */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left (50% -> 6 cols): Risk-Constrained Asset Allocation */}
            <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Risk-Constrained Asset Allocation
                    </h2>
                    <p className="text-xs text-slate-500">
                      Enforced by PostgreSQL Trigger{" "}
                      <code className="font-mono">
                        trg_gatekeeper_allocation (FS001)
                      </code>
                    </p>
                  </div>
                  <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full ${tStyle.badge}`}>
                    Allowed Equity &le;{" "}
                    {Number(
                      dashboard?.allocation_policy?.allowed_equity_max ?? 0
                    ).toFixed(0)}
                    %
                  </span>
                </div>

                {/* Policy Status Banner */}
                <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  *{" "}
                  <strong>
                    {dashboard?.allocation_policy?.action_status || "POLICY"}:
                  </strong>{" "}
                  {dashboard?.allocation_policy?.policy_message}
                </div>

                {/* Donut + Sliders + PRD Feature 5 Sub-Class Breakdown */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center my-4">
                  <div className="sm:col-span-4">
                    <AllocationDonutChart
                      equityPct={allocEq}
                      debtPct={allocDebt}
                      emergencyPct={allocEm}
                    />
                  </div>
                  <div className="sm:col-span-8 space-y-2.5 text-xs">
                    <div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-[#6366F1]">
                          Equity Allocation (Large-Cap {largeCapPct}% / Mid-Small{" "}
                          {midSmallCapPct}%)
                        </span>
                        <span className="mono-num font-bold">{allocEq}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={allocEq}
                        onChange={(e) =>
                          handleSliderChange("eq", e.target.value)
                        }
                        className="w-full accent-[#6366F1] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-[#F59E0B]">
                          Debt Instruments &amp; Loan Prepayment
                        </span>
                        <span className="mono-num font-bold">{allocDebt}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={allocDebt}
                        onChange={(e) =>
                          handleSliderChange("debt", e.target.value)
                        }
                        className="w-full accent-[#F59E0B] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between font-semibold">
                        <span className="text-[#10B981]">
                          Liquid Emergency Reserve Buffer &amp; Gold
                        </span>
                        <span className="mono-num font-bold">{allocEm}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={allocEm}
                        onChange={(e) =>
                          handleSliderChange("em", e.target.value)
                        }
                        className="w-full accent-[#10B981] cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => submitAllocation(allocEq, allocDebt, allocEm, false)}
                  className="px-4 py-2 bg-[#6366F1] hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow transition"
                >
                  Save Asset Allocation
                </button>
                <button
                  onClick={() => {
                    setAllocEq(70);
                    setAllocDebt(20);
                    setAllocEm(10);
                    submitAllocation(70, 20, 10, false);
                  }}
                  className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-[#9F1239] border border-rose-200 text-xs font-bold rounded-lg transition"
                >
                  Test Gatekeeper: Attempt 70% Equity SIP
                </button>
              </div>
            </div>

            {/* Right (50% -> 6 cols): Contextual Recovery Guidance (pgvector) */}
            <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Contextual Recovery Guidance (pgvector)
                    </h2>
                    <p className="text-xs text-slate-500">
                      Retrieved via <code className="font-mono">1 - (embedding &lt;=&gt; $1::vector) AS similarity_score</code>
                    </p>
                  </div>
                  <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-indigo-50 text-[#6366F1] font-bold">
                    384-Dim Cosine Match
                  </span>
                </div>

                <div className="mt-3 space-y-3 max-h-[290px] overflow-y-auto pr-1">
                  {(dashboard?.playbooks || []).map((pb, idx) => (
                    <div
                      key={pb.playbook_id}
                      className={`p-3.5 rounded-xl border ${
                        idx === 0
                          ? "bg-indigo-50/40 border-indigo-200"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-900">
                          Playbook: {pb.title}
                        </span>
                        <span className="text-[11px] font-mono font-bold text-[#6366F1]">
                          {(Number(pb.similarity_score) * 100).toFixed(1)}%
                          Match
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">
                        {pb.content_text}
                      </p>
                      <ol className="mt-2 pt-2 border-t border-slate-200/70 space-y-1 text-xs text-slate-800 list-decimal list-inside font-medium">
                        {(pb.action_steps || []).map((step, sIdx) => (
                          <li key={sIdx}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------------- */}
          {/* INTERACTIVE POLYGLOT MONGODB SPEND LOGGER & WHAT-IF SIMULATOR */}
          {/* ------------------------------------------------------------- */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 7 Cols: Polyglot MongoDB Daily Spend Logger & P2P Split */}
            <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    MongoDB Dynamic Spend Engine &amp; P2P Split Reconciler
                  </h2>
                  <p className="text-xs text-slate-500">
                    Writes to MongoDB <code className="font-mono">daily_expenses</code>,
                    aggregates MTD spend, and triggers PostgreSQL tier updates.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      postMongoExpense({
                        household_id: activeHouseholdId,
                        user_id: dashboard?.users?.[0]?.user_id,
                        amount: 45000,
                        category: "Impulse Luxury Spend",
                        is_discretionary: true,
                        merchant_name: "Apple Flagship Store",
                        payment_mode: "CREDIT_CARD",
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#F59E0B] hover:bg-amber-600 text-slate-950 shadow-sm transition"
                  >
                    ⚡ Log +₹45,000 Impulse Spend
                  </button>
                  <button
                    onClick={() =>
                      postMongoExpense({
                        household_id: activeHouseholdId,
                        user_id: dashboard?.users?.[0]?.user_id,
                        amount: -500,
                        category: "Negative Spend Test",
                        is_discretionary: true,
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-[#9F1239] border border-rose-200"
                  >
                    Test MongoError 121
                  </button>
                </div>
              </div>

              <form
                onSubmit={handleExpenseFormSubmit}
                className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 mt-3 bg-slate-50 p-3 rounded-xl border border-slate-200"
              >
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="Amount ₹"
                  value={expAmount}
                  onChange={(e) => setExpAmount(e.target.value)}
                  className="px-3 py-1.5 text-xs font-bold mono-num bg-white border border-slate-300 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Merchant"
                  value={expMerchant}
                  onChange={(e) => setExpMerchant(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                />
                <select
                  value={expCategory}
                  onChange={(e) => setExpCategory(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Dining & Restaurants">Dining &amp; Restaurants</option>
                  <option value="Luxury & Fashion Retail">Luxury &amp; Fashion</option>
                  <option value="Electronics & Gadgets">Electronics</option>
                  <option value="Travel & Leisure">Travel &amp; Leisure</option>
                </select>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-[#6366F1] hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow"
                >
                  + Log to MongoDB
                </button>
              </form>

              {/* MongoDB Transactions Table */}
              <div className="mt-3 overflow-x-auto max-h-48 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                    <tr>
                      <th className="py-2 px-3">Merchant &amp; Category</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                      <th className="py-2 px-3 text-right">
                        P2P Split / Refund
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(dashboard?.mongo?.transactions || []).map((tx) => {
                      const half = Number((tx.amount / 2).toFixed(2));
                      return (
                        <tr key={tx.expense_id} className="hover:bg-slate-50">
                          <td className="py-2 px-3">
                            <div className="font-bold text-slate-900">
                              {tx.merchant_metadata?.name || "Merchant"}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {tx.category}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-bold mono-num">
                            {fmtINR(tx.amount)}
                          </td>
                          <td className="py-2 px-3 text-right space-x-1">
                            <button
                              onClick={() =>
                                handleReconcileRefund(tx.expense_id, half)
                              }
                              className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px]"
                            >
                              Split 50%
                            </button>
                            <button
                              onClick={() =>
                                handleReconcileRefund(tx.expense_id, "FULL")
                              }
                              className="px-2 py-1 rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold text-[11px]"
                            >
                              Refund
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right 5 Cols: Non-Destructive What-If Scenario Simulator */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      What-If Scenario Simulator
                    </h2>
                    <p className="text-xs text-slate-500">
                      Non-destructive <code className="font-mono">STABLE</code>{" "}
                      PostgreSQL function <code className="font-mono">fn_simulate_scenario</code>
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                    Read-Only Safe
                  </span>
                </div>

                {/* Preset Scenarios */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(dashboard?.saved_scenarios || []).map((sc) => (
                    <button
                      key={sc.scenario_id}
                      onClick={() => {
                        setSimDropPrimary(Boolean(sc.params.drop_primary_earner));
                        setSimIncDelta(Number(sc.params.income_delta || 0));
                        setSimBasePct(Number(sc.params.baseline_pct_change || 0));
                        setSimEmiDelta(Number(sc.params.emi_delta || 0));
                        setSimResDelta(Number(sc.params.reserve_delta || 0));
                      }}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-[#6366F1] border border-indigo-200"
                    >
                      {sc.scenario_name}
                    </button>
                  ))}
                </div>

                {/* Controls */}
                <div className="mt-3 space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                  <label className="flex items-center justify-between font-bold text-slate-800 cursor-pointer">
                    <span>Drop Primary Earner Income</span>
                    <input
                      type="checkbox"
                      checked={simDropPrimary}
                      onChange={(e) => setSimDropPrimary(e.target.checked)}
                      className="w-4 h-4 accent-[#F43F5E]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[11px] text-slate-500 block">
                        Rent / Baseline Hike (%)
                      </span>
                      <input
                        type="number"
                        step="5"
                        value={simBasePct}
                        onChange={(e) => setSimBasePct(Number(e.target.value))}
                        className="w-full px-2 py-1 font-bold mono-num bg-white border border-slate-300 rounded"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block">
                        Emergency Reserve Shock (₹)
                      </span>
                      <input
                        type="number"
                        step="25000"
                        value={simResDelta}
                        onChange={(e) => setSimResDelta(Number(e.target.value))}
                        className="w-full px-2 py-1 font-bold mono-num bg-white border border-slate-300 rounded"
                      />
                    </div>
                  </div>
                </div>

                {/* Simulation Comparison Output */}
                {simResult && (
                  <div className="mt-3 p-3 rounded-xl border border-slate-200 bg-white text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-600">
                        Simulated Tier Transition:
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-extrabold mono-num ${
                          TIER_STYLES[simResult.sim_tier]?.badge || ""
                        }`}
                      >
                        {simResult.live_tier} &rarr; {simResult.sim_tier}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center mono-num bg-slate-50 p-2 rounded-lg">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Runway
                        </span>
                        <strong>{simResult.live_runway_months}m</strong> &rarr;{" "}
                        <strong>{simResult.sim_runway_months}m</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          DTI
                        </span>
                        <strong>{simResult.live_dti_ratio || 0}%</strong> &rarr;{" "}
                        <strong>{simResult.sim_dti_ratio ?? "N/A"}%</strong>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Surplus
                        </span>
                        <strong>{fmtINR(simResult.sim_surplus)}</strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      ) : (
        /* ================================================================= */
        /* 3. COACH / ADMIN RISK AUDIT PORTAL (Flow D)                       */
        /* ================================================================= */
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="bg-[#0F172A] text-white rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-extrabold">
                Coach Risk Audit &amp; Multi-Tenant RLS View
              </h2>
              <p className="text-xs text-slate-300">
                Analytical View:{" "}
                <code className="font-mono text-indigo-300">
                  view_high_risk_households
                </code>{" "}
                (<code className="font-mono">DENSE_RANK() OVER (ORDER BY dti_ratio DESC)</code>)
              </p>
            </div>
            <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-xs mono-num">
              <div>
                app.current_user_role ={" "}
                <strong className="text-amber-300">
                  &apos;{coachData?.rls_session?.active_rls_role || "COACH"}&apos;
                </strong>
              </div>
              <div className="text-slate-400">
                app.current_user_id ={" "}
                {coachData?.rls_session?.active_rls_user_id || "--"}
              </div>
            </div>
          </div>

          <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              High-Risk Distressed Cohort (view_high_risk_households)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-3 px-4">DTI Risk Rank</th>
                    <th className="py-3 px-4">Household</th>
                    <th className="py-3 px-4">Tier</th>
                    <th className="py-3 px-4 text-right">Income</th>
                    <th className="py-3 px-4 text-right">Total EMI</th>
                    <th className="py-3 px-4 text-right">DTI Ratio</th>
                    <th className="py-3 px-4 text-right">Runway</th>
                    <th className="py-3 px-4 text-center">Active Debts</th>
                    <th className="py-3 px-4 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(coachData?.high_risk_cohort || []).map((r) => (
                    <tr key={r.household_id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-extrabold mono-num">
                        #{r.dti_risk_rank}
                      </td>
                      <td className="py-3 px-4 font-bold">
                        {r.household_name}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold mono-num ${
                            TIER_STYLES[r.current_tier]?.badge || ""
                          }`}
                        >
                          {r.current_tier}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right mono-num">
                        {fmtINR(r.total_monthly_income)}
                      </td>
                      <td className="py-3 px-4 text-right mono-num">
                        {fmtINR(r.total_monthly_emi)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold mono-num text-[#F43F5E]">
                        {Number(r.dti_ratio).toFixed(2)}%
                      </td>
                      <td className="py-3 px-4 text-right font-bold mono-num">
                        {Number(r.emergency_runway_months).toFixed(2)}m
                      </td>
                      <td className="py-3 px-4 text-center mono-num">
                        {r.active_debt_count}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => {
                            setViewMode("USER");
                            handleSelectHousehold(r.household_id);
                          }}
                          className="px-2.5 py-1 rounded bg-indigo-50 text-[#6366F1] font-bold"
                        >
                          Inspect &rarr;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              Policy Override Audit Logs (policy_audit_logs)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">User &amp; Household</th>
                    <th className="py-2.5 px-4">Attempted Action</th>
                    <th className="py-2.5 px-4">Enforced Tier</th>
                    <th className="py-2.5 px-4">Outcome</th>
                    <th className="py-2.5 px-4">Reason / Diagnosis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(coachData?.audit_logs || []).map((l) => (
                    <tr key={l.log_id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4">
                        <div className="font-bold">{l.user_name}</div>
                        <div className="text-[11px] text-slate-500">
                          {l.household_name}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold">
                        {l.attempted_action}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold">
                        {l.enforced_tier}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            l.action_blocked
                              ? "bg-rose-100 text-rose-800"
                              : "bg-amber-100 text-amber-900"
                          }`}
                        >
                          {l.action_blocked
                            ? "BLOCKED (FS001)"
                            : "USER OVERRIDE"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">
                        {l.override_reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}

      {/* ================================================================= */}
      {/* 4. EXPLAINABILITY & GATEKEEPER MODAL (UI/UX Spec Section 4.2 #2)  */}
      {/* ================================================================= */}
      {gatekeeperModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="bg-[#4C0519] text-white px-6 py-4 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-rose-500/30 text-rose-200">
                  SQLSTATE FS001 &bull; trg_gatekeeper_allocation
                </span>
                <h3 className="text-base font-extrabold mt-0.5">
                  Action Restricted by Financial Safety Policy
                </h3>
              </div>
              <button
                onClick={() => setGatekeeperModal(null)}
                className="text-rose-200 hover:text-white text-xl font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 space-y-1.5">
                <div className="font-extrabold uppercase text-rose-800">
                  System Explanation:
                </div>
                <p className="text-rose-950 font-semibold">
                  &bull; <strong>Trigger:</strong>{" "}
                  {(gatekeeperModal.explainability?.why_it_happened || []).join(
                    " | "
                  )}
                </p>
                <p className="text-rose-950 font-semibold mono-num">
                  &bull; <strong>Data Used:</strong> Monthly Income:{" "}
                  {fmtINR(
                    gatekeeperModal.explainability?.data_used
                      ?.total_monthly_income
                  )}
                  , Total EMIs:{" "}
                  {fmtINR(
                    gatekeeperModal.explainability?.data_used?.total_monthly_emi
                  )}
                  , Runway:{" "}
                  {
                    gatekeeperModal.explainability?.data_used
                      ?.emergency_runway_months
                  }{" "}
                  Mos.
                </p>
                <p className="text-rose-950 font-semibold">
                  &bull; <strong>Policy Enforcement:</strong>{" "}
                  {gatekeeperModal.explainability?.policy_message}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="font-extrabold uppercase text-emerald-800 mb-1">
                  Resolution Steps (Recommended Safety Split):
                </div>
                <p className="text-emerald-950 font-semibold mono-num">
                  Route surplus into{" "}
                  {
                    gatekeeperModal.explainability?.recommendation?.equity_pct
                  }
                  % Equity /{" "}
                  {gatekeeperModal.explainability?.recommendation?.debt_pct}%
                  Debt Prepayment /{" "}
                  {
                    gatekeeperModal.explainability?.recommendation
                      ?.emergency_pct
                  }
                  % Liquid Emergency Buffer.
                </p>
              </div>

              {showOverrideInput && (
                <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-300 space-y-2">
                  <label className="font-bold text-slate-800 block">
                    Mandatory Audit Justification (&ge; 5 chars):
                  </label>
                  <input
                    type="text"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="e.g. Employer 100% matched retirement contribution"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() =>
                        submitAllocation(
                          gatekeeperModal.attempted.equity_pct,
                          gatekeeperModal.attempted.debt_pct,
                          gatekeeperModal.attempted.emergency_pct,
                          true,
                          overrideReason
                        )
                      }
                      className="px-4 py-2 bg-[#9F1239] text-white font-bold rounded-lg"
                    >
                      Confirm &amp; Log Audited Override
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => setShowOverrideInput(!showOverrideInput)}
                className="px-3.5 py-2 rounded-lg text-xs font-semibold text-[#9F1239] border border-rose-300 hover:bg-rose-50"
              >
                [ Override Policy (Requires Reason Log) ]
              </button>
              <button
                onClick={() => {
                  const rec = gatekeeperModal.explainability.recommendation;
                  setAllocEq(rec.equity_pct);
                  setAllocDebt(rec.debt_pct);
                  setAllocEm(rec.emergency_pct);
                  submitAllocation(
                    rec.equity_pct,
                    rec.debt_pct,
                    rec.emergency_pct,
                    false
                  );
                }}
                className="px-5 py-2 rounded-lg text-xs font-extrabold bg-[#10B981] hover:bg-emerald-600 text-white shadow-md"
              >
                [ Accept Safety Recommendation ]
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. FINANCIAL ONBOARDING & ENTRY MODAL (Incomes, Debts, Assets) */}
      {showAddEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <span className="p-1 rounded bg-emerald-500/20 text-emerald-400">⚡</span>
                  Add Financial Foundation Record
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Direct insert into PostgreSQL with automatic <code className="text-emerald-400 font-mono">fn_refresh_snapshot</code> trigger execution
                </p>
              </div>
              <button
                onClick={() => setShowAddEntryModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Type Switcher Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50 p-2 gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setEntryType("LIABILITY")}
                className={`flex-1 py-2 rounded-lg transition ${
                  entryType === "LIABILITY"
                    ? "bg-rose-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                💳 Liability / Loan (Debt)
              </button>
              <button
                type="button"
                onClick={() => setEntryType("INCOME")}
                className={`flex-1 py-2 rounded-lg transition ${
                  entryType === "INCOME"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                💰 Income Stream
              </button>
              <button
                type="button"
                onClick={() => setEntryType("ASSET")}
                className={`flex-1 py-2 rounded-lg transition ${
                  entryType === "ASSET"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                🏦 Liquid Reserve Asset
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddFinancialEntry} className="p-6 space-y-4 text-xs">
              {entryType === "LIABILITY" && (
                <>
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-medium leading-relaxed">
                    Inserting a high-APR loan (≥ 18%) will dynamically trip the <strong>`FS001` Fiduciary Gatekeeper</strong>, locking speculative equity allocations to 0%.
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Lender / Debt Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Axis Bank Platinum Credit Card"
                      value={entryForm.lender_name}
                      onChange={(e) => setEntryForm({ ...entryForm, lender_name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Principal Remaining (₹) *
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="e.g. 75000"
                        value={entryForm.principal_remaining}
                        onChange={(e) => setEntryForm({ ...entryForm, principal_remaining: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Annual APR (%) *
                      </label>
                      <input
                        type="number"
                        required
                        step="0.1"
                        min="0"
                        max="100"
                        placeholder="e.g. 36.0"
                        value={entryForm.annual_interest_rate}
                        onChange={(e) => setEntryForm({ ...entryForm, annual_interest_rate: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num font-bold text-rose-600"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Monthly EMI (₹) *
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="e.g. 6500"
                        value={entryForm.monthly_emi}
                        onChange={(e) => setEntryForm({ ...entryForm, monthly_emi: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        EMI Due Day (1-31)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="10"
                        value={entryForm.due_day}
                        onChange={(e) => setEntryForm({ ...entryForm, due_day: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num"
                      />
                    </div>
                  </div>
                </>
              )}

              {entryType === "INCOME" && (
                <>
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-medium leading-relaxed">
                    Adding recurring monthly income raises structural surplus and lowers the Debt-to-Income (DTI) ratio.
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Income Source Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Tech Consulting Retainer / Spouse Salary"
                      value={entryForm.source_name}
                      onChange={(e) => setEntryForm({ ...entryForm, source_name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Monthly Net Take-Home (₹) *
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="e.g. 50000"
                        value={entryForm.monthly_amount}
                        onChange={(e) => setEntryForm({ ...entryForm, monthly_amount: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num font-bold text-emerald-700"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-slate-700 block mb-1">
                        Pay Day of Month (1-31)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="1"
                        value={entryForm.pay_day}
                        onChange={(e) => setEntryForm({ ...entryForm, pay_day: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num"
                      />
                    </div>
                  </div>
                </>
              )}

              {entryType === "ASSET" && (
                <>
                  <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-medium leading-relaxed">
                    Liquid emergency funds directly extend the household's <strong>Survival Runway Months</strong>.
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Asset / Reserve Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. ICICI Emergency Fixed Deposit / Liquid Mutual Fund"
                      value={entryForm.asset_name}
                      onChange={(e) => setEntryForm({ ...entryForm, asset_name: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Current Liquid Balance (₹) *
                    </label>
                    <input
                      type="number"
                      required
                      min="1"
                      placeholder="e.g. 150000"
                      value={entryForm.current_balance}
                      onChange={(e) => setEntryForm({ ...entryForm, current_balance: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white mono-num font-bold text-indigo-700"
                    />
                  </div>
                </>
              )}

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddEntryModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-bold hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={entryLoading}
                  className="px-5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-extrabold shadow-md transition disabled:opacity-50"
                >
                  {entryLoading ? "Executing SQL Trigger..." : "Insert & Trigger Snapshot"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
