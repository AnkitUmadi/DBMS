import json
import uuid
import random

def create_excalidraw_diagram():
    elements = []
    
    def add_rect(x, y, w, h, bg="#ffffff", stroke="#334155", stroke_w=1, stroke_s="solid", roundness=True):
        el_id = "rect_" + str(uuid.uuid4())[:8]
        elements.append({
            "id": el_id,
            "type": "rectangle",
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "angle": 0,
            "strokeColor": stroke,
            "backgroundColor": bg,
            "fillStyle": "solid",
            "strokeWidth": stroke_w,
            "strokeStyle": stroke_s,
            "roughness": 0,
            "opacity": 100,
            "groupIds": [],
            "roundness": {"type": 3} if roundness else None,
            "seed": random.randint(1000, 99999),
            "version": 1,
            "versionNonce": random.randint(1000, 99999),
            "isDeleted": False,
            "boundElements": [],
            "updated": 1,
            "link": None,
            "locked": False
        })
        return el_id

    def add_text(x, y, text, font_size=13, color="#0f172a", bold=False):
        el_id = "text_" + str(uuid.uuid4())[:8]
        lines = text.split("\n")
        line_height = 1.3
        h = len(lines) * font_size * line_height
        w = max(len(l) for l in lines) * (font_size * 0.58)
        elements.append({
            "id": el_id,
            "type": "text",
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "angle": 0,
            "strokeColor": color,
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 1,
            "strokeStyle": "solid",
            "roughness": 0,
            "opacity": 100,
            "groupIds": [],
            "roundness": None,
            "seed": random.randint(1000, 99999),
            "version": 1,
            "versionNonce": random.randint(1000, 99999),
            "isDeleted": False,
            "boundElements": [],
            "updated": 1,
            "link": None,
            "locked": False,
            "text": text,
            "fontSize": font_size,
            "fontFamily": 1,
            "textAlign": "left",
            "verticalAlign": "top",
            "baseline": font_size,
            "containerId": None,
            "originalText": text,
            "lineHeight": line_height
        })
        return el_id

    def add_arrow(start_x, start_y, points, stroke="#64748b", stroke_w=2, stroke_s="solid", label=None):
        el_id = "arrow_" + str(uuid.uuid4())[:8]
        elements.append({
            "id": el_id,
            "type": "arrow",
            "x": start_x,
            "y": start_y,
            "width": abs(points[-1][0]),
            "height": abs(points[-1][1]),
            "angle": 0,
            "strokeColor": stroke,
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": stroke_w,
            "strokeStyle": stroke_s,
            "roughness": 0,
            "opacity": 100,
            "groupIds": [],
            "roundness": {"type": 2},
            "seed": random.randint(1000, 99999),
            "version": 1,
            "versionNonce": random.randint(1000, 99999),
            "isDeleted": False,
            "boundElements": [],
            "updated": 1,
            "link": None,
            "locked": False,
            "points": points,
            "lastCommittedPoint": None,
            "startBinding": None,
            "endBinding": None,
            "startArrowhead": None,
            "endArrowhead": "arrow"
        })
        if label:
            mid_x = start_x + points[-1][0] * 0.5
            mid_y = start_y + points[-1][1] * 0.5 - 12
            add_text(mid_x, mid_y, label, font_size=11, color=stroke)
        return el_id

    def add_entity_box(x, y, w, title, attrs, header_bg="#1e293b", header_color="#ffffff", body_bg="#ffffff", border_color="#334155"):
        header_h = 32
        body_h = len(attrs) * 18 + 16
        total_h = header_h + body_h
        
        # Outer Card
        add_rect(x, y, w, total_h, bg=body_bg, stroke=border_color, stroke_w=2, roundness=True)
        # Header Box
        add_rect(x, y, w, header_h, bg=header_bg, stroke=border_color, stroke_w=2, roundness=True)
        # Title
        add_text(x + 12, y + 8, title, font_size=13, color=header_color, bold=True)
        
        # Attributes
        attr_text = "\n".join(attrs)
        add_text(x + 12, y + header_h + 8, attr_text, font_size=11, color="#1e293b")
        return x, y, w, total_h

    # =========================================================================
    # DIAGRAM TITLE & LEGEND
    # =========================================================================
    add_text(60, 40, "FinShield: Tri-Hybrid Database Entity-Relationship (ER) Architecture", font_size=24, color="#0f172a", bold=True)
    add_text(60, 75, "Relational Source of Truth (Postgres 16+) | Document Daily Spends (MongoDB 8+) | Semantic Guidance (pgvector)", font_size=14, color="#475569")

    # Legend Badges
    add_rect(60, 110, 18, 18, bg="#1e293b", stroke="#0f172a", roundness=True)
    add_text(85, 111, "Postgres Core Entity", font_size=12, color="#334155")

    add_rect(240, 110, 18, 18, bg="#065f46", stroke="#047857", roundness=True)
    add_text(265, 111, "MongoDB Document Collection", font_size=12, color="#065f46")

    add_rect(470, 110, 18, 18, bg="#5b21b6", stroke="#6d28d9", roundness=True)
    add_text(495, 111, "pgvector Semantic Playbooks", font_size=12, color="#5b21b6")

    add_rect(690, 110, 18, 18, bg="#991b1b", stroke="#b91c1c", roundness=True)
    add_text(715, 111, "Financial Safety Gatekeeper / Logs", font_size=12, color="#991b1b")

    add_rect(930, 110, 18, 18, bg="#b45309", stroke="#d97706", roundness=True)
    add_text(955, 111, "Computed Snapshots (Trigger Recalculated)", font_size=12, color="#b45309")

    # =========================================================================
    # CLUSTER 1: HOUSEHOLD & IDENTITY (Top Left)
    # =========================================================================
    # Grouping Frame
    add_rect(40, 160, 680, 520, bg="#f8fafc", stroke="#cbd5e1", stroke_w=1, stroke_s="dashed", roundness=True)
    add_text(60, 175, "MODULE 1: MULTI-TENANT HOUSEHOLD & ACTOR DOMAIN", font_size=14, color="#334155", bold=True)

    # households
    hh_x, hh_y, hh_w, hh_h = add_entity_box(60, 210, 280, "households (PostgreSQL)", [
        "PK  household_id    UUID",
        "    household_name  VARCHAR(100)",
        "    created_at      TIMESTAMPTZ",
        "------------------------------------",
        "RLS: Multi-tenant tenant boundary"
    ], header_bg="#1e293b")

    # users
    u_x, u_y, u_w, u_h = add_entity_box(400, 210, 300, "users (PostgreSQL)", [
        "PK  user_id         UUID",
        "FK  household_id    UUID -> households",
        "    full_name       VARCHAR(100)",
        "UQ  email           VARCHAR(150)",
        "    password_hash   VARCHAR(255) (bcrypt)",
        "    role            user_role (USER,COACH,ADMIN)",
        "    created_at      TIMESTAMPTZ"
    ], header_bg="#1e293b")

    # coach_assignments
    ca_x, ca_y, ca_w, ca_h = add_entity_box(60, 420, 280, "coach_assignments (PostgreSQL)", [
        "PK,FK coach_id      UUID -> users(role=COACH)",
        "PK,FK household_id  UUID -> households",
        "      assigned_at   TIMESTAMPTZ",
        "------------------------------------",
        "FS002: Rejects non-COACH role",
        "FS003: Blocks coach demotion"
    ], header_bg="#334155")

    # dependents
    dep_x, dep_y, dep_w, dep_h = add_entity_box(400, 440, 300, "dependents (PostgreSQL)", [
        "PK  dependent_id    UUID",
        "FK  household_id    UUID -> households",
        "    full_name       VARCHAR(100)",
        "    relationship    VARCHAR(30)",
        "    age             INT CHECK(0..120)",
        "    created_at      TIMESTAMPTZ"
    ], header_bg="#334155")

    # =========================================================================
    # CLUSTER 2: INCOME, ASSETS & LIABILITIES (Bottom Left)
    # =========================================================================
    add_rect(40, 720, 680, 560, bg="#f8fafc", stroke="#cbd5e1", stroke_w=1, stroke_s="dashed", roundness=True)
    add_text(60, 735, "MODULE 2: FINANCIAL OBLIGATIONS & LIQUID RESERVES", font_size=14, color="#334155", bold=True)

    # incomes
    inc_x, inc_y, inc_w, inc_h = add_entity_box(60, 770, 290, "incomes (PostgreSQL)", [
        "PK  income_id         UUID",
        "FK  user_id           UUID -> users",
        "    source_name       VARCHAR(100)",
        "    monthly_amount    NUMERIC(14,2) > 0",
        "    is_primary_earner BOOLEAN DEFAULT TRUE",
        "    pay_day_of_month  INT CHECK(1..31)",
        "    created_at        TIMESTAMPTZ"
    ], header_bg="#0f766e")

    # liabilities
    liab_x, liab_y, liab_w, liab_h = add_entity_box(390, 770, 310, "liabilities (PostgreSQL)", [
        "PK  debt_id                UUID",
        "FK  user_id                UUID -> users",
        "    lender_name            VARCHAR(100)",
        "    principal_remaining    NUMERIC(14,2) >= 0",
        "    annual_interest_rate   NUMERIC(6,2)",
        "    monthly_emi            NUMERIC(14,2) >= 0",
        "    emi_due_day            INT CHECK(1..31)",
        "    prepayment_penalty_pct NUMERIC(5,2)",
        "    remaining_tenure_mos   INT CHECK(>=0)"
    ], header_bg="#0f766e")

    # baseline_expenses
    base_x, base_y, base_w, base_h = add_entity_box(60, 1020, 290, "baseline_expenses (PostgreSQL)", [
        "PK  expense_id       UUID",
        "FK  household_id     UUID -> households",
        "    category_name    VARCHAR(50) (Rent,Food)",
        "    monthly_amount   NUMERIC(14,2) >= 0",
        "    due_day_of_month INT CHECK(1..31)",
        "    updated_at       TIMESTAMPTZ"
    ], header_bg="#0f766e")

    # liquid_assets
    liq_x, liq_y, liq_w, liq_h = add_entity_box(390, 1020, 310, "liquid_assets (PostgreSQL)", [
        "PK  asset_id          UUID",
        "FK  household_id      UUID -> households",
        "    asset_name        VARCHAR(100)",
        "    current_balance   NUMERIC(14,2) >= 0",
        "    is_emergency_fund BOOLEAN DEFAULT FALSE",
        "    updated_at        TIMESTAMPTZ",
        "--------------------------------------",
        "Only is_emergency_fund=TRUE counts to runway"
    ], header_bg="#0f766e")

    # =========================================================================
    # CLUSTER 3: MONGODB & DISCRETIONARY SYNC (Middle Column)
    # =========================================================================
    add_rect(760, 160, 480, 520, bg="#ecfdf5", stroke="#6ee7b7", stroke_w=1, stroke_s="dashed", roundness=True)
    add_text(780, 175, "MODULE 3: DYNAMIC SPEND LOGS & MTD SYNC BRIDGE", font_size=14, color="#065f46", bold=True)

    # daily_expenses (MongoDB)
    mgo_x, mgo_y, mgo_w, mgo_h = add_entity_box(780, 210, 440, "daily_expenses (MongoDB Document Store)", [
        "PK  _id                 ObjectId",
        "    expense_id          String (UUID)",
        "REF household_id        String (UUID -> households)",
        "REF user_id             String (UUID -> users)",
        "    amount              Double (min: 0.0)",
        "    category            String (Dining, Shopping...)",
        "    is_discretionary    Boolean",
        "    merchant_metadata   Object {",
        "       name: String, location: String, tags: [String]",
        "    }",
        "    timestamp           ISODate",
        "--------------------------------------------------",
        "INDEX { household_id: 1, timestamp: -1 }",
        "INDEX { household_id: 1, is_discretionary: 1, timestamp: -1 }"
    ], header_bg="#065f46", body_bg="#f0fdf4", border_color="#10b981")

    # household_discretionary_monthly
    hdm_x, hdm_y, hdm_w, hdm_h = add_entity_box(780, 480, 440, "household_discretionary_monthly (Postgres Sync)", [
        "PK,FK household_id        UUID -> households",
        "PK    month_start         DATE (CHECK: day = 1)",
        "      discretionary_total NUMERIC(14,2) >= 0",
        "      synced_at           TIMESTAMPTZ DEFAULT now()",
        "--------------------------------------------------",
        "Synced via: fn_set_discretionary_mtd(h_id, m_start, total)",
        "Trigger: trg_refresh_on_disc_monthly -> Snapshots"
    ], header_bg="#047857", body_bg="#f0fdf4", border_color="#10b981")

    # discretionary_caps
    cap_x, cap_y, cap_w, cap_h = add_entity_box(780, 720, 440, "discretionary_caps (PostgreSQL Override)", [
        "PK,FK household_id UUID -> households",
        "      cap_override NUMERIC(14,2) >= 0",
        "      updated_at   TIMESTAMPTZ DEFAULT now()",
        "--------------------------------------------------",
        "Default Cap: 50% of structural surplus.",
        "Rule: Users can only lower cap override, never raise."
    ], header_bg="#047857")

    # =========================================================================
    # CLUSTER 4: SNAPSHOT ENGINE & ALLOCATION GATEKEEPER (Top Right)
    # =========================================================================
    add_rect(1280, 160, 520, 580, bg="#fffbeb", stroke="#fcd34d", stroke_w=1, stroke_s="dashed", roundness=True)
    add_text(1300, 175, "MODULE 4: DETERMINISTIC CLASSIFIER & GATEKEEPER", font_size=14, color="#92400e", bold=True)

    # financial_snapshots
    snap_x, snap_y, snap_w, snap_h = add_entity_box(1300, 210, 480, "financial_snapshots (Trigger Recalculated)", [
        "PK    snapshot_id             UUID",
        "UQ,FK household_id            UUID -> households",
        "      total_monthly_income    NUMERIC(14,2)",
        "      total_baseline_costs    NUMERIC(14,2)",
        "      total_monthly_emi       NUMERIC(14,2)",
        "      total_liquid_reserves   NUMERIC(14,2)",
        "      structural_surplus      NUMERIC(14,2)",
        "      discretionary_mtd       NUMERIC(14,2)",
        "      discretionary_cap       NUMERIC(14,2)",
        "      emergency_runway_months NUMERIC(10,2) (capped at 999)",
        "      dti_ratio               NUMERIC(10,2) (NULL if income=0)",
        "      rigidity_ratio          NUMERIC(10,2)",
        "      base_tier               policy_tier (SAFE,CAUTION,CRITICAL,FREEZE)",
        "      current_tier            policy_tier (post-overspend escalation)",
        "      tier_reasons            TEXT[] (plain-English audit reasons)",
        "      last_recalculated       TIMESTAMPTZ"
    ], header_bg="#b45309", body_bg="#fefce8", border_color="#f59e0b")

    # asset_allocations
    alloc_x, alloc_y, alloc_w, alloc_h = add_entity_box(1300, 580, 480, "asset_allocations (Gatekeeper Enforced FS001)", [
        "PK  allocation_id   UUID",
        "FK  household_id    UUID -> households",
        "FK  created_by      UUID -> users",
        "    equity_pct      NUMERIC(5,2) (0-100%)",
        "    debt_pct        NUMERIC(5,2) (0-100%)",
        "    emergency_pct   NUMERIC(5,2) (0-100%)",
        "    is_override     BOOLEAN DEFAULT FALSE",
        "    override_reason TEXT (length >= 5 if override)",
        "    created_at      TIMESTAMPTZ",
        "--------------------------------------------------",
        "Gatekeeper Rules (FS001):",
        " - CRITICAL/FREEZE: equity_pct MUST be 0.00%",
        " - CAUTION: equity_pct CAPPED at 25.00%",
        " - SAFE: Full allocation allowed (up to 100%)"
    ], header_bg="#991b1b", body_bg="#fef2f2", border_color="#ef4444")

    # =========================================================================
    # CLUSTER 5: AUDIT LOGS, SIMULATOR & VECTOR ENGINE (Bottom Right)
    # =========================================================================
    add_rect(1280, 800, 520, 480, bg="#faf5ff", stroke="#e9d5ff", stroke_w=1, stroke_s="dashed", roundness=True)
    add_text(1300, 815, "MODULE 5: AUDIT TRAIL, SCENARIOS & VECTOR PLAYBOOKS", font_size=14, color="#6b21a8", bold=True)

    # policy_audit_logs
    aud_x, aud_y, aud_w, aud_h = add_entity_box(1300, 850, 480, "policy_audit_logs (Tamper-Evident Trail)", [
        "PK  log_id           UUID",
        "FK  user_id          UUID -> users",
        "    attempted_action VARCHAR(100) (e.g. ALLOCATION_OVERRIDE)",
        "    enforced_tier    policy_tier",
        "    action_blocked   BOOLEAN",
        "    override_reason  TEXT",
        "    logged_at        TIMESTAMPTZ DEFAULT now()"
    ], header_bg="#831843", body_bg="#fff1f2", border_color="#f43f5e")

    # recovery_playbooks (pgvector)
    rec_x, rec_y, rec_w, rec_h = add_entity_box(1300, 1070, 480, "recovery_playbooks (pgvector Semantic Engine)", [
        "PK  playbook_id   SERIAL",
        "    trigger_tier  policy_tier (CRITICAL, FREEZE, CAUTION)",
        "    title         VARCHAR(150)",
        "    content_text  TEXT",
        "    embedding     vector(384) (all-MiniLM-L6-v2)",
        "--------------------------------------------------",
        "Similarity Metric: Cosine Distance (<=>)",
        "Hard Filter: WHERE trigger_tier = active_tier"
    ], header_bg="#5b21b6", body_bg="#faf5ff", border_color="#a855f7")

    # scenarios
    scen_x, scen_y, scen_w, scen_h = add_entity_box(780, 940, 440, "scenarios (What-If Simulator Sandbox)", [
        "PK  scenario_id   UUID",
        "FK  household_id  UUID -> households",
        "FK  created_by    UUID -> users",
        "    scenario_name VARCHAR(100)",
        "    params        JSONB (CHECK: typeof = 'object')",
        "    created_at    TIMESTAMPTZ DEFAULT now()",
        "--------------------------------------------------",
        "Simulator reuses pure fn_classify_tier() logic.",
        "Zero mutations to live financial_snapshots."
    ], header_bg="#312e81")

    # risk_profiles
    risk_x, risk_y, risk_w, risk_h = add_entity_box(780, 1150, 440, "risk_profiles (Asset Allocation Input)", [
        "PK,FK user_id       UUID -> users",
        "      age           INT CHECK(18..100)",
        "      risk_appetite risk_appetite (CONSERVATIVE,MODERATE,AGGRESSIVE)",
        "      updated_at    TIMESTAMPTZ DEFAULT now()"
    ], header_bg="#312e81")

    # =========================================================================
    # CONNECTIONS & RELATIONSHIPS
    # =========================================================================
    # households -> users (1:N)
    add_arrow(hh_x + hh_w, hh_y + 40, [[0, 0], [60, 0]], stroke="#334155", label="1 : N")
    # users -> incomes (1:N)
    add_arrow(u_x + 50, u_y + u_h, [[0, 0], [0, 80], [-250, 80], [-250, 420]], stroke="#0f766e", label="1 : N")
    # users -> liabilities (1:N)
    add_arrow(u_x + 150, u_y + u_h, [[0, 0], [0, 120], [-10, 120], [-10, 420]], stroke="#0f766e", label="1 : N")
    # households -> baseline_expenses (1:N)
    add_arrow(hh_x + 80, hh_y + hh_h, [[0, 0], [0, 450]], stroke="#0f766e", label="1 : N")
    # households -> liquid_assets (1:N)
    add_arrow(hh_x + 200, hh_y + hh_h, [[0, 0], [0, 320], [250, 320], [250, 450]], stroke="#0f766e", label="1 : N")
    # households -> financial_snapshots (1:1)
    add_arrow(hh_x + hh_w, hh_y + 20, [[0, 0], [960, 0]], stroke="#b45309", stroke_w=2, label="1 : 1 (Snapshot)")
    # MongoDB daily_expenses -> household_discretionary_monthly (Aggregation Sync)
    add_arrow(mgo_x + 200, mgo_y + mgo_h, [[0, 0], [0, 40]], stroke="#10b981", stroke_w=3, label="Pipeline: $match + $group -> MTD")
    # household_discretionary_monthly -> financial_snapshots (Trigger Cascade)
    add_arrow(hdm_x + hdm_w, hdm_y + 40, [[0, 0], [60, 0], [60, -180]], stroke="#d97706", stroke_w=2, label="trg_disc_refresh")
    # financial_snapshots -> asset_allocations (Gatekeeper Validation)
    add_arrow(snap_x + 240, snap_y + snap_h, [[0, 0], [0, 50]], stroke="#ef4444", stroke_w=3, label="Reads current_tier (FS001)")
    # asset_allocations -> policy_audit_logs (Override Audit)
    add_arrow(alloc_x + 240, alloc_y + alloc_h, [[0, 0], [0, 50]], stroke="#f43f5e", label="is_override = true")
    # users -> coach_assignments
    add_arrow(u_x, u_y + 150, [[0, 0], [-60, 0]], stroke="#64748b", label="coach_id")
    # households -> coach_assignments
    add_arrow(hh_x + 100, hh_y + hh_h, [[0, 0], [0, 110]], stroke="#64748b", label="household_id")

    diagram_data = {
        "type": "excalidraw",
        "version": 2,
        "source": "https://excalidraw.com",
        "elements": elements,
        "appState": {
            "viewBackgroundColor": "#ffffff",
            "gridSize": 20
        },
        "files": {}
    }

    return diagram_data

if __name__ == "__main__":
    diag = create_excalidraw_diagram()
    output_path = r"C:\Users\Ankit Umadi\Downloads\finshield_phase1\finshield_phase1\finshield_er_diagram.excalidraw"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(diag, f, indent=2)
    print(f"Excalidraw diagram generated successfully at: {output_path}")
    print(f"Total elements generated: {len(diag['elements'])}")
