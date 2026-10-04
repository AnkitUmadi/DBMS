import json
import uuid
import random

def build_excalidraw_chen():
    elements = []

    def make_id(prefix):
        return f"{prefix}_{str(uuid.uuid4())[:8]}"

    def add_element(el_type, x, y, w, h, bg="#ffffff", stroke="#1e293b", stroke_w=2, stroke_s="solid", fill="solid", roundness=None, roughness=0):
        el_id = make_id(el_type)
        r_obj = {"type": 3} if roundness else None
        el = {
            "id": el_id,
            "type": el_type,
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "angle": 0,
            "strokeColor": stroke,
            "backgroundColor": bg,
            "fillStyle": fill,
            "strokeWidth": stroke_w,
            "strokeStyle": stroke_s,
            "roughness": roughness,
            "opacity": 100,
            "groupIds": [],
            "roundness": r_obj,
            "seed": random.randint(1000, 99999),
            "version": 1,
            "versionNonce": random.randint(1000, 99999),
            "isDeleted": False,
            "boundElements": [],
            "updated": 1,
            "link": None,
            "locked": False
        }
        elements.append(el)
        return el_id

    def add_text_centered(cx, cy, text, font_size=13, color="#0f172a", bold=False, underline=False):
        el_id = make_id("text")
        lines = text.split("\n")
        line_height = 1.25
        h = len(lines) * font_size * line_height
        w = max(len(l) for l in lines) * (font_size * 0.58)
        x = cx - w / 2
        y = cy - h / 2
        el = {
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
            "textAlign": "center",
            "verticalAlign": "middle",
            "baseline": font_size,
            "containerId": None,
            "originalText": text,
            "lineHeight": line_height
        }
        elements.append(el)
        return el_id

    def add_line(x1, y1, x2, y2, stroke="#64748b", stroke_w=1.5, stroke_s="solid"):
        el_id = make_id("line")
        dx = x2 - x1
        dy = y2 - y1
        el = {
            "id": el_id,
            "type": "line",
            "x": x1,
            "y": y1,
            "width": abs(dx),
            "height": abs(dy),
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
            "points": [[0, 0], [dx, dy]],
            "lastCommittedPoint": None,
            "startBinding": None,
            "endBinding": None,
            "startArrowhead": None,
            "endArrowhead": None
        }
        elements.append(el)
        return el_id

    # 1. ENTITY (Rectangle)
    def draw_entity(cx, cy, w, h, name, is_weak=False, bg="#dbeafe", stroke="#1e40af"):
        if is_weak:
            add_element("rectangle", cx - w/2 - 4, cy - h/2 - 4, w + 8, h + 8, bg="transparent", stroke=stroke, stroke_w=1.5)
        add_element("rectangle", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=2, roundness=True)
        add_text_centered(cx, cy, name, font_size=13, color=stroke, bold=True)
        return cx, cy

    # 2. RELATIONSHIP (Diamond)
    def draw_relationship(cx, cy, w, h, name, is_identifying=False, bg="#fef3c7", stroke="#b45309"):
        if is_identifying:
            add_element("diamond", cx - (w+12)/2, cy - (h+12)/2, w + 12, h + 12, bg="transparent", stroke=stroke, stroke_w=1.5)
        add_element("diamond", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=2)
        add_text_centered(cx, cy, name, font_size=11, color=stroke, bold=True)
        return cx, cy

    # 3. ATTRIBUTE (Oval / Ellipse)
    def draw_attribute(cx, cy, w, h, name, is_pk=False, is_derived=False, is_multivalued=False, bg="#f8fafc", stroke="#475569"):
        stroke_s = "dashed" if is_derived else "solid"
        if is_pk:
            bg = "#fef9c3"
            stroke = "#a16207"
            display_name = f"{name}"
        elif is_derived:
            bg = "#fff7ed"
            stroke = "#c2410c"
            display_name = f"{name}"
        else:
            display_name = name

        if is_multivalued:
            add_element("ellipse", cx - (w+8)/2, cy - (h+8)/2, w + 8, h + 8, bg="transparent", stroke=stroke, stroke_w=1.5)
        
        add_element("ellipse", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=1.5, stroke_s=stroke_s)
        add_text_centered(cx, cy, display_name, font_size=11, color=stroke, underline=is_pk)
        return cx, cy

    # =========================================================================
    # HEADER & CHEN NOTATION LEGEND
    # =========================================================================
    add_text_centered(1000, 50, "FinShield: Formal Chen Entity-Relationship (ER) Diagram", font_size=26, color="#0f172a", bold=True)
    add_text_centered(1000, 85, "Standard DBMS Chen Notation: Rectangles (Entities), Diamonds (Relationships), Ovals (Attributes)", font_size=13, color="#475569")

    # Legend Box
    leg_x, leg_y = 120, 130
    add_element("rectangle", leg_x - 10, leg_y - 10, 1760, 65, bg="#f1f5f9", stroke="#cbd5e1", stroke_w=1, roundness=True)
    
    # Legend items
    draw_entity(220, leg_y + 22, 110, 34, "Entity", bg="#dbeafe", stroke="#1e40af")
    add_text_centered(220, leg_y + 44, "Strong Entity", font_size=10, color="#64748b")

    draw_entity(370, leg_y + 22, 110, 34, "Weak Entity", is_weak=True, bg="#e0e7ff", stroke="#3730a3")
    add_text_centered(370, leg_y + 44, "Dependent / Derived", font_size=10, color="#64748b")

    draw_relationship(530, leg_y + 22, 100, 38, "RELATION", bg="#fef3c7", stroke="#b45309")
    add_text_centered(530, leg_y + 44, "Relationship", font_size=10, color="#64748b")

    draw_attribute(680, leg_y + 22, 90, 32, "attr_name")
    add_text_centered(680, leg_y + 44, "Normal Attribute", font_size=10, color="#64748b")

    draw_attribute(820, leg_y + 22, 90, 32, "key_id (PK)", is_pk=True)
    add_text_centered(820, leg_y + 44, "Key Attribute (PK)", font_size=10, color="#64748b")

    draw_attribute(960, leg_y + 22, 95, 32, "derived_val", is_derived=True)
    add_text_centered(960, leg_y + 44, "Derived (Dashed)", font_size=10, color="#64748b")

    draw_attribute(1110, leg_y + 22, 100, 32, "reasons[]", is_multivalued=True)
    add_text_centered(1110, leg_y + 44, "Multivalued (Array)", font_size=10, color="#64748b")

    draw_entity(1280, leg_y + 22, 125, 34, "MongoDB Store", bg="#d1fae5", stroke="#065f46")
    add_text_centered(1280, leg_y + 44, "NoSQL Document", font_size=10, color="#065f46")

    draw_entity(1460, leg_y + 22, 125, 34, "pgvector AI", bg="#ede9fe", stroke="#5b21b6")
    add_text_centered(1460, leg_y + 44, "Vector Embeddings", font_size=10, color="#5b21b6")

    # =========================================================================
    # ROW 1: CORE ENTITIES - HOUSEHOLD & USER (Y = 320)
    # =========================================================================
    hh_cx, hh_cy = 450, 320
    u_cx, u_cy = 1150, 320

    draw_entity(hh_cx, hh_cy, 180, 55, "HOUSEHOLD", bg="#dbeafe", stroke="#1e40af")
    draw_entity(u_cx, u_cy, 180, 55, "USER", bg="#dbeafe", stroke="#1e40af")

    # Relationship: BELONGS_TO (between USER and HOUSEHOLD)
    rel_b_cx, rel_b_cy = 800, 320
    draw_relationship(rel_b_cx, rel_b_cy, 140, 50, "BELONGS_TO", bg="#fef3c7", stroke="#b45309")
    add_line(hh_cx + 90, hh_cy, rel_b_cx - 70, rel_b_cy)
    add_text_centered(hh_cx + 115, hh_cy - 12, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_b_cx + 70, rel_b_cy, u_cx - 90, u_cy)
    add_text_centered(u_cx - 115, u_cy - 12, "N", font_size=13, color="#1e40af", bold=True)

    # Attributes of HOUSEHOLD (Top & Left)
    hh_pk = draw_attribute(260, 240, 110, 34, "household_id", is_pk=True)
    add_line(hh_cx - 50, hh_cy - 27, hh_pk[0] + 40, hh_pk[1] + 15)

    hh_name = draw_attribute(410, 220, 120, 34, "household_name")
    add_line(hh_cx, hh_cy - 27, hh_name[0], hh_name[1] + 17)

    hh_cat = draw_attribute(560, 240, 100, 34, "created_at")
    add_line(hh_cx + 50, hh_cy - 27, hh_cat[0] - 30, hh_cat[1] + 15)

    # Attributes of USER (Top & Right)
    u_pk = draw_attribute(1020, 230, 95, 34, "user_id", is_pk=True)
    add_line(u_cx - 50, u_cy - 27, u_pk[0] + 30, u_pk[1] + 15)

    u_name = draw_attribute(1150, 215, 100, 34, "full_name")
    add_line(u_cx, u_cy - 27, u_name[0], u_name[1] + 17)

    u_email = draw_attribute(1280, 225, 95, 34, "email (UQ)")
    add_line(u_cx + 50, u_cy - 27, u_email[0] - 30, u_email[1] + 15)

    u_role = draw_attribute(1360, 290, 85, 34, "role")
    add_line(u_cx + 90, u_cy - 10, u_role[0] - 40, u_role[1])

    # Coach Assignment: M:N relationship
    coach_rel_cx, coach_rel_cy = 800, 230
    draw_relationship(coach_rel_cx, coach_rel_cy, 130, 48, "COACHES", bg="#ede9fe", stroke="#5b21b6")
    add_line(u_cx - 60, u_cy - 27, coach_rel_cx + 65, coach_rel_cy + 15)
    add_text_centered(coach_rel_cx + 80, coach_rel_cy + 25, "M", font_size=12, color="#5b21b6", bold=True)
    add_line(hh_cx + 60, hh_cy - 27, coach_rel_cx - 65, coach_rel_cy + 15)
    add_text_centered(coach_rel_cx - 80, coach_rel_cy + 25, "N", font_size=12, color="#5b21b6", bold=True)

    # Dependents (Weak Entity)
    dep_cx, dep_cy = 170, 320
    draw_entity(dep_cx, dep_cy, 130, 48, "DEPENDENT", is_weak=True, bg="#f1f5f9", stroke="#475569")
    dep_rel_cx, dep_rel_cy = 310, 320
    draw_relationship(dep_rel_cx, dep_rel_cy, 100, 42, "HAS_DEP", is_identifying=True, bg="#f1f5f9", stroke="#475569")
    add_line(hh_cx - 90, hh_cy, dep_rel_cx + 50, dep_rel_cy)
    add_text_centered(hh_cx - 105, hh_cy - 10, "1", font_size=12, color="#1e40af", bold=True)
    add_line(dep_rel_cx - 50, dep_rel_cy, dep_cx + 65, dep_cy)
    add_text_centered(dep_cx + 75, dep_cy - 10, "N", font_size=12, color="#475569", bold=True)

    dep_age = draw_attribute(90, 260, 75, 30, "age")
    add_line(dep_cx - 30, dep_cy - 24, dep_age[0] + 20, dep_age[1] + 15)
    dep_rel = draw_attribute(75, 350, 85, 30, "relation")
    add_line(dep_cx - 50, dep_cy + 10, dep_rel[0] + 40, dep_rel[1])

    # =========================================================================
    # ROW 2: FINANCIAL FLOWS (Incomes, Liabilities, Baseline, Liquid Assets) (Y = 560)
    # =========================================================================
    # Household Fixed Obligations: BASELINE EXPENSES
    base_cx, base_cy = 280, 560
    draw_entity(base_cx, base_cy, 160, 50, "BASELINE_EXPENSE", bg="#ccfbf1", stroke="#0f766e")
    rel_p_cx, rel_p_cy = 360, 440
    draw_relationship(rel_p_cx, rel_p_cy, 110, 44, "PAYS_COSTS", bg="#fef3c7", stroke="#b45309")
    add_line(hh_cx - 40, hh_cy + 27, rel_p_cx + 20, rel_p_cy - 22)
    add_text_centered(rel_p_cx + 35, rel_p_cy - 30, "1", font_size=12, color="#1e40af", bold=True)
    add_line(rel_p_cx - 20, rel_p_cy + 22, base_cx + 20, base_cy - 25)
    add_text_centered(base_cx + 35, base_cy - 35, "N", font_size=12, color="#0f766e", bold=True)

    draw_attribute(170, 520, 95, 30, "expense_id", is_pk=True)
    add_line(base_cx - 50, base_cy - 20, 210, 530)
    draw_attribute(160, 575, 95, 30, "monthly_amt")
    add_line(base_cx - 80, base_cy, 210, 575)
    draw_attribute(180, 630, 95, 30, "category_name")
    add_line(base_cx - 60, base_cy + 25, 230, 625)

    # Household Reserves: LIQUID ASSETS
    liq_cx, liq_cy = 550, 560
    draw_entity(liq_cx, liq_cy, 150, 50, "LIQUID_ASSET", bg="#ccfbf1", stroke="#0f766e")
    rel_l_cx, rel_l_cy = 510, 440
    draw_relationship(rel_l_cx, rel_l_cy, 110, 44, "HOLDS_FUND", bg="#fef3c7", stroke="#b45309")
    add_line(hh_cx + 30, hh_cy + 27, rel_l_cx - 10, rel_l_cy - 22)
    add_text_centered(rel_l_cx - 25, rel_l_cy - 30, "1", font_size=12, color="#1e40af", bold=True)
    add_line(rel_l_cx + 10, rel_l_cy + 22, liq_cx - 20, liq_cy - 25)
    add_text_centered(liq_cx - 35, liq_cy - 35, "N", font_size=12, color="#0f766e", bold=True)

    draw_attribute(470, 630, 85, 30, "asset_id", is_pk=True)
    add_line(liq_cx - 30, liq_cy + 25, 480, 615)
    draw_attribute(580, 640, 100, 30, "current_bal")
    add_line(liq_cx + 10, liq_cy + 25, 570, 625)
    draw_attribute(690, 620, 110, 30, "is_emergency")
    add_line(liq_cx + 60, liq_cy + 20, 650, 610)

    # User Income: INCOMES
    inc_cx, inc_cy = 1050, 560
    draw_entity(inc_cx, inc_cy, 150, 50, "INCOME", bg="#ccfbf1", stroke="#0f766e")
    rel_i_cx, rel_i_cy = 1080, 440
    draw_relationship(rel_i_cx, rel_i_cy, 110, 44, "EARNS", bg="#fef3c7", stroke="#b45309")
    add_line(u_cx - 40, u_cy + 27, rel_i_cx + 20, rel_i_cy - 22)
    add_text_centered(rel_i_cx + 30, rel_i_cy - 30, "1", font_size=12, color="#1e40af", bold=True)
    add_line(rel_i_cx - 10, rel_i_cy + 22, inc_cx + 10, inc_cy - 25)
    add_text_centered(inc_cx + 20, inc_cy - 35, "N", font_size=12, color="#0f766e", bold=True)

    draw_attribute(960, 630, 85, 30, "income_id", is_pk=True)
    add_line(inc_cx - 40, inc_cy + 25, 980, 615)
    draw_attribute(1070, 640, 100, 30, "monthly_amt")
    add_line(inc_cx, inc_cy + 25, 1070, 625)
    draw_attribute(1180, 620, 95, 30, "pay_day")
    add_line(inc_cx + 45, inc_cy + 25, 1150, 615)

    # User Liabilities: LIABILITIES
    liab_cx, liab_cy = 1330, 560
    draw_entity(liab_cx, liab_cy, 160, 50, "LIABILITY", bg="#ccfbf1", stroke="#0f766e")
    rel_lb_cx, rel_lb_cy = 1260, 440
    draw_relationship(rel_lb_cx, rel_lb_cy, 110, 44, "INCURS", bg="#fef3c7", stroke="#b45309")
    add_line(u_cx + 40, u_cy + 27, rel_lb_cx - 15, rel_lb_cy - 22)
    add_text_centered(rel_lb_cx - 30, rel_lb_cy - 30, "1", font_size=12, color="#1e40af", bold=True)
    add_line(rel_lb_cx + 15, rel_lb_cy + 22, liab_cx - 20, liab_cy - 25)
    add_text_centered(liab_cx - 35, liab_cy - 35, "N", font_size=12, color="#0f766e", bold=True)

    draw_attribute(1280, 640, 80, 30, "debt_id", is_pk=True)
    add_line(liab_cx - 40, liab_cy + 25, 1300, 625)
    draw_attribute(1390, 640, 95, 30, "monthly_emi")
    add_line(liab_cx + 15, liab_cy + 25, 1380, 625)
    draw_attribute(1490, 610, 95, 30, "interest_rate")
    add_line(liab_cx + 60, liab_cy + 20, 1450, 600)
    draw_attribute(1490, 550, 95, 30, "principal_rem")
    add_line(liab_cx + 80, liab_cy, 1445, 550)

    # =========================================================================
    # ROW 3: COMPUTED SNAPSHOT ENGINE & MONGODB (Y = 800)
    # =========================================================================
    # Derived Entity: FINANCIAL SNAPSHOT (Double rectangle)
    snap_cx, snap_cy = 450, 820
    draw_entity(snap_cx, snap_cy, 200, 60, "FINANCIAL_SNAPSHOT", is_weak=True, bg="#fef3c7", stroke="#b45309")
    
    # 1:1 Relationship from Household to Snapshot
    rel_eval_cx, rel_eval_cy = 450, 690
    draw_relationship(rel_eval_cx, rel_eval_cy, 140, 48, "CALCULATES_TIER", bg="#fee2e2", stroke="#b91c1c")
    add_line(hh_cx, hh_cy + 27, rel_eval_cx, rel_eval_cy - 24)
    add_text_centered(rel_eval_cx + 15, rel_eval_cy - 40, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_eval_cx, rel_eval_cy + 24, snap_cx, snap_cy - 30)
    add_text_centered(snap_cx + 15, snap_cy - 40, "1", font_size=13, color="#b45309", bold=True)

    # Derived Attributes of SNAPSHOT (Dashed ovals)
    draw_attribute(220, 750, 110, 32, "runway_months", is_derived=True)
    add_line(snap_cx - 70, snap_cy - 20, 260, 760)

    draw_attribute(200, 810, 95, 32, "dti_ratio", is_derived=True)
    add_line(snap_cx - 100, snap_cy, 250, 810)

    draw_attribute(210, 870, 105, 32, "rigidity_ratio", is_derived=True)
    add_line(snap_cx - 80, snap_cy + 20, 250, 860)

    draw_attribute(230, 930, 115, 32, "structural_surplus", is_derived=True)
    add_line(snap_cx - 60, snap_cy + 30, 280, 915)

    # Multivalued Attribute (Double Oval)
    draw_attribute(450, 930, 115, 34, "tier_reasons[]", is_multivalued=True, bg="#fff1f2", stroke="#e11d48")
    add_line(snap_cx, snap_cy + 30, 450, 913)

    draw_attribute(360, 750, 95, 30, "current_tier")
    add_line(snap_cx - 20, snap_cy - 30, 360, 765)

    # MongoDB Dynamic Spends Collection
    mgo_cx, mgo_cy = 1150, 820
    draw_entity(mgo_cx, mgo_cy, 220, 60, "DAILY_EXPENSE\n(MongoDB Store)", bg="#d1fae5", stroke="#065f46")

    # User Logs Daily Spend (1:N)
    rel_mgo_cx, rel_mgo_cy = 1150, 690
    draw_relationship(rel_mgo_cx, rel_mgo_cy, 130, 46, "LOGS_SPEND", bg="#d1fae5", stroke="#065f46")
    add_line(u_cx, u_cy + 27, rel_mgo_cx, rel_mgo_cy - 23)
    add_text_centered(rel_mgo_cx + 15, rel_mgo_cy - 40, "1", font_size=12, color="#1e40af", bold=True)
    add_line(rel_mgo_cx, rel_mgo_cy + 23, mgo_cx, mgo_cy - 30)
    add_text_centered(mgo_cx + 15, mgo_cy - 40, "N", font_size=12, color="#065f46", bold=True)

    # MongoDB Attributes
    draw_attribute(1330, 760, 90, 30, "amount")
    add_line(mgo_cx + 70, mgo_cy - 20, 1300, 770)
    draw_attribute(1350, 820, 100, 30, "merchant_meta")
    add_line(mgo_cx + 110, mgo_cy, 1300, 820)
    draw_attribute(1340, 880, 100, 30, "is_discretionary")
    add_line(mgo_cx + 80, mgo_cy + 20, 1300, 870)
    draw_attribute(1280, 930, 85, 30, "timestamp")
    add_line(mgo_cx + 40, mgo_cy + 30, 1260, 915)

    # MTD Aggregation Sync (MongoDB -> Postgres Snapshot)
    rel_sync_cx, rel_sync_cy = 800, 820
    draw_relationship(rel_sync_cx, rel_sync_cy, 150, 52, "SYNCS_MTD\n(Pipeline)", bg="#dcfce7", stroke="#15803d")
    add_line(mgo_cx - 110, mgo_cy, rel_sync_cx + 75, rel_sync_cy, stroke="#15803d", stroke_w=2)
    add_text_centered(rel_sync_cx + 95, rel_sync_cy - 15, "Sums MTD", font_size=10, color="#15803d")
    add_line(rel_sync_cx - 75, rel_sync_cy, snap_cx + 100, snap_cy, stroke="#15803d", stroke_w=2)
    add_text_centered(rel_sync_cx - 100, rel_sync_cy - 15, "Updates Tier", font_size=10, color="#15803d")

    # =========================================================================
    # ROW 4: GUARDRAILS, AUDIT & VECTOR ADVISORY (Y = 1080)
    # =========================================================================
    # ASSET ALLOCATION (Target of Gatekeeper)
    alloc_cx, alloc_cy = 450, 1080
    draw_entity(alloc_cx, alloc_cy, 190, 55, "ASSET_ALLOCATION", bg="#fee2e2", stroke="#991b1b")

    # Gatekeeper Relationship: Snapshot enforces Gatekeeper rules on Allocation
    rel_gate_cx, rel_gate_cy = 450, 980
    draw_relationship(rel_gate_cx, rel_gate_cy, 150, 48, "GATEKEEPER\n(FS001 Block)", bg="#fca5a5", stroke="#991b1b")
    add_line(snap_cx, snap_cy + 30, rel_gate_cx, rel_gate_cy - 24, stroke="#991b1b", stroke_w=2)
    add_line(rel_gate_cx, rel_gate_cy + 24, alloc_cx, alloc_cy - 27, stroke="#991b1b", stroke_w=2)
    add_text_centered(rel_gate_cx + 90, rel_gate_cy, "Enforces Rules", font_size=10, color="#991b1b")

    # Attributes of Allocation
    draw_attribute(280, 1040, 85, 30, "allocation_id", is_pk=True)
    add_line(alloc_cx - 80, alloc_cy - 15, 320, 1045)
    draw_attribute(260, 1090, 95, 30, "equity_pct")
    add_line(alloc_cx - 95, alloc_cy, 310, 1090)
    draw_attribute(280, 1140, 95, 30, "is_override")
    add_line(alloc_cx - 70, alloc_cy + 20, 320, 1135)
    draw_attribute(400, 1160, 105, 30, "override_reason")
    add_line(alloc_cx - 10, alloc_cy + 27, 400, 1145)

    # AUDIT LOGS
    aud_cx, aud_cy = 800, 1080
    draw_entity(aud_cx, aud_cy, 170, 55, "POLICY_AUDIT_LOG", bg="#fff1f2", stroke="#831843")
    rel_aud_cx, rel_aud_cy = 630, 1080
    draw_relationship(rel_aud_cx, rel_aud_cy, 120, 44, "RECORDS_LOG", bg="#ffe4e6", stroke="#9f1239")
    add_line(alloc_cx + 95, alloc_cy, rel_aud_cx - 60, rel_aud_cy)
    add_line(rel_aud_cx + 60, rel_aud_cy, aud_cx - 85, aud_cy)
    add_text_centered(rel_aud_cx, rel_aud_cy - 26, "if override = true", font_size=10, color="#9f1239")

    draw_attribute(760, 1160, 85, 30, "log_id", is_pk=True)
    add_line(aud_cx - 20, aud_cy + 27, 765, 1145)
    draw_attribute(860, 1160, 95, 30, "enforced_tier")
    add_line(aud_cx + 20, aud_cy + 27, 860, 1145)

    # RECOVERY PLAYBOOKS (pgvector AI Semantic Store)
    vec_cx, vec_cy = 1150, 1080
    draw_entity(vec_cx, vec_cy, 210, 55, "RECOVERY_PLAYBOOK\n(pgvector Store)", bg="#ede9fe", stroke="#5b21b6")
    rel_rec_cx, rel_rec_cy = 980, 1080
    draw_relationship(rel_rec_cx, rel_rec_cy, 130, 46, "RETRIEVES_RAG\n(Cosine <=>)", bg="#ede9fe", stroke="#5b21b6")
    add_line(aud_cx + 85, aud_cy, rel_rec_cx - 65, rel_rec_cy, stroke="#5b21b6")
    add_line(rel_rec_cx + 65, rel_rec_cy, vec_cx - 105, vec_cy, stroke="#5b21b6")

    # Connect Snapshot to Vector Retrieval
    add_line(snap_cx + 60, snap_cy + 30, rel_rec_cx - 20, rel_rec_cy - 23, stroke="#5b21b6", stroke_s="dashed")
    add_text_centered(750, 960, "Tier Hard-Filter\n(e.g. CRITICAL)", font_size=10, color="#5b21b6")

    draw_attribute(1080, 1160, 90, 30, "playbook_id", is_pk=True)
    add_line(vec_cx - 40, vec_cy + 27, 1090, 1145)
    draw_attribute(1190, 1160, 100, 30, "trigger_tier")
    add_line(vec_cx + 10, vec_cy + 27, 1180, 1145)
    draw_attribute(1300, 1160, 110, 30, "embedding(384)")
    add_line(vec_cx + 60, vec_cy + 27, 1280, 1145)

    # Wrap in Excalidraw JSON envelope
    diagram = {
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

    return diagram

if __name__ == "__main__":
    diagram = build_excalidraw_chen()
    output_path = r"C:\Users\Ankit Umadi\Downloads\finshield_phase1\finshield_phase1\finshield_chen_er_diagram.excalidraw"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(diagram, f, indent=2)
    print(f"Classic Chen ER Diagram successfully generated at: {output_path}")
    print(f"Total elements: {len(diagram['elements'])}")
