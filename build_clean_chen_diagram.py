import json
import uuid
import random

def build_pristine_chen_diagram():
    elements = []

    def make_id(prefix):
        return f"{prefix}_{str(uuid.uuid4())[:8]}"

    def add_shape(shape_type, x, y, w, h, bg="#ffffff", stroke="#1e293b", stroke_w=2, stroke_s="solid", fill="solid", roundness=True):
        el_id = make_id(shape_type)
        r_obj = {"type": 3} if roundness else None
        el = {
            "id": el_id,
            "type": shape_type,
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
            "roughness": 0,
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

    def add_label(cx, cy, text, font_size=13, color="#0f172a", bold=False, underline=False):
        el_id = make_id("text")
        lines = text.split("\n")
        line_height = 1.3
        h = len(lines) * font_size * line_height
        w = max(len(l) for l in lines) * (font_size * 0.65) + 14
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

    def add_straight_line(x1, y1, x2, y2, stroke="#475569", stroke_w=1.5, stroke_s="solid"):
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

    # 1. ENTITY (Rectangle with ample padding so text never clips)
    def render_entity(cx, cy, w, h, name, is_weak=False, bg="#dbeafe", stroke="#1e40af"):
        if is_weak:
            add_shape("rectangle", cx - w/2 - 5, cy - h/2 - 5, w + 10, h + 10, bg="transparent", stroke=stroke, stroke_w=1.5, roundness=True)
        add_shape("rectangle", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=2.5, roundness=True)
        add_label(cx, cy, name, font_size=14, color=stroke, bold=True)
        return (cx, cy, w, h)

    # 2. RELATIONSHIP (Diamond with spacious width)
    def render_diamond(cx, cy, w, h, name, is_identifying=False, bg="#fef3c7", stroke="#b45309"):
        if is_identifying:
            add_shape("diamond", cx - (w+14)/2, cy - (h+14)/2, w + 14, h + 14, bg="transparent", stroke=stroke, stroke_w=1.5)
        add_shape("diamond", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=2)
        add_label(cx, cy, name, font_size=11, color=stroke, bold=True)
        return (cx, cy, w, h)

    # 3. ATTRIBUTE (Oval)
    def render_attribute(cx, cy, w, h, name, is_pk=False, is_derived=False, is_multivalued=False, bg="#f8fafc", stroke="#334155"):
        stroke_s = "dashed" if is_derived else "solid"
        if is_pk:
            bg = "#fef9c3"
            stroke = "#854d0e"
        elif is_derived:
            bg = "#fff7ed"
            stroke = "#c2410c"

        if is_multivalued:
            add_shape("ellipse", cx - (w+8)/2, cy - (h+8)/2, w + 8, h + 8, bg="transparent", stroke=stroke, stroke_w=1.5)

        add_shape("ellipse", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=1.5, stroke_s=stroke_s)
        add_label(cx, cy, name, font_size=11, color=stroke, bold=is_pk, underline=is_pk)
        return (cx, cy, w, h)

    # =========================================================================
    # DIAGRAM TITLE & NOTATION KEY
    # =========================================================================
    add_label(1100, 50, "FinShield: Clean Chen Entity-Relationship (ER) Architecture", font_size=28, color="#0f172a", bold=True)
    add_label(1100, 85, "Zero-Overlap Layout with Academic Chen Notation: [Entity], <Relationship>, (Attribute), (PK), (-Derived-), ((Multivalued))", font_size=14, color="#475569")

    # Legend Container
    add_shape("rectangle", 80, 115, 2040, 70, bg="#f1f5f9", stroke="#cbd5e1", stroke_w=1, roundness=True)
    render_entity(200, 150, 140, 36, "Strong Entity", bg="#dbeafe", stroke="#1e40af")
    render_entity(390, 150, 150, 36, "Weak / Derived", is_weak=True, bg="#e0e7ff", stroke="#3730a3")
    render_diamond(570, 150, 140, 42, "RELATIONSHIP", bg="#fef3c7", stroke="#b45309")
    render_attribute(740, 150, 120, 36, "key_attr", is_pk=True)
    render_attribute(890, 150, 120, 36, "derived_val", is_derived=True)
    render_attribute(1050, 150, 130, 36, "multivalued[]", is_multivalued=True)
    render_entity(1250, 150, 170, 36, "MongoDB Store", bg="#d1fae5", stroke="#065f46")
    render_entity(1470, 150, 170, 36, "pgvector Semantic", bg="#ede9fe", stroke="#5b21b6")
    render_entity(1690, 150, 170, 36, "Gatekeeper Block", bg="#fee2e2", stroke="#991b1b")

    # =========================================================================
    # COLUMN LAYOUT DESIGN (Absolute separation of concerns)
    #
    # Col 1: X = 320   (Household Shared Commitments: Dependent, Baseline, Liquid Assets)
    # Col 2: X = 880   (Central Household Spine: Household -> Snapshot -> Allocation -> Audit)
    # Col 3: X = 1520  (User Domain: User -> Incomes -> Liabilities)
    # Col 4: X = 2050  (Multi-Paradigm Engine: MongoDB Daily Spends, pgvector Playbooks)
    # =========================================================================

    # -------------------------------------------------------------------------
    # 1. CORE ENTITIES: HOUSEHOLD & USER (Y = 320)
    # -------------------------------------------------------------------------
    hh = render_entity(880, 320, 240, 60, "HOUSEHOLD", bg="#dbeafe", stroke="#1e40af")
    usr = render_entity(1520, 320, 240, 60, "USER", bg="#dbeafe", stroke="#1e40af")

    # Horizontal Relationship: BELONGS_TO (X = 1200, Y = 320)
    rel_belongs = render_diamond(1200, 320, 160, 56, "BELONGS_TO", bg="#fef3c7", stroke="#b45309")
    add_straight_line(hh[0] + hh[2]/2, hh[1], rel_belongs[0] - rel_belongs[2]/2, rel_belongs[1])
    add_label(hh[0] + hh[2]/2 + 25, hh[1] - 15, "1", font_size=14, color="#1e40af", bold=True)
    add_straight_line(rel_belongs[0] + rel_belongs[2]/2, rel_belongs[1], usr[0] - usr[2]/2, usr[1])
    add_label(usr[0] - usr[2]/2 - 25, usr[1] - 15, "N", font_size=14, color="#1e40af", bold=True)

    # Relationship: COACHES (Above between Household and User: X = 1200, Y = 230)
    rel_coaches = render_diamond(1200, 230, 150, 52, "COACHES\n(M:N)", bg="#ede9fe", stroke="#5b21b6")
    add_straight_line(hh[0] + 50, hh[1] - hh[3]/2, rel_coaches[0] - rel_coaches[2]/2, rel_coaches[1])
    add_label(rel_coaches[0] - rel_coaches[2]/2 - 15, rel_coaches[1] - 12, "N", font_size=12, color="#5b21b6", bold=True)
    add_straight_line(usr[0] - 50, usr[1] - usr[3]/2, rel_coaches[0] + rel_coaches[2]/2, rel_coaches[1])
    add_label(rel_coaches[0] + rel_coaches[2]/2 + 15, rel_coaches[1] - 12, "M", font_size=12, color="#5b21b6", bold=True)

    # Attributes of HOUSEHOLD (Above Household)
    hh_pk = render_attribute(750, 230, 130, 38, "household_id", is_pk=True)
    add_straight_line(hh[0] - 40, hh[1] - hh[3]/2, hh_pk[0], hh_pk[1] + hh_pk[3]/2)
    hh_nm = render_attribute(900, 230, 140, 38, "household_name")
    add_straight_line(hh[0] + 20, hh[1] - hh[3]/2, hh_nm[0], hh_nm[1] + hh_nm[3]/2)

    # Attributes of USER (Above & Right of User)
    u_pk = render_attribute(1420, 230, 110, 38, "user_id", is_pk=True)
    add_straight_line(usr[0] - 40, usr[1] - usr[3]/2, u_pk[0], u_pk[1] + u_pk[3]/2)
    u_fn = render_attribute(1560, 230, 120, 38, "full_name")
    add_straight_line(usr[0] + 20, usr[1] - usr[3]/2, u_fn[0], u_fn[1] + u_fn[3]/2)
    u_em = render_attribute(1700, 230, 110, 38, "email (UQ)")
    add_straight_line(usr[0] + 70, usr[1] - usr[3]/2, u_em[0], u_em[1] + u_em[3]/2)
    u_rl = render_attribute(1720, 320, 100, 38, "user_role")
    add_straight_line(usr[0] + usr[2]/2, usr[1], u_rl[0] - u_rl[2]/2, u_rl[1])

    # -------------------------------------------------------------------------
    # COL 1: HOUSEHOLD COMMENCEMENTS (Left Flank)
    # -------------------------------------------------------------------------
    # DEPENDENT (Weak Entity at X = 320, Y = 320)
    dep = render_entity(320, 320, 180, 56, "DEPENDENT", is_weak=True, bg="#f1f5f9", stroke="#475569")
    rel_dep = render_diamond(570, 320, 130, 50, "HAS_DEP", is_identifying=True, bg="#f1f5f9", stroke="#475569")
    add_straight_line(hh[0] - hh[2]/2, hh[1], rel_dep[0] + rel_dep[2]/2, rel_dep[1])
    add_label(hh[0] - hh[2]/2 - 20, hh[1] - 15, "1", font_size=13, color="#1e40af", bold=True)
    add_straight_line(rel_dep[0] - rel_dep[2]/2, rel_dep[1], dep[0] + dep[2]/2, dep[1])
    add_label(dep[0] + dep[2]/2 + 20, dep[1] - 15, "N", font_size=13, color="#475569", bold=True)

    dep_age = render_attribute(140, 290, 90, 34, "age")
    add_straight_line(dep[0] - dep[2]/2, dep[1] - 10, dep_age[0] + dep_age[2]/2, dep_age[1])
    dep_rel = render_attribute(140, 350, 100, 34, "relationship")
    add_straight_line(dep[0] - dep[2]/2, dep[1] + 10, dep_rel[0] + dep_rel[2]/2, dep_rel[1])

    # BASELINE EXPENSES (X = 320, Y = 560)
    base = render_entity(320, 560, 210, 56, "BASELINE_EXPENSE", bg="#ccfbf1", stroke="#0f766e")
    rel_base = render_diamond(570, 480, 140, 50, "PAYS_COSTS", bg="#fef3c7", stroke="#b45309")
    add_straight_line(hh[0] - 50, hh[1] + hh[3]/2, rel_base[0] + 30, rel_base[1] - rel_base[3]/2)
    add_label(rel_base[0] + 50, rel_base[1] - rel_base[3]/2 - 10, "1", font_size=13, color="#1e40af", bold=True)
    add_straight_line(rel_base[0] - rel_base[2]/2, rel_base[1] + 10, base[0] + 50, base[1] - base[3]/2)
    add_label(base[0] + 65, base[1] - base[3]/2 - 12, "N", font_size=13, color="#0f766e", bold=True)

    b_pk = render_attribute(130, 520, 110, 36, "expense_id", is_pk=True)
    add_straight_line(base[0] - base[2]/2, base[1] - 15, b_pk[0] + b_pk[2]/2, b_pk[1])
    b_amt = render_attribute(130, 570, 110, 36, "monthly_amt")
    add_straight_line(base[0] - base[2]/2, base[1] + 5, b_amt[0] + b_amt[2]/2, b_amt[1])
    b_cat = render_attribute(130, 620, 120, 36, "category_name")
    add_straight_line(base[0] - base[2]/2, base[1] + 20, b_cat[0] + b_cat[2]/2, b_cat[1])

    # LIQUID ASSETS (X = 320, Y = 780)
    liq = render_entity(320, 780, 200, 56, "LIQUID_ASSET", bg="#ccfbf1", stroke="#0f766e")
    rel_liq = render_diamond(570, 680, 140, 50, "HOLDS_RESERVE", bg="#fef3c7", stroke="#b45309")
    add_straight_line(hh[0] - 80, hh[1] + hh[3]/2, rel_liq[0] + 20, rel_liq[1] - rel_liq[3]/2)
    add_label(rel_liq[0] + 45, rel_liq[1] - rel_liq[3]/2 - 10, "1", font_size=13, color="#1e40af", bold=True)
    add_straight_line(rel_liq[0] - rel_liq[2]/2, rel_liq[1] + 15, liq[0] + 50, liq[1] - liq[3]/2)
    add_label(liq[0] + 65, liq[1] - liq[3]/2 - 12, "N", font_size=13, color="#0f766e", bold=True)

    l_pk = render_attribute(130, 740, 100, 36, "asset_id", is_pk=True)
    add_straight_line(liq[0] - liq[2]/2, liq[1] - 15, l_pk[0] + l_pk[2]/2, l_pk[1])
    l_bal = render_attribute(130, 790, 110, 36, "current_bal")
    add_straight_line(liq[0] - liq[2]/2, liq[1] + 5, l_bal[0] + l_bal[2]/2, l_bal[1])
    l_emg = render_attribute(130, 840, 130, 36, "is_emergency_fund")
    add_straight_line(liq[0] - liq[2]/2, liq[1] + 20, l_emg[0] + l_emg[2]/2, l_emg[1])

    # -------------------------------------------------------------------------
    # COL 3: USER EARNINGS & DEBTS (Right Flank: X = 1380 & 1660, Y = 560)
    # -------------------------------------------------------------------------
    # INCOME (X = 1360, Y = 560)
    inc = render_entity(1360, 560, 180, 56, "INCOME", bg="#ccfbf1", stroke="#0f766e")
    rel_inc = render_diamond(1380, 440, 120, 48, "EARNS", bg="#fef3c7", stroke="#b45309")
    add_straight_line(usr[0] - 40, usr[1] + usr[3]/2, rel_inc[0], rel_inc[1] - rel_inc[3]/2)
    add_label(rel_inc[0] - 20, rel_inc[1] - rel_inc[3]/2 - 10, "1", font_size=13, color="#1e40af", bold=True)
    add_straight_line(rel_inc[0], rel_inc[1] + rel_inc[3]/2, inc[0] + 10, inc[1] - inc[3]/2)
    add_label(inc[0] + 25, inc[1] - inc[3]/2 - 10, "N", font_size=13, color="#0f766e", bold=True)

    i_pk = render_attribute(1220, 620, 100, 34, "income_id", is_pk=True)
    add_straight_line(inc[0] - 40, inc[1] + inc[3]/2, i_pk[0] + 20, i_pk[1] - i_pk[3]/2)
    i_amt = render_attribute(1350, 640, 105, 34, "monthly_amt")
    add_straight_line(inc[0], inc[1] + inc[3]/2, i_amt[0], i_amt[1] - i_amt[3]/2)
    i_day = render_attribute(1470, 620, 95, 34, "pay_day")
    add_straight_line(inc[0] + 40, inc[1] + inc[3]/2, i_day[0] - 20, i_day[1] - i_day[3]/2)

    # LIABILITY (X = 1680, Y = 560)
    liab = render_entity(1680, 560, 180, 56, "LIABILITY", bg="#ccfbf1", stroke="#0f766e")
    rel_liab = render_diamond(1660, 440, 120, 48, "INCURS", bg="#fef3c7", stroke="#b45309")
    add_straight_line(usr[0] + 40, usr[1] + usr[3]/2, rel_liab[0], rel_liab[1] - rel_liab[3]/2)
    add_label(rel_liab[0] + 20, rel_liab[1] - rel_liab[3]/2 - 10, "1", font_size=13, color="#1e40af", bold=True)
    add_straight_line(rel_liab[0], rel_liab[1] + rel_liab[3]/2, liab[0] - 10, liab[1] - liab[3]/2)
    add_label(liab[0] - 25, liab[1] - liab[3]/2 - 10, "N", font_size=13, color="#0f766e", bold=True)

    lb_pk = render_attribute(1590, 640, 85, 34, "debt_id", is_pk=True)
    add_straight_line(liab[0] - 40, liab[1] + liab[3]/2, lb_pk[0] + 15, lb_pk[1] - lb_pk[3]/2)
    lb_emi = render_attribute(1700, 650, 100, 34, "monthly_emi")
    add_straight_line(liab[0], liab[1] + liab[3]/2, lb_emi[0], lb_emi[1] - lb_emi[3]/2)
    lb_rate = render_attribute(1820, 630, 95, 34, "interest_rate")
    add_straight_line(liab[0] + 40, liab[1] + liab[3]/2, lb_rate[0] - 15, lb_rate[1] - lb_rate[3]/2)
    lb_prn = render_attribute(1830, 560, 105, 34, "principal_rem")
    add_straight_line(liab[0] + liab[2]/2, liab[1], lb_prn[0] - lb_prn[2]/2, lb_prn[1])

    # -------------------------------------------------------------------------
    # COL 2: THE CENTRAL HOUSEHOLD & DECISION SPINE (X = 880)
    # Pure vertical alignment: Zero crossing lines!
    # -------------------------------------------------------------------------
    # 1. EVALUATES_TIER (Diamond between Household and Snapshot: Y = 460)
    rel_eval = render_diamond(880, 460, 170, 56, "EVALUATES_TIER\n(1:1 Trigger)", bg="#fee2e2", stroke="#b91c1c")
    add_straight_line(hh[0], hh[1] + hh[3]/2, rel_eval[0], rel_eval[1] - rel_eval[3]/2, stroke="#b91c1c", stroke_w=2)
    add_label(rel_eval[0] + 20, rel_eval[1] - rel_eval[3]/2 - 15, "1", font_size=13, color="#1e40af", bold=True)

    # 2. FINANCIAL_SNAPSHOT (Double Rectangle at X = 880, Y = 620)
    snap = render_entity(880, 620, 260, 66, "FINANCIAL_SNAPSHOT\n(Derived Entity)", is_weak=True, bg="#fef3c7", stroke="#b45309")
    add_straight_line(rel_eval[0], rel_eval[1] + rel_eval[3]/2, snap[0], snap[1] - snap[3]/2, stroke="#b91c1c", stroke_w=2)
    add_label(snap[0] + 20, snap[1] - snap[3]/2 - 15, "1", font_size=13, color="#b45309", bold=True)

    # Derived Attributes of Snapshot (Fanning out to the Left into clear space: X = 560-680)
    sn_run = render_attribute(630, 580, 120, 36, "runway_months", is_derived=True)
    add_straight_line(snap[0] - snap[2]/2, snap[1] - 15, sn_run[0] + sn_run[2]/2, sn_run[1])
    sn_dti = render_attribute(630, 630, 110, 36, "dti_ratio", is_derived=True)
    add_straight_line(snap[0] - snap[2]/2, snap[1], sn_dti[0] + sn_dti[2]/2, sn_dti[1])
    sn_rig = render_attribute(630, 680, 110, 36, "rigidity_ratio", is_derived=True)
    add_straight_line(snap[0] - snap[2]/2, snap[1] + 15, sn_rig[0] + sn_rig[2]/2, sn_rig[1])
    sn_sur = render_attribute(630, 730, 130, 36, "structural_surplus", is_derived=True)
    add_straight_line(snap[0] - snap[2]/2, snap[1] + 25, sn_sur[0] + sn_sur[2]/2, sn_sur[1])

    # Normal Attribute: current_tier (Right of snapshot)
    sn_tier = render_attribute(1080, 620, 100, 36, "current_tier")
    add_straight_line(snap[0] + snap[2]/2, snap[1], sn_tier[0] - sn_tier[2]/2, sn_tier[1])

    # Multivalued Attribute: tier_reasons[] (Double oval cleanly placed on lower right of snapshot)
    sn_reasons = render_attribute(1110, 690, 130, 38, "tier_reasons[]", is_multivalued=True, bg="#fff1f2", stroke="#e11d48")
    add_straight_line(snap[0] + snap[2]/2 - 20, snap[1] + snap[3]/2, sn_reasons[0] - sn_reasons[2]/2, sn_reasons[1])

    # 3. GATEKEEPER (Diamond below Snapshot: Y = 780)
    rel_gate = render_diamond(880, 780, 190, 58, "GATEKEEPER\n(FS001 Enforcement)", bg="#fca5a5", stroke="#991b1b")
    add_straight_line(snap[0], snap[1] + snap[3]/2, rel_gate[0], rel_gate[1] - rel_gate[3]/2, stroke="#991b1b", stroke_w=2.5)

    # 4. ASSET_ALLOCATION (Target of Gatekeeper at X = 880, Y = 940)
    alloc = render_entity(880, 940, 240, 62, "ASSET_ALLOCATION\n(Portfolio Strategy)", bg="#fee2e2", stroke="#991b1b")
    add_straight_line(rel_gate[0], rel_gate[1] + rel_gate[3]/2, alloc[0], alloc[1] - alloc[3]/2, stroke="#991b1b", stroke_w=2.5)
    add_label(alloc[0] + 20, alloc[1] - alloc[3]/2 - 15, "Enforces", font_size=11, color="#991b1b", bold=True)

    # Attributes of Allocation (Fanning out to the left)
    al_pk = render_attribute(630, 900, 110, 34, "allocation_id", is_pk=True)
    add_straight_line(alloc[0] - alloc[2]/2, alloc[1] - 15, al_pk[0] + al_pk[2]/2, al_pk[1])
    al_eq = render_attribute(630, 945, 110, 34, "equity_pct")
    add_straight_line(alloc[0] - alloc[2]/2, alloc[1], al_eq[0] + al_eq[2]/2, al_eq[1])
    al_ovr = render_attribute(630, 990, 110, 34, "is_override")
    add_straight_line(alloc[0] - alloc[2]/2, alloc[1] + 15, al_ovr[0] + al_ovr[2]/2, al_ovr[1])
    al_rsn = render_attribute(750, 1040, 125, 34, "override_reason")
    add_straight_line(alloc[0] - 40, alloc[1] + alloc[3]/2, al_rsn[0], al_rsn[1] - al_rsn[3]/2)

    # 5. POLICY_AUDIT_LOG (Horizontal to the right of Asset Allocation: X = 1360, Y = 940)
    aud = render_entity(1360, 940, 230, 60, "POLICY_AUDIT_LOG\n(Compliance Ledger)", bg="#fff1f2", stroke="#831843")
    rel_aud = render_diamond(1120, 940, 140, 50, "RECORDS_LOG", bg="#ffe4e6", stroke="#9f1239")
    add_straight_line(alloc[0] + alloc[2]/2, alloc[1], rel_aud[0] - rel_aud[2]/2, rel_aud[1])
    add_straight_line(rel_aud[0] + rel_aud[2]/2, rel_aud[1], aud[0] - aud[2]/2, aud[1])
    add_label(rel_aud[0], rel_aud[1] - 30, "if override=true", font_size=10, color="#9f1239")

    au_pk = render_attribute(1360, 1040, 100, 34, "log_id", is_pk=True)
    add_straight_line(aud[0], aud[1] + aud[3]/2, au_pk[0], au_pk[1] - au_pk[3]/2)
    au_tier = render_attribute(1490, 1040, 110, 34, "enforced_tier")
    add_straight_line(aud[0] + 50, aud[1] + aud[3]/2, au_tier[0], au_tier[1] - au_tier[3]/2)

    # -------------------------------------------------------------------------
    # COL 4: MULTI-PARADIGM ENGINES (MongoDB Store & pgvector AI) (X = 2050)
    # -------------------------------------------------------------------------
    # DAILY_EXPENSE (MongoDB at X = 2050, Y = 560)
    mgo = render_entity(2050, 560, 240, 66, "DAILY_EXPENSE\n(MongoDB Document Store)", bg="#d1fae5", stroke="#065f46")

    # USER logs spend into MongoDB (X = 1880, Y = 440)
    rel_log = render_diamond(1880, 440, 130, 50, "LOGS_SPEND", bg="#d1fae5", stroke="#065f46")
    add_straight_line(usr[0] + usr[2]/2, usr[1] + 15, rel_log[0] - 20, rel_log[1] - rel_log[3]/2)
    add_label(usr[0] + usr[2]/2 + 25, usr[1] + 30, "1", font_size=13, color="#1e40af", bold=True)
    add_straight_line(rel_log[0] + rel_log[2]/2, rel_log[1] + 10, mgo[0] - 20, mgo[1] - mgo[3]/2)
    add_label(mgo[0] - 35, mgo[1] - mgo[3]/2 - 10, "N", font_size=13, color="#065f46", bold=True)

    mg_amt = render_attribute(2000, 660, 95, 34, "amount")
    add_straight_line(mgo[0] - 30, mgo[1] + mgo[3]/2, mg_amt[0], mg_amt[1] - mg_amt[3]/2)
    mg_meta = render_attribute(2130, 660, 120, 34, "merchant_meta")
    add_straight_line(mgo[0] + 30, mgo[1] + mgo[3]/2, mg_meta[0], mg_meta[1] - mg_meta[3]/2)

    # MongoDB Syncs MTD into Postgres Snapshot (Routed cleanly across: Y = 740)
    # Clean pipeline relationship
    rel_sync = render_diamond(1500, 740, 180, 54, "SYNCS_MTD\n(Aggregation Pipeline)", bg="#dcfce7", stroke="#15803d")
    add_straight_line(mgo[0] - mgo[2]/2, mgo[1] + 25, rel_sync[0] + rel_sync[2]/2, rel_sync[1] - 10, stroke="#15803d", stroke_w=2)
    add_straight_line(rel_sync[0] - rel_sync[2]/2, rel_sync[1] - 10, snap[0] + snap[2]/2, snap[1] + 20, stroke="#15803d", stroke_w=2)
    add_label(rel_sync[0] + 120, rel_sync[1] - 25, "$match + $group", font_size=10, color="#15803d")
    add_label(rel_sync[0] - 120, rel_sync[1] - 25, "Escalates Tier", font_size=10, color="#15803d")

    # RECOVERY_PLAYBOOK (pgvector at X = 2050, Y = 940)
    vec = render_entity(2050, 940, 240, 66, "RECOVERY_PLAYBOOK\n(pgvector Semantic Engine)", bg="#ede9fe", stroke="#5b21b6")
    rel_vec = render_diamond(1730, 940, 160, 52, "RETRIEVES_RAG\n(Cosine <=>)", bg="#ede9fe", stroke="#5b21b6")
    add_straight_line(aud[0] + aud[2]/2, aud[1], rel_vec[0] - rel_vec[2]/2, rel_vec[1], stroke="#5b21b6", stroke_w=1.5)
    add_straight_line(rel_vec[0] + rel_vec[2]/2, rel_vec[1], vec[0] - vec[2]/2, vec[1], stroke="#5b21b6", stroke_w=1.5)

    v_pk = render_attribute(2000, 1040, 110, 34, "playbook_id", is_pk=True)
    add_straight_line(vec[0] - 30, vec[1] + vec[3]/2, v_pk[0], v_pk[1] - v_pk[3]/2)
    v_emb = render_attribute(2140, 1040, 125, 34, "embedding(384)")
    add_straight_line(vec[0] + 30, vec[1] + vec[3]/2, v_emb[0], v_emb[1] - v_emb[3]/2)

    # Final wrap in Excalidraw format
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
    diagram = build_pristine_chen_diagram()
    output_path = r"C:\Users\Ankit Umadi\Downloads\finshield_phase1\finshield_phase1\finshield_chen_clean.excalidraw"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(diagram, f, indent=2)
    
    # Also update finshield_er_diagram.excalidraw
    main_path = r"C:\Users\Ankit Umadi\Downloads\finshield_phase1\finshield_phase1\finshield_er_diagram.excalidraw"
    with open(main_path, "w", encoding="utf-8") as f:
        json.dump(diagram, f, indent=2)

    print(f"Pristine, non-overlapping Chen ER diagram written to: {output_path}")
    print(f"Total clean elements: {len(diagram['elements'])}")
