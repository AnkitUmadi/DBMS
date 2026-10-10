// public/app.js
// FinShield — Phase 5 Interactive Frontend Controller
// Connects to /api/v1/* endpoints across PostgreSQL 18, MongoDB 8.2, and pgvector.

const STATE = {
  households: [],
  activeHouseholdId: null,
  dashboard: null,
  forecastHorizon: 90,
  debtStrategy: "AVALANCHE",
  viewMode: "HOUSEHOLD",
  pendingAllocation: null,
  pendingRecommendation: null,
  cashflowChart: null,
  allocationChart: null,
};

// Format Indian Rupee currency cleanly
function fmtINR(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "₹0";
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

// Tier Visual Theme Config (per FinShield_UI_UX_Specification.pdf Section 2.1)
const TIER_THEME = {
  SAFE: {
    pillClass:
      "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40",
    dotClass: "bg-emerald-400",
    badgeLight: "bg-emerald-100 text-emerald-800 border border-emerald-300",
    accentHex: "#10B981",
  },
  CAUTION: {
    pillClass: "bg-amber-500/20 text-amber-300 border border-amber-400/40",
    dotClass: "bg-amber-400",
    badgeLight: "bg-amber-100 text-amber-900 border border-amber-300",
    accentHex: "#F59E0B",
  },
  CRITICAL: {
    pillClass: "bg-rose-500/25 text-rose-200 border border-rose-400/50",
    dotClass: "bg-rose-400",
    badgeLight: "bg-rose-100 text-rose-800 border border-rose-300",
    accentHex: "#F43F5E",
  },
  FREEZE: {
    pillClass: "bg-[#9F1239] text-rose-100 border border-rose-400/60",
    dotClass: "bg-rose-200",
    badgeLight: "bg-[#4C0519] text-rose-100 border border-rose-700",
    accentHex: "#9F1239",
  },
};

function showToast(title, message, type = "info") {
  const container = document.getElementById("toast-container");
  const colors = {
    success: "bg-emerald-950 text-emerald-100 border-emerald-500",
    warning: "bg-amber-950 text-amber-100 border-amber-500",
    error: "bg-[#4C0519] text-rose-100 border-rose-500",
    info: "bg-slate-900 text-slate-100 border-indigo-500",
  };

  const el = document.createElement("div");
  el.className = `pointer-events-auto p-3.5 rounded-xl border-l-4 shadow-xl text-xs transition-all duration-300 ${
    colors[type] || colors.info
  }`;
  el.innerHTML = `
    <div class="font-bold text-sm mb-0.5">${title}</div>
    <div class="opacity-90 leading-snug">${message}</div>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 4500);
}

// ---------------------------------------------------------------------------
// 1. INITIALIZATION & HOUSEHOLD SWITCHER
// ---------------------------------------------------------------------------
async function initApp() {
  await fetchHouseholdsList();
  const select = document.getElementById("household-select");
  select.addEventListener("change", (e) => {
    if (e.target.value) {
      selectHousehold(e.target.value);
    }
  });
}

async function fetchHouseholdsList(preserveCurrent = false) {
  const res = await fetch("/api/v1/households");
  const data = await res.json();
  STATE.households = data.households || [];

  const select = document.getElementById("household-select");
  select.innerHTML = STATE.households
    .map(
      (h) =>
        `<option value="${h.household_id}" class="bg-slate-900 text-white">
          [${h.current_tier}] ${h.household_name}
        </option>`
    )
    .join("");

  if (
    preserveCurrent &&
    STATE.activeHouseholdId &&
    STATE.households.some((h) => h.household_id === STATE.activeHouseholdId)
  ) {
    select.value = STATE.activeHouseholdId;
  } else if (STATE.households.length > 0) {
    STATE.activeHouseholdId = STATE.households[0].household_id;
    select.value = STATE.activeHouseholdId;
  }

  if (STATE.activeHouseholdId) {
    await loadAllHouseholdPanels(STATE.activeHouseholdId);
  }
}

async function selectHousehold(householdId) {
  STATE.activeHouseholdId = householdId;
  const select = document.getElementById("household-select");
  if (select.value !== householdId) select.value = householdId;
  await loadAllHouseholdPanels(householdId);
}

async function loadAllHouseholdPanels(householdId) {
  await Promise.all([
    loadDashboardData(householdId),
    loadForecast(STATE.forecastHorizon),
    loadDebtPlan(),
  ]);
  await runCustomSimulation();
}

// ---------------------------------------------------------------------------
// 2. LOAD CORE DASHBOARD STATE (SNAPSHOT + MONGODB + PGVECTOR PLAYBOOKS)
// ---------------------------------------------------------------------------
async function loadDashboardData(householdId) {
  const res = await fetch(`/api/v1/dashboard/${householdId}`);
  const data = await res.json();
  if (!res.ok) {
    showToast("Error Loading Household", data.error || "Unknown error", "error");
    return;
  }

  STATE.dashboard = data;
  renderHeaderAndKPIs(data);
  renderMongoSpendPanel(data);
  renderAllocationPanel(data);
  renderPlaybooksPanel(data.playbooks || []);
  renderSavedScenarioPills(data.saved_scenarios || []);
}

function renderHeaderAndKPIs(data) {
  const snap = data.snapshot;
  const theme = TIER_THEME[snap.current_tier] || TIER_THEME.FREEZE;

  // Header Tier Pill
  const badge = document.getElementById("header-tier-badge");
  badge.className = `px-3.5 py-1.5 rounded-full text-xs font-extrabold tracking-wider uppercase flex items-center gap-2 shadow-sm transition-all duration-300 ${theme.pillClass}`;
  document.getElementById("header-tier-dot").className = `w-2.5 h-2.5 rounded-full animate-pulse ${theme.dotClass}`;
  document.getElementById("header-tier-text").textContent = snap.current_tier;

  // Header Banner Reasons
  const reasons =
    snap.tier_reasons && snap.tier_reasons.length > 0
      ? snap.tier_reasons.join(" • ")
      : "All resilience thresholds satisfied (Runway >= 6m, DTI <= 30%, Spend <= Cap).";
  document.getElementById("banner-reasons-text").textContent = reasons;

  const earnerCount = (data.incomes || []).length;
  const depCount = (data.dependents || []).length;
  document.getElementById("banner-earners-info").textContent = `Income Streams: ${earnerCount} | Dependents: ${depCount}`;
  document.getElementById("banner-base-vs-current").innerHTML =
    snap.base_tier !== snap.current_tier
      ? `Base Tier: <strong class="text-amber-300">${snap.base_tier}</strong> &rarr; Escalated: <strong class="text-rose-300">${snap.current_tier}</strong>`
      : `Base Tier: <strong>${snap.base_tier}</strong> &rarr; Active: <strong>${snap.current_tier}</strong>`;

  // KPI 1: Emergency Runway
  const runway = Number(snap.emergency_runway_months || 0);
  const monthlyBurn =
    Number(snap.total_baseline_costs || 0) + Number(snap.total_monthly_emi || 0);
  document.getElementById("kpi-runway-val").textContent = runway.toFixed(2);
  document.getElementById("kpi-runway-sub").textContent = `Reserves: ${fmtINR(
    snap.total_liquid_reserves
  )} / Burn: ${fmtINR(monthlyBurn)}`;
  const runwayPct = Math.min(Math.max((runway / 6.0) * 100, 3), 100);
  const rBar = document.getElementById("kpi-runway-bar");
  rBar.style.width = `${runwayPct}%`;
  rBar.className = `h-full rounded-full transition-all duration-500 ${
    runway >= 6
      ? "bg-emerald-500"
      : runway >= 3
      ? "bg-amber-500"
      : "bg-rose-600"
  }`;

  // KPI 2: DTI Ratio
  const dti = Number(snap.dti_ratio || 0);
  document.getElementById("kpi-dti-val").textContent = `${dti.toFixed(2)}%`;
  document.getElementById("kpi-dti-sub").textContent = `EMI: ${fmtINR(
    snap.total_monthly_emi
  )} / Income: ${fmtINR(snap.total_monthly_income)}`;
  const dtiPct = Math.min(Math.max(dti, 3), 100);
  const dBar = document.getElementById("kpi-dti-bar");
  dBar.style.width = `${dtiPct}%`;
  dBar.className = `h-full rounded-full transition-all duration-500 ${
    dti <= 30 ? "bg-emerald-500" : dti <= 45 ? "bg-amber-500" : "bg-rose-600"
  }`;

  // KPI 3: Monthly Net Surplus & MongoDB Spend Guardrail
  const surplus = Number(snap.structural_surplus || 0);
  const mtd = Number(snap.discretionary_mtd || 0);
  const cap = Number(snap.discretionary_cap || 0);
  const sValEl = document.getElementById("kpi-surplus-val");
  sValEl.textContent = fmtINR(surplus);
  sValEl.className = `text-3xl font-extrabold mono-num ${
    surplus < 0 ? "text-rose-600" : "text-slate-900"
  }`;
  document.getElementById("kpi-surplus-sub").textContent = `MTD Spend: ${fmtINR(
    mtd
  )} / Cap: ${fmtINR(cap)}`;

  const mtdPct = cap > 0 ? Math.min((mtd / cap) * 100, 100) : mtd > 0 ? 100 : 0;
  const mBar = document.getElementById("kpi-mtd-bar");
  mBar.style.width = `${mtdPct}%`;
  mBar.className = `h-full rounded-full transition-all duration-500 ${
    mtd > cap ? "bg-rose-600" : mtdPct > 80 ? "bg-amber-500" : "bg-indigo-600"
  }`;
  document.getElementById("kpi-mtd-pct-label").textContent =
    cap > 0
      ? `${((mtd / cap) * 100).toFixed(0)}% of Cap (${
          data.custom_cap_override !== null ? "Custom Override" : "50% Surplus"
        })`
      : "0 Cap (Deficit Freeze)";

  // KPI 4: Expense Rigidity Index
  const rig = Number(snap.rigidity_ratio || 0);
  document.getElementById("kpi-rigidity-val").textContent = `${rig.toFixed(1)}%`;
  document.getElementById("kpi-rigidity-sub").textContent = `Baseline: ${fmtINR(
    snap.total_baseline_costs
  )} + EMI: ${fmtINR(snap.total_monthly_emi)}`;
  const rigBar = document.getElementById("kpi-rigidity-bar");
  rigBar.style.width = `${Math.min(Math.max(rig, 3), 100)}%`;
  rigBar.className = `h-full rounded-full transition-all duration-500 ${
    rig > 85 ? "bg-rose-600" : rig > 65 ? "bg-amber-500" : "bg-slate-800"
  }`;
}

// ---------------------------------------------------------------------------
// 3. 30/60/90-DAY CASHFLOW TRAJECTORY CHART (fn_forecast_cashflow_90d)
// ---------------------------------------------------------------------------
async function loadForecast(days = 90) {
  STATE.forecastHorizon = days;
  [30, 60, 90].forEach((d) => {
    const btn = document.getElementById(`btn-fc-${d}`);
    if (btn) {
      btn.className =
        d === days
          ? "px-2.5 py-1 rounded text-xs font-semibold bg-white text-slate-900 shadow-sm"
          : "px-2.5 py-1 rounded text-xs font-semibold text-slate-600 hover:text-slate-900";
    }
  });

  if (!STATE.activeHouseholdId) return;
  const res = await fetch(
    `/api/v1/forecast/${STATE.activeHouseholdId}?days=${days}`
  );
  const data = await res.json();
  if (!res.ok) return;

  const series = data.series || [];
  const startBal =
    series.length > 0
      ? series[0].projected_balance - series[0].net_daily_flow
      : 0;
  document.getElementById("fc-start-bal").textContent = fmtINR(startBal);

  const minEl = document.getElementById("fc-min-bal");
  minEl.textContent = fmtINR(data.lowest_projected_balance);
  minEl.className = `text-sm font-bold mono-num ${
    data.lowest_projected_balance < 0 ? "text-rose-600" : "text-slate-900"
  }`;

  const defEl = document.getElementById("fc-deficit-status");
  if (data.deficit_day_count > 0) {
    defEl.textContent = `${data.deficit_day_count} Deficit Days (First: ${data.first_deficit_date})`;
    defEl.className = "text-xs font-bold mono-num text-rose-600";
  } else {
    defEl.textContent = `0 Deficit Days (Solvent across ${days}D)`;
    defEl.className = "text-xs font-bold mono-num text-emerald-600";
  }

  // Render Scheduled Cashflow Pills
  if (STATE.dashboard) {
    const pills = [];
    (STATE.dashboard.incomes || []).forEach((inc) => {
      pills.push(
        `<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 mono-num">Day ${inc.pay_day_of_month}: +${fmtINR(inc.monthly_amount)} (${inc.source_name})</span>`
      );
    });
    (STATE.dashboard.baseline_expenses || []).slice(0, 2).forEach((b) => {
      pills.push(
        `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 mono-num">Day ${b.due_day_of_month}: -${fmtINR(b.monthly_amount)} (${b.category_name})</span>`
      );
    });
    document.getElementById("fc-schedule-pills").innerHTML = pills.join("");
  }

  // Render Chart.js
  const ctx = document.getElementById("cashflowChart").getContext("2d");
  if (STATE.cashflowChart) {
    STATE.cashflowChart.destroy();
  }

  const labels = series.map((r) => r.forecast_date.slice(5)); // MM-DD
  const balances = series.map((r) => r.projected_balance);
  const pointColors = series.map((r) =>
    r.is_deficit
      ? "#F43F5E"
      : r.daily_inflow > 0
      ? "#10B981"
      : r.daily_outflow > 0
      ? "#F59E0B"
      : "#6366F1"
  );

  STATE.cashflowChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Projected Liquid Balance (₹)",
          data: balances,
          borderColor: data.deficit_day_count > 0 ? "#F43F5E" : "#6366F1",
          backgroundColor:
            data.deficit_day_count > 0
              ? "rgba(244, 63, 94, 0.10)"
              : "rgba(99, 102, 241, 0.10)",
          borderWidth: 2.2,
          pointBackgroundColor: pointColors,
          pointRadius: series.map((r) =>
            r.daily_inflow > 0 || r.daily_outflow > 0 || r.is_deficit ? 3.5 : 0
          ),
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctxItem) => {
              const row = series[ctxItem.dataIndex];
              const parts = [`Balance: ${fmtINR(row.projected_balance)}`];
              if (row.daily_inflow > 0)
                parts.push(`+Inflow: ${fmtINR(row.daily_inflow)}`);
              if (row.daily_outflow > 0)
                parts.push(`-Outflow: ${fmtINR(row.daily_outflow)}`);
              if (row.is_deficit) parts.push(`⚠️ DEFICIT BREACH`);
              return parts;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 10, font: { size: 10, family: "JetBrains Mono" } },
        },
        y: {
          grid: { color: "#F1F5F9" },
          ticks: {
            font: { size: 10, family: "JetBrains Mono" },
            callback: (v) => fmtINR(v),
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// 4. DEBT PAYOFF OPTIMIZER (AVALANCHE VS SNOWBALL)
// ---------------------------------------------------------------------------
function changeDebtStrategy(strategy) {
  STATE.debtStrategy = strategy;
  const btnAv = document.getElementById("btn-strat-avalanche");
  const btnSn = document.getElementById("btn-strat-snowball");
  if (strategy === "AVALANCHE") {
    btnAv.className =
      "px-3 py-1 rounded-md text-xs font-bold bg-indigo-600 text-white shadow-sm transition";
    btnSn.className =
      "px-3 py-1 rounded-md text-xs font-bold text-slate-600 hover:text-slate-900 transition";
  } else {
    btnSn.className =
      "px-3 py-1 rounded-md text-xs font-bold bg-indigo-600 text-white shadow-sm transition";
    btnAv.className =
      "px-3 py-1 rounded-md text-xs font-bold text-slate-600 hover:text-slate-900 transition";
  }
  loadDebtPlan();
}

async function loadDebtPlan() {
  if (!STATE.activeHouseholdId) return;
  const surplus = Number(
    document.getElementById("debt-surplus-input").value || 0
  );

  const res = await fetch(
    `/api/v1/debt-plan/${STATE.activeHouseholdId}?strategy=${STATE.debtStrategy}&surplus=${surplus}`
  );
  const data = await res.json();
  if (!res.ok) return;

  const comp = data.comparison;
  document.getElementById("debt-interest-saved").textContent = fmtINR(
    comp.interest_saved_vs_baseline
  );
  document.getElementById("debt-months-total").textContent = `${comp.active_strategy.total_months} mo (${comp.months_saved_vs_baseline}m faster)`;
  document.getElementById("debt-avalanche-edge").textContent = fmtINR(
    comp.avalanche_interest_advantage
  );

  const listEl = document.getElementById("debt-schedule-list");
  if (!data.schedule || data.schedule.length === 0) {
    listEl.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">Zero active liabilities for this household.</div>`;
    return;
  }

  listEl.innerHTML = data.schedule
    .map((d) => {
      const isTop = d.priority_rank === 1;
      return `
        <div class="p-3 rounded-xl border transition ${
          isTop
            ? "bg-indigo-50/60 border-indigo-300 shadow-sm"
            : "bg-white border-slate-200"
        }">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-mono font-extrabold ${
                isTop
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-700"
              }">
                #${d.priority_rank} ${isTop ? "TARGET" : ""}
              </span>
              <span class="font-bold text-xs text-slate-900">${d.lender_name}</span>
            </div>
            <span class="mono-num text-xs font-extrabold ${
              d.annual_rate >= 20 ? "text-rose-600" : "text-slate-700"
            }">
              ${Number(d.annual_rate).toFixed(2)}% APR
            </span>
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-between text-[11px] text-slate-600 mono-num gap-2">
            <span>Principal: <strong class="text-slate-900">${fmtINR(d.principal_remaining)}</strong></span>
            <span>Base EMI: ${fmtINR(d.monthly_emi)}</span>
            <span class="${isTop && d.extra_payment_alloc > 0 ? "text-emerald-700 font-bold" : ""}">
              Total Pay: ${fmtINR(d.total_monthly_pay)} ${
        isTop && d.extra_payment_alloc > 0
          ? `(+${fmtINR(d.extra_payment_alloc)})`
          : ""
      }
            </span>
          </div>
        </div>
      `;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// 5. MONGODB DAILY SPEND ENGINE & P2P SPLIT / REFUND RECONCILER
// ---------------------------------------------------------------------------
function renderMongoSpendPanel(data) {
  const txs = (data.mongo && data.mongo.transactions) || [];
  const cats = (data.mongo && data.mongo.category_breakdown) || [];

  document.getElementById("mongo-tx-count").textContent = txs.length;

  // Render Category Aggregation Pills
  const catContainer = document.getElementById("mongo-category-pills");
  if (cats.length === 0) {
    catContainer.innerHTML = `<span class="text-xs text-slate-400">No expenses logged this month.</span>`;
  } else {
    catContainer.innerHTML = cats
      .map(
        (c) => `
        <span class="px-2.5 py-1 rounded-full text-[11px] font-medium border ${
          c.is_discretionary
            ? "bg-white border-slate-200 text-slate-700"
            : "bg-slate-100 border-slate-300 text-slate-500"
        }">
          ${c.category}: <strong class="mono-num">${fmtINR(c.total_amount)}</strong> (${c.tx_count})
        </span>
      `
      )
      .join("");
  }

  // Render Transaction Table Rows
  const tbody = document.getElementById("mongo-tx-tbody");
  if (txs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">No MongoDB documents in current month window.</td></tr>`;
    return;
  }

  tbody.innerHTML = txs
    .map((tx) => {
      const mName =
        (tx.merchant_metadata && tx.merchant_metadata.name) || "Merchant";
      const halfAmt = Number((tx.amount / 2).toFixed(2));
      return `
        <tr class="hover:bg-slate-50/80">
          <td class="py-2.5 px-3">
            <div class="font-bold text-slate-900">${mName}</div>
            <div class="text-[11px] text-slate-500">${tx.category} &bull; <code class="font-mono text-[10px]">${tx.expense_id}</code></div>
          </td>
          <td class="py-2.5 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              tx.is_discretionary
                ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                : "bg-slate-100 text-slate-600"
            }">
              ${tx.is_discretionary ? "Discretionary" : "Baseline/Reconciled"}
            </span>
          </td>
          <td class="py-2.5 px-3 text-right font-bold mono-num text-slate-900">
            ${fmtINR(tx.amount)}
          </td>
          <td class="py-2.5 px-3 text-right space-x-1">
            <button onclick="reconcileExpense('${tx.expense_id}', ${halfAmt})"
              title="Friend sent 50% bill split via UPI"
              class="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold text-[11px] transition">
              Split 50% (-${fmtINR(halfAmt)})
            </button>
            <button onclick="reconcileExpense('${tx.expense_id}', 'FULL')"
              title="Full merchant refund / delete expense"
              class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-[11px] transition">
              Refund
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function submitNewExpense(e) {
  e.preventDefault();
  if (!STATE.dashboard || !STATE.dashboard.users[0]) return;

  const amount = Number(document.getElementById("exp-amount").value);
  const category = document.getElementById("exp-category").value;
  const merchant = document.getElementById("exp-merchant").value;
  const mode = document.getElementById("exp-mode").value;
  const isDisc = document.getElementById("exp-discretionary").checked;

  await postExpenseDocument({
    household_id: STATE.activeHouseholdId,
    user_id: STATE.dashboard.users[0].user_id,
    amount,
    category,
    is_discretionary: isDisc,
    merchant_name: merchant,
    payment_mode: mode,
  });

  document.getElementById("exp-amount").value = "";
}

async function triggerOverspendSpike() {
  if (!STATE.dashboard || !STATE.dashboard.users[0]) return;
  const prevTier = STATE.dashboard.snapshot.current_tier;

  await postExpenseDocument({
    household_id: STATE.activeHouseholdId,
    user_id: STATE.dashboard.users[0].user_id,
    amount: 45000,
    category: "Impulse Luxury & Electronics Spike",
    is_discretionary: true,
    merchant_name: "Apple Flagship Store",
    payment_mode: "CREDIT_CARD",
  });

  const newTier = STATE.dashboard.snapshot.current_tier;
  if (prevTier !== newTier) {
    showToast(
      `Tier Escalated: ${prevTier} → ${newTier}`,
      `MongoDB MTD aggregation exceeded the 50% discretionary cap. PostgreSQL trigger automatically escalated household tier!`,
      "warning"
    );
  }
}

async function triggerInvalidMongoSchemaTest() {
  if (!STATE.dashboard || !STATE.dashboard.users[0]) return;
  await postExpenseDocument({
    household_id: STATE.activeHouseholdId,
    user_id: STATE.dashboard.users[0].user_id,
    amount: -500, // Negative amount violates MongoDB $jsonSchema minimum: 0
    category: "Invalid Negative Spend Test",
    is_discretionary: true,
    merchant_name: "Malformed Webhook Payload",
    payment_mode: "UPI",
  });
}

async function postExpenseDocument(payload) {
  const res = await fetch("/api/v1/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    showToast(
      `MongoDB Validator Blocked Write (Code ${data.code || res.status})`,
      data.error || "Document failed validation",
      "error"
    );
    return;
  }

  showToast(
    "MongoDB → PostgreSQL Sync Complete",
    `Logged ${fmtINR(payload.amount)} (${payload.category}). Updated MTD Spend: ${fmtINR(
      data.snapshot.discretionary_mtd
    )} | Active Tier: ${data.snapshot.current_tier}`,
    "success"
  );

  await fetchHouseholdsList(true);
}

async function reconcileExpense(expenseId, refundAmount) {
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
  if (!res.ok) {
    showToast("Refund Error", data.error || "Could not process refund", "error");
    return;
  }

  showToast(
    "P2P Split / Refund Reconciled",
    `MongoDB pipeline recalculated MTD Spend to ${fmtINR(
      data.snapshot.discretionary_mtd
    )}. Active Tier: ${data.snapshot.current_tier}`,
    "success"
  );
  await fetchHouseholdsList(true);
}

async function promptCustomCapOverride() {
  if (!STATE.dashboard) return;
  const snap = STATE.dashboard.snapshot;
  const defaultCap = Math.max(Number(snap.structural_surplus) * 0.5, 0);
  const input = window.prompt(
    `Enter a stricter custom monthly discretionary cap in ₹ (Must be <= default 50% surplus cap of ${fmtINR(
      defaultCap
    )}).\nLeave blank to reset to default 50% cap:`,
    STATE.dashboard.custom_cap_override !== null
      ? STATE.dashboard.custom_cap_override
      : Math.round(defaultCap * 0.75)
  );

  if (input === null) return;

  const res = await fetch("/api/v1/cap-override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      household_id: STATE.activeHouseholdId,
      cap_override: input.trim() === "" ? null : Number(input),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    showToast("Cap Override Rejected", data.error, "error");
    return;
  }

  showToast(
    "Discretionary Cap Updated",
    `Effective Cap: ${fmtINR(data.snapshot.effective_cap)} | Active Tier: ${
      data.snapshot.current_tier
    }`,
    "info"
  );
  await fetchHouseholdsList(true);
}

// ---------------------------------------------------------------------------
// 6. RISK-CONSTRAINED ASSET ALLOCATION & GATEKEEPER FS001 MODAL
// ---------------------------------------------------------------------------
function renderAllocationPanel(data) {
  const pol = data.allocation_policy;
  const act = data.active_allocation;

  const maxBadge = document.getElementById("alloc-max-badge");
  maxBadge.textContent = `Max Equity: ${Number(pol.allowed_equity_max).toFixed(0)}%`;
  maxBadge.className = `text-[11px] font-mono font-bold px-2.5 py-1 rounded-full ${
    pol.allowed_equity_max === 100
      ? "bg-emerald-100 text-emerald-800"
      : pol.allowed_equity_max === 25
      ? "bg-amber-100 text-amber-900"
      : "bg-rose-100 text-rose-800"
  }`;

  document.getElementById("alloc-policy-banner").innerHTML = `
    <div class="font-bold text-slate-900 mb-0.5">Policy Status: <span class="mono-num">${pol.action_status}</span></div>
    <div class="text-slate-600">${pol.policy_message}</div>
  `;

  const eq = act ? Number(act.equity_pct) : Number(pol.recommended_equity);
  const dt = act ? Number(act.debt_pct) : Number(pol.recommended_debt);
  const em = act ? Number(act.emergency_pct) : Number(pol.recommended_emergency);

  setAllocationSliders(eq, dt, em);

  document.getElementById("active-alloc-foot").textContent = act
    ? `Active saved split: ${act.equity_pct}% Eq / ${act.debt_pct}% Debt / ${act.emergency_pct}% Buffer ${
        act.is_override ? "(AUDITED OVERRIDE)" : ""
      }`
    : "No saved allocation yet";
}

function setAllocationSliders(eq, dt, em) {
  document.getElementById("inp-alloc-eq").value = eq;
  document.getElementById("inp-alloc-debt").value = dt;
  document.getElementById("inp-alloc-em").value = em;
  document.getElementById("lbl-alloc-eq").textContent = `${eq}%`;
  document.getElementById("lbl-alloc-debt").textContent = `${dt}%`;
  document.getElementById("lbl-alloc-em").textContent = `${em}%`;
  updateAllocationDonut(eq, dt, em);
}

function rebalanceSliders(changed) {
  let eq = Number(document.getElementById("inp-alloc-eq").value);
  let dt = Number(document.getElementById("inp-alloc-debt").value);
  let em = Number(document.getElementById("inp-alloc-em").value);

  if (changed === "eq") {
    const rem = 100 - eq;
    dt = Math.min(dt, rem);
    em = rem - dt;
  } else if (changed === "debt") {
    const rem = 100 - dt;
    eq = Math.min(eq, rem);
    em = rem - eq;
  } else {
    const rem = 100 - em;
    eq = Math.min(eq, rem);
    dt = rem - eq;
  }

  setAllocationSliders(eq, dt, em);
}

function updateAllocationDonut(eq, dt, em) {
  const ctx = document.getElementById("allocationChart").getContext("2d");
  if (STATE.allocationChart) {
    STATE.allocationChart.data.datasets[0].data = [eq, dt, em];
    STATE.allocationChart.update();
    return;
  }

  STATE.allocationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Equity SIP", "Debt / Prepay", "Emergency Buffer"],
      datasets: [
        {
          data: [eq, dt, em],
          backgroundColor: ["#6366F1", "#F59E0B", "#10B981"],
          borderWidth: 2,
          borderColor: "#FFFFFF",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "66%",
      plugins: {
        legend: { display: false },
      },
    },
  });
}

async function testGatekeeperBlock() {
  setAllocationSliders(70, 20, 10);
  await submitAllocation(false);
}

async function submitAllocation(isOverride = false, overrideReason = null) {
  if (!STATE.dashboard || !STATE.dashboard.users[0]) return;

  const eq = Number(document.getElementById("inp-alloc-eq").value);
  const dt = Number(document.getElementById("inp-alloc-debt").value);
  const em = Number(document.getElementById("inp-alloc-em").value);

  const res = await fetch("/api/v1/allocations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      household_id: STATE.activeHouseholdId,
      user_id: STATE.dashboard.users[0].user_id,
      equity_pct: eq,
      debt_pct: dt,
      emergency_pct: em,
      is_override: isOverride,
      override_reason: overrideReason,
    }),
  });
  const data = await res.json();

  if (res.status === 403 && data.code === "FS001") {
    openGatekeeperModal(data);
    return;
  }

  if (!res.ok) {
    showToast("Allocation Error", data.error || "Failed to save", "error");
    return;
  }

  closeGatekeeperModal();
  showToast(
    isOverride
      ? "Audited Policy Override Recorded"
      : "Compliant Asset Allocation Saved",
    `Saved ${eq}% Equity / ${dt}% Debt / ${em}% Emergency Buffer.`,
    isOverride ? "warning" : "success"
  );
  await loadDashboardData(STATE.activeHouseholdId);
}

function openGatekeeperModal(blockPayload) {
  const exp = blockPayload.explainability;
  STATE.pendingAllocation = blockPayload.attempted;
  STATE.pendingRecommendation = exp.recommendation;

  document.getElementById("modal-what-happened").textContent =
    exp.what_happened;

  const reasons =
    exp.why_it_happened && exp.why_it_happened.length > 0
      ? exp.why_it_happened
      : ["Household risk tier restricts speculative wealth allocations."];
  document.getElementById("modal-why-list").innerHTML = reasons
    .map((r) => `<li>${r}</li>`)
    .join("");

  document.getElementById("modal-data-tier").textContent =
    exp.data_used.current_tier;
  document.getElementById("modal-data-dti").textContent = `${Number(
    exp.data_used.dti_ratio || 0
  ).toFixed(2)}%`;
  document.getElementById("modal-data-runway").textContent = `${Number(
    exp.data_used.emergency_runway_months || 0
  ).toFixed(2)}m`;
  document.getElementById("modal-data-max-eq").textContent = `<= ${Number(
    exp.recommendation.allowed_equity_max
  ).toFixed(0)}%`;

  document.getElementById(
    "modal-rec-summary"
  ).textContent = `Equity: ${exp.recommendation.equity_pct}% | Debt: ${exp.recommendation.debt_pct}% | Buffer: ${exp.recommendation.emergency_pct}%`;
  document.getElementById("modal-policy-msg").textContent = exp.policy_message;

  document.getElementById("modal-override-section").classList.add("hidden");
  document.getElementById("modal-override-reason").value = "";
  document.getElementById("gatekeeper-modal").classList.remove("hidden");
}

function closeGatekeeperModal() {
  document.getElementById("gatekeeper-modal").classList.add("hidden");
}

function toggleOverrideInput() {
  document.getElementById("modal-override-section").classList.toggle("hidden");
}

async function acceptSafetyRecommendation() {
  if (!STATE.pendingRecommendation) return;
  const rec = STATE.pendingRecommendation;
  setAllocationSliders(rec.equity_pct, rec.debt_pct, rec.emergency_pct);
  await submitAllocation(false, null);
}

async function confirmPolicyOverride() {
  const reason = document.getElementById("modal-override-reason").value.trim();
  if (reason.length < 5) {
    showToast(
      "Justification Too Short",
      "PostgreSQL constraint CHK_OVERRIDE_REASON_REQUIRED requires at least 5 characters.",
      "error"
    );
    return;
  }
  await submitAllocation(true, reason);
}

// ---------------------------------------------------------------------------
// 7. PGVECTOR SEMANTIC RECOVERY PLAYBOOKS
// ---------------------------------------------------------------------------
function renderPlaybooksPanel(playbooks) {
  const container = document.getElementById("playbooks-container");
  if (!playbooks || playbooks.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-400 p-4 text-center">No playbooks found.</div>`;
    return;
  }

  container.innerHTML = playbooks
    .map((pb, idx) => {
      const simPct = (Number(pb.similarity_score || 0) * 100).toFixed(1);
      const stepsHtml = (pb.action_steps || [])
        .map(
          (st) => `
          <li class="flex items-start gap-1.5 text-[11px] text-slate-700">
            <span class="text-indigo-600 font-bold mt-0.5">&rarr;</span>
            <span>${st}</span>
          </li>
        `
        )
        .join("");

      return `
        <div class="p-3.5 rounded-xl border ${
          idx === 0
            ? "bg-indigo-50/40 border-indigo-200"
            : "bg-slate-50/70 border-slate-200"
        }">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
              ${pb.category_tag}
            </span>
            <span class="text-[11px] font-mono font-extrabold text-indigo-700">
              Cosine Sim: ${simPct}%
            </span>
          </div>
          <h3 class="text-xs font-bold text-slate-900 mt-1.5">${pb.title}</h3>
          <p class="text-[11px] text-slate-600 mt-1 leading-relaxed">${pb.content_text}</p>
          <ul class="mt-2 pt-2 border-t border-slate-200/70 space-y-1">
            ${stepsHtml}
          </ul>
        </div>
      `;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// 8. NON-DESTRUCTIVE WHAT-IF SCENARIO SIMULATOR (fn_simulate_scenario)
// ---------------------------------------------------------------------------
function renderSavedScenarioPills(scenarios) {
  const el = document.getElementById("saved-scenarios-pills");
  if (!scenarios || scenarios.length === 0) {
    el.innerHTML = `<span class="text-xs text-slate-400">None</span>`;
    return;
  }

  el.innerHTML = scenarios
    .map(
      (sc) => `
      <button onclick='applySavedScenario(${JSON.stringify(sc.params)})'
        class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 transition">
        ${sc.scenario_name}
      </button>
    `
    )
    .join("");
}

function applySavedScenario(params) {
  document.getElementById("sim-drop-primary").checked = Boolean(
    params.drop_primary_earner
  );
  document.getElementById("sim-inc-delta").value = Number(
    params.income_delta || 0
  );
  document.getElementById("sim-base-pct").value = Number(
    params.baseline_pct_change || 0
  );
  document.getElementById("sim-emi-delta").value = Number(
    params.emi_delta || 0
  );
  document.getElementById("sim-res-delta").value = Number(
    params.reserve_delta || 0
  );
  runCustomSimulation();
}

function resetSimulatorInputs() {
  document.getElementById("sim-drop-primary").checked = false;
  document.getElementById("sim-inc-delta").value = 0;
  document.getElementById("sim-base-pct").value = 0;
  document.getElementById("sim-emi-delta").value = 0;
  document.getElementById("sim-res-delta").value = 0;
  runCustomSimulation();
}

async function runCustomSimulation() {
  if (!STATE.activeHouseholdId) return;

  const params = {
    drop_primary_earner: document.getElementById("sim-drop-primary").checked,
    income_delta: Number(document.getElementById("sim-inc-delta").value || 0),
    baseline_pct_change: Number(
      document.getElementById("sim-base-pct").value || 0
    ),
    emi_delta: Number(document.getElementById("sim-emi-delta").value || 0),
    reserve_delta: Number(document.getElementById("sim-res-delta").value || 0),
  };

  const res = await fetch("/api/v1/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      household_id: STATE.activeHouseholdId,
      params,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.simulation) return;

  const sim = data.simulation;
  const box = document.getElementById("sim-results-box");
  const simTheme = TIER_THEME[sim.sim_tier] || TIER_THEME.FREEZE;

  box.innerHTML = `
    <div class="flex items-center justify-between pb-2 border-b border-slate-100">
      <span class="text-[11px] font-bold uppercase text-slate-500">Simulated Tier Outcome</span>
      <span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold mono-num ${simTheme.badgeLight}">
        ${sim.live_tier} &rarr; ${sim.sim_tier}
      </span>
    </div>
    <div class="grid grid-cols-3 gap-2 text-center mono-num text-xs pt-1">
      <div class="p-1.5 rounded bg-slate-50">
        <span class="text-[10px] text-slate-400 block font-sans">Runway</span>
        <strong>${Number(sim.live_runway_months).toFixed(2)}m</strong> &rarr;
        <strong class="${
          sim.sim_runway_months < sim.live_runway_months
            ? "text-rose-600"
            : "text-emerald-600"
        }">${Number(sim.sim_runway_months).toFixed(2)}m</strong>
      </div>
      <div class="p-1.5 rounded bg-slate-50">
        <span class="text-[10px] text-slate-400 block font-sans">DTI Ratio</span>
        <strong>${Number(sim.live_dti_ratio || 0).toFixed(1)}%</strong> &rarr;
        <strong class="${
          Number(sim.sim_dti_ratio || 100) > Number(sim.live_dti_ratio || 0)
            ? "text-rose-600"
            : "text-emerald-600"
        }">${sim.sim_dti_ratio !== null ? Number(sim.sim_dti_ratio).toFixed(1) + "%" : "N/A"}</strong>
      </div>
      <div class="p-1.5 rounded bg-slate-50">
        <span class="text-[10px] text-slate-400 block font-sans">Surplus</span>
        <strong class="${sim.sim_surplus < 0 ? "text-rose-600" : "text-slate-900"}">${fmtINR(
    sim.sim_surplus
  )}</strong>
      </div>
    </div>
    <div class="text-[11px] text-slate-500 pt-1">
      ${
        sim.sim_tier_reasons && sim.sim_tier_reasons.length > 0
          ? sim.sim_tier_reasons.join(" • ")
          : "Household remains resilient in SAFE tier under simulated parameters."
      }
    </div>
  `;
}

// ---------------------------------------------------------------------------
// 9. COACH & MULTI-TENANT RLS AUDIT PORTAL
// ---------------------------------------------------------------------------
function switchViewMode(mode) {
  STATE.viewMode = mode;
  const vHouse = document.getElementById("view-household");
  const vCoach = document.getElementById("view-coach");
  const btnH = document.getElementById("btn-view-household");
  const btnC = document.getElementById("btn-view-coach");

  if (mode === "COACH") {
    vHouse.classList.add("hidden");
    vCoach.classList.remove("hidden");
    btnC.className =
      "px-3 py-1.5 rounded-md text-xs font-semibold transition-all bg-indigo-600 text-white shadow";
    btnH.className =
      "px-3 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-300 hover:text-white";
    loadCoachOverview();
  } else {
    vCoach.classList.add("hidden");
    vHouse.classList.remove("hidden");
    btnH.className =
      "px-3 py-1.5 rounded-md text-xs font-semibold transition-all bg-indigo-600 text-white shadow";
    btnC.className =
      "px-3 py-1.5 rounded-md text-xs font-semibold transition-all text-slate-300 hover:text-white";
  }
}

async function loadCoachOverview() {
  const res = await fetch("/api/v1/coach/overview");
  const data = await res.json();
  if (!res.ok) return;

  if (data.rls_session) {
    document.getElementById("coach-rls-role").textContent = `'${data.rls_session.active_rls_role}'`;
    document.getElementById("coach-rls-uid").textContent =
      data.rls_session.active_rls_user_id;
  }

  const hrTbody = document.getElementById("coach-high-risk-tbody");
  const cohort = data.high_risk_cohort || [];
  if (cohort.length === 0) {
    hrTbody.innerHTML = `<tr><td colspan="9" class="py-6 text-center text-slate-400">No households currently in CRITICAL/FREEZE cohort.</td></tr>`;
  } else {
    hrTbody.innerHTML = cohort
      .map((r) => {
        const tTheme = TIER_THEME[r.current_tier] || TIER_THEME.FREEZE;
        return `
          <tr class="hover:bg-slate-50">
            <td class="py-3 px-4 font-extrabold mono-num text-slate-900">
              #${r.dti_risk_rank}
            </td>
            <td class="py-3 px-4 font-bold text-slate-900">${r.household_name}</td>
            <td class="py-3 px-4">
              <span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold mono-num ${tTheme.badgeLight}">
                ${r.current_tier}
              </span>
            </td>
            <td class="py-3 px-4 text-right mono-num">${fmtINR(r.total_monthly_income)}</td>
            <td class="py-3 px-4 text-right mono-num">${fmtINR(r.total_monthly_emi)}</td>
            <td class="py-3 px-4 text-right font-bold mono-num text-rose-600">${Number(
              r.dti_ratio
            ).toFixed(2)}%</td>
            <td class="py-3 px-4 text-right font-bold mono-num">${Number(
              r.emergency_runway_months
            ).toFixed(2)}m</td>
            <td class="py-3 px-4 text-center mono-num">${r.active_debt_count}</td>
            <td class="py-3 px-4 text-right">
              <button onclick="inspectHouseholdFromCoach('${r.household_id}')"
                class="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs">
                Inspect &rarr;
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  const auditTbody = document.getElementById("coach-audit-tbody");
  const logs = data.audit_logs || [];
  auditTbody.innerHTML = logs
    .map((l) => {
      const tTheme = TIER_THEME[l.enforced_tier] || TIER_THEME.FREEZE;
      return `
        <tr class="hover:bg-slate-50">
          <td class="py-2.5 px-4 mono-num text-[11px] text-slate-500">
            ${new Date(l.logged_at).toLocaleString()}
          </td>
          <td class="py-2.5 px-4">
            <div class="font-bold text-slate-900">${l.user_name}</div>
            <div class="text-[11px] text-slate-500">${l.household_name || ""}</div>
          </td>
          <td class="py-2.5 px-4 font-mono font-bold text-slate-800">${l.attempted_action}</td>
          <td class="py-2.5 px-4">
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold mono-num ${tTheme.badgeLight}">
              ${l.enforced_tier}
            </span>
          </td>
          <td class="py-2.5 px-4">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              l.action_blocked
                ? "bg-rose-100 text-rose-800"
                : "bg-amber-100 text-amber-900"
            }">
              ${l.action_blocked ? "BLOCKED (FS001)" : "USER OVERRIDE"}
            </span>
          </td>
          <td class="py-2.5 px-4 text-slate-600">${l.override_reason || "--"}</td>
        </tr>
      `;
    })
    .join("");
}

async function inspectHouseholdFromCoach(householdId) {
  switchViewMode("HOUSEHOLD");
  await selectHousehold(householdId);
}

// ---------------------------------------------------------------------------
// 10. ONE-CLICK DEMO RESET
// ---------------------------------------------------------------------------
async function resetDemoData() {
  const res = await fetch("/api/v1/seed/reset", { method: "POST" });
  if (res.ok) {
    showToast(
      "Demo State Reset Complete",
      "All 4 demo households (SAFE, CAUTION, CRITICAL, FREEZE), MongoDB expenses, and PostgreSQL snapshots restored.",
      "info"
    );
    await fetchHouseholdsList(true);
    if (STATE.viewMode === "COACH") {
      await loadCoachOverview();
    }
  }
}

window.addEventListener("DOMContentLoaded", initApp);
