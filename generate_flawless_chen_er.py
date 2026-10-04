import json
import uuid
import random

def generate_flawless_chen_er():
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
        w = max(len(l) for l in lines) * (font_size * 0.65) + 16
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

    def add_line(x1, y1, x2, y2, stroke="#475569", stroke_w=1.5, stroke_s="solid"):
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

    def draw_entity(cx, cy, w, h, name, is_weak=False, bg="#dbeafe", stroke="#1e40af"):
        if is_weak:
            add_shape("rectangle", cx - w/2 - 5, cy - h/2 - 5, w + 10, h + 10, bg="transparent", stroke=stroke, stroke_w=1.5, roundness=True)
        add_shape("rectangle", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=2.5, roundness=True)
        add_label(cx, cy, name, font_size=14, color=stroke, bold=True)
        return (cx, cy, w, h)

    def draw_diamond(cx, cy, w, h, name, is_identifying=False, bg="#fef3c7", stroke="#b45309"):
        if is_identifying:
            add_shape("diamond", cx - (w+14)/2, cy - (h+14)/2, w + 14, h + 14, bg="transparent", stroke=stroke, stroke_w=1.5)
        add_shape("diamond", cx - w/2, cy - h/2, w, h, bg=bg, stroke=stroke, stroke_w=2)
        add_label(cx, cy, name, font_size=11, color=stroke, bold=True)
        return (cx, cy, w, h)

    def draw_attribute(cx, cy, w, h, name, is_pk=False, is_derived=False, is_multivalued=False, bg="#f8fafc", stroke="#334155"):
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
    # HEADER & LEGEND
    # =========================================================================
    add_label(1200, 50, "FinShield: Architectural Chen Entity-Relationship (ER) Diagram", font_size=28, color="#0f172a", bold=True)
    add_label(1200, 85, "Zero-Clash Layout: Dedicated Orthogonal Corridors & Isolated Attribute Zones", font_size=14, color="#475569")

    # Legend Bar (Y: 100 to 152 - cleanly isolated with 48px clearance above all entities)
    add_shape("rectangle", 120, 100, 2160, 52, bg="#f1f5f9", stroke="#cbd5e1", stroke_w=1, roundness=True)
    draw_entity(250, 126, 130, 30, "Strong Entity", bg="#dbeafe", stroke="#1e40af")
    draw_entity(430, 126, 140, 30, "Weak / Derived", is_weak=True, bg="#e0e7ff", stroke="#3730a3")
    draw_diamond(620, 126, 130, 34, "RELATIONSHIP", bg="#fef3c7", stroke="#b45309")
    draw_attribute(790, 126, 110, 30, "key_attr (PK)", is_pk=True)
    draw_attribute(940, 126, 110, 30, "derived_val", is_derived=True)
    draw_attribute(1100, 126, 120, 30, "reasons[]", is_multivalued=True)
    draw_entity(1300, 126, 150, 30, "MongoDB Store", bg="#d1fae5", stroke="#065f46")
    draw_entity(1520, 126, 160, 30, "pgvector Semantic", bg="#ede9fe", stroke="#5b21b6")
    draw_entity(1750, 126, 160, 30, "Gatekeeper Block", bg="#fee2e2", stroke="#991b1b")

    # =========================================================================
    # 1. CORE ENTITIES: HOUSEHOLD & USER (Level Y = 320)
    # =========================================================================
    hh = draw_entity(850, 320, 250, 62, "HOUSEHOLD", bg="#dbeafe", stroke="#1e40af")
    usr = draw_entity(1550, 320, 250, 62, "USER", bg="#dbeafe", stroke="#1e40af")

    # Bridge between Household and User: BELONGS_TO (X = 1200, Y = 320)
    rel_belongs = draw_diamond(1200, 320, 170, 58, "BELONGS_TO", bg="#fef3c7", stroke="#b45309")
    add_line(hh[0] + hh[2]/2, hh[1], rel_belongs[0] - rel_belongs[2]/2, rel_belongs[1])
    add_label(hh[0] + hh[2]/2 + 25, hh[1] - 15, "1", font_size=14, color="#1e40af", bold=True)
    add_line(rel_belongs[0] + rel_belongs[2]/2, rel_belongs[1], usr[0] - usr[2]/2, usr[1])
    add_label(usr[0] - usr[2]/2 - 25, usr[1] - 15, "N", font_size=14, color="#1e40af", bold=True)

    # Relationship: COACHES (Arched cleanly above: X = 1200, Y = 220)
    rel_coach = draw_diamond(1200, 220, 160, 54, "COACHES\n(M:N)", bg="#ede9fe", stroke="#5b21b6")
    add_line(hh[0] + 50, hh[1] - hh[3]/2, rel_coach[0] - rel_coach[2]/2, rel_coach[1])
    add_label(rel_coach[0] - rel_coach[2]/2 - 15, rel_coach[1] - 12, "N", font_size=12, color="#5b21b6", bold=True)
    add_line(usr[0] - 50, usr[1] - usr[3]/2, rel_coach[0] + rel_coach[2]/2, rel_coach[1])
    add_label(rel_coach[0] + rel_coach[2]/2 + 15, rel_coach[1] - 12, "M", font_size=12, color="#5b21b6", bold=True)

    # Attributes of HOUSEHOLD (Above Household)
    hh_pk = draw_attribute(740, 230, 130, 38, "household_id", is_pk=True)
    add_line(hh[0] - 50, hh[1] - hh[3]/2, hh_pk[0], hh_pk[1] + hh_pk[3]/2)
    hh_nm = draw_attribute(900, 230, 140, 38, "household_name")
    add_line(hh[0] + 30, hh[1] - hh[3]/2, hh_nm[0], hh_nm[1] + hh_nm[3]/2)

    # Attributes of USER (Above & Upper-Right of User)
    u_pk = draw_attribute(1440, 230, 110, 38, "user_id", is_pk=True)
    add_line(usr[0] - 50, usr[1] - usr[3]/2, u_pk[0], u_pk[1] + u_pk[3]/2)
    u_fn = draw_attribute(1580, 230, 120, 38, "full_name")
    add_line(usr[0] + 10, usr[1] - usr[3]/2, u_fn[0], u_fn[1] + u_fn[3]/2)
    u_em = draw_attribute(1720, 230, 110, 38, "email (UQ)")
    add_line(usr[0] + 60, usr[1] - usr[3]/2, u_em[0], u_em[1] + u_em[3]/2)
    u_rl = draw_attribute(1740, 320, 100, 38, "user_role")
    add_line(usr[0] + usr[2]/2, usr[1], u_rl[0] - u_rl[2]/2, u_rl[1])

    # =========================================================================
    # 2. HOUSEHOLD LEFT FLANK (Level Y <= 520)
    # Fully segregated in X <= 550, Y <= 520 with ample vertical breathing room
    # =========================================================================
    # DEPENDENT (Top-Left: X = 250, Y = 210)
    dep = draw_entity(250, 210, 180, 54, "DEPENDENT", is_weak=True, bg="#f1f5f9", stroke="#475569")
    rel_dep = draw_diamond(530, 240, 130, 48, "HAS_DEP", is_identifying=True, bg="#f1f5f9", stroke="#475569")
    add_line(hh[0] - 80, hh[1] - hh[3]/2, rel_dep[0] + rel_dep[2]/2, rel_dep[1])
    add_label(rel_dep[0] + rel_dep[2]/2 + 15, rel_dep[1] - 12, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_dep[0] - rel_dep[2]/2, rel_dep[1], dep[0] + dep[2]/2, dep[1])
    add_label(dep[0] + dep[2]/2 + 20, dep[1] - 12, "N", font_size=13, color="#475569", bold=True)

    d_age = draw_attribute(100, 185, 85, 34, "age")
    add_line(dep[0] - dep[2]/2, dep[1] - 10, d_age[0] + d_age[2]/2, d_age[1])
    d_rel = draw_attribute(100, 235, 100, 34, "relationship")
    add_line(dep[0] - dep[2]/2, dep[1] + 10, d_rel[0] + d_rel[2]/2, d_rel[1])

    # BASELINE EXPENSE (Mid-Left: X = 250, Y = 345)
    base = draw_entity(250, 345, 210, 54, "BASELINE_EXPENSE", bg="#ccfbf1", stroke="#0f766e")
    rel_base = draw_diamond(530, 345, 140, 50, "PAYS_COSTS", bg="#fef3c7", stroke="#b45309")
    add_line(hh[0] - hh[2]/2, hh[1], rel_base[0] + rel_base[2]/2, rel_base[1])
    add_label(hh[0] - hh[2]/2 - 20, hh[1] - 15, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_base[0] - rel_base[2]/2, rel_base[1], base[0] + base[2]/2, base[1])
    add_label(base[0] + base[2]/2 + 20, base[1] - 15, "N", font_size=13, color="#0f766e", bold=True)

    b_pk = draw_attribute(100, 305, 110, 34, "expense_id", is_pk=True)
    add_line(base[0] - base[2]/2, base[1] - 12, b_pk[0] + b_pk[2]/2, b_pk[1])
    b_amt = draw_attribute(100, 350, 110, 34, "monthly_amt")
    add_line(base[0] - base[2]/2, base[1] + 2, b_amt[0] + b_amt[2]/2, b_amt[1])
    b_cat = draw_attribute(100, 395, 120, 34, "category_name")
    add_line(base[0] - base[2]/2, base[1] + 16, b_cat[0] + b_cat[2]/2, b_cat[1])

    # LIQUID ASSET (Lower-Left: X = 250, Y = 485)
    liq = draw_entity(250, 485, 200, 54, "LIQUID_ASSET", bg="#ccfbf1", stroke="#0f766e")
    rel_liq = draw_diamond(530, 435, 150, 50, "HOLDS_RESERVE", bg="#fef3c7", stroke="#b45309")
    add_line(hh[0] - 60, hh[1] + hh[3]/2, rel_liq[0] + rel_liq[2]/2, rel_liq[1] - 10)
    add_label(rel_liq[0] + rel_liq[2]/2 + 15, rel_liq[1] - 18, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_liq[0] - rel_liq[2]/2, rel_liq[1] + 10, liq[0] + liq[2]/2, liq[1] - 15)
    add_label(liq[0] + liq[2]/2 + 18, liq[1] - 22, "N", font_size=13, color="#0f766e", bold=True)

    l_pk = draw_attribute(100, 445, 100, 34, "asset_id", is_pk=True)
    add_line(liq[0] - liq[2]/2, liq[1] - 12, l_pk[0] + l_pk[2]/2, l_pk[1])
    l_bal = draw_attribute(100, 490, 110, 34, "current_bal")
    add_line(liq[0] - liq[2]/2, liq[1] + 2, l_bal[0] + l_bal[2]/2, l_bal[1])
    l_emg = draw_attribute(100, 535, 130, 34, "is_emergency_fund")
    add_line(liq[0] - liq[2]/2, liq[1] + 16, l_emg[0] + l_emg[2]/2, l_emg[1])

    # =========================================================================
    # 3. USER RIGHT FLANK: INCOMES & LIABILITIES (Level Y <= 500)
    # Fully segregated in X >= 1850, Y <= 500 so it NEVER touches lower sync lines!
    # =========================================================================
    # INCOME (Top-Right: X = 2080, Y = 250)
    inc = draw_entity(2080, 250, 190, 56, "INCOME", bg="#ccfbf1", stroke="#0f766e")
    rel_inc = draw_diamond(1830, 270, 130, 48, "EARNS", bg="#fef3c7", stroke="#b45309")
    add_line(usr[0] + 60, usr[1] - usr[3]/2, rel_inc[0] - rel_inc[2]/2, rel_inc[1] - 10)
    add_label(rel_inc[0] - rel_inc[2]/2 - 15, rel_inc[1] - 18, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_inc[0] + rel_inc[2]/2, rel_inc[1] - 5, inc[0] - inc[2]/2, inc[1])
    add_label(inc[0] - inc[2]/2 - 18, inc[1] - 14, "N", font_size=13, color="#0f766e", bold=True)

    i_pk = draw_attribute(2260, 205, 100, 34, "income_id", is_pk=True)
    add_line(inc[0] + inc[2]/2, inc[1] - 15, i_pk[0] - i_pk[2]/2, i_pk[1])
    i_amt = draw_attribute(2260, 250, 110, 34, "monthly_amt")
    add_line(inc[0] + inc[2]/2, inc[1], i_amt[0] - i_amt[2]/2, i_amt[1])
    i_day = draw_attribute(2260, 295, 95, 34, "pay_day")
    add_line(inc[0] + inc[2]/2, inc[1] + 15, i_day[0] - i_day[2]/2, i_day[1])

    # LIABILITY (Mid-Right: X = 2080, Y = 410)
    liab = draw_entity(2080, 410, 190, 56, "LIABILITY", bg="#ccfbf1", stroke="#0f766e")
    rel_liab = draw_diamond(1830, 380, 130, 48, "INCURS", bg="#fef3c7", stroke="#b45309")
    add_line(usr[0] + 70, usr[1] + usr[3]/2, rel_liab[0] - rel_liab[2]/2, rel_liab[1])
    add_label(rel_liab[0] - rel_liab[2]/2 - 15, rel_liab[1] - 14, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_liab[0] + rel_liab[2]/2, rel_liab[1] + 10, liab[0] - liab[2]/2, liab[1])
    add_label(liab[0] - liab[2]/2 - 18, liab[1] - 14, "N", font_size=13, color="#0f766e", bold=True)

    lb_pk = draw_attribute(2260, 350, 85, 34, "debt_id", is_pk=True)
    add_line(liab[0] + liab[2]/2, liab[1] - 18, lb_pk[0] - lb_pk[2]/2, lb_pk[1])
    lb_emi = draw_attribute(2260, 395, 100, 34, "monthly_emi")
    add_line(liab[0] + liab[2]/2, liab[1] - 5, lb_emi[0] - lb_emi[2]/2, lb_emi[1])
    lb_rate = draw_attribute(2260, 440, 100, 34, "interest_rate")
    add_line(liab[0] + liab[2]/2, liab[1] + 8, lb_rate[0] - lb_rate[2]/2, lb_rate[1])
    lb_prn = draw_attribute(2260, 485, 105, 34, "principal_rem")
    add_line(liab[0] + liab[2]/2, liab[1] + 20, lb_prn[0] - lb_prn[2]/2, lb_prn[1])

    # =========================================================================
    # 4. CENTRAL DECISION SPINE (Pure Vertical Axis: X = 850)
    # Zero lateral skew, zero intersections!
    # =========================================================================
    # 1. EVALUATES_TIER (Diamond at Y = 490)
    rel_eval = draw_diamond(850, 490, 190, 60, "EVALUATES_TIER\n(1:1 Trigger)", bg="#fee2e2", stroke="#b91c1c")
    add_line(hh[0], hh[1] + hh[3]/2, rel_eval[0], rel_eval[1] - rel_eval[3]/2, stroke="#b91c1c", stroke_w=2.5)
    add_label(rel_eval[0] + 25, rel_eval[1] - rel_eval[3]/2 - 14, "1", font_size=13, color="#1e40af", bold=True)

    # 2. FINANCIAL_SNAPSHOT (Double Rectangle at Y = 680)
    snap = draw_entity(850, 680, 280, 70, "FINANCIAL_SNAPSHOT\n(Derived Entity)", is_weak=True, bg="#fef3c7", stroke="#b45309")
    add_line(rel_eval[0], rel_eval[1] + rel_eval[3]/2, snap[0], snap[1] - snap[3]/2, stroke="#b91c1c", stroke_w=2.5)
    add_label(snap[0] + 25, snap[1] - snap[3]/2 - 14, "1", font_size=13, color="#b45309", bold=True)

    # DERIVED ATTRIBUTES: Spreading into the 100% EMPTY Lower-Left Corridor (X = 480-550, Y = 600-800)
    sn_run = draw_attribute(510, 610, 130, 36, "runway_months", is_derived=True)
    add_line(snap[0] - snap[2]/2, snap[1] - 20, sn_run[0] + sn_run[2]/2, sn_run[1])

    sn_dti = draw_attribute(490, 665, 115, 36, "dti_ratio", is_derived=True)
    add_line(snap[0] - snap[2]/2, snap[1] - 5, sn_dti[0] + sn_dti[2]/2, sn_dti[1])

    sn_rig = draw_attribute(500, 720, 115, 36, "rigidity_ratio", is_derived=True)
    add_line(snap[0] - snap[2]/2, snap[1] + 10, sn_rig[0] + sn_rig[2]/2, sn_rig[1])

    sn_sur = draw_attribute(520, 775, 135, 36, "structural_surplus", is_derived=True)
    add_line(snap[0] - snap[2]/2, snap[1] + 25, sn_sur[0] + sn_sur[2]/2, sn_sur[1])

    # Multivalued Attribute: tier_reasons[] (Double Oval placed cleanly on upper-left edge of Snapshot)
    sn_reasons = draw_attribute(710, 580, 135, 38, "tier_reasons[]", is_multivalued=True, bg="#fff1f2", stroke="#e11d48")
    add_line(snap[0] - 60, snap[1] - snap[3]/2, sn_reasons[0], sn_reasons[1] + sn_reasons[3]/2, stroke="#e11d48")

    # Normal Attribute: current_tier (Placed cleanly on lower-left edge of Snapshot)
    sn_tier = draw_attribute(710, 780, 110, 36, "current_tier")
    add_line(snap[0] - 60, snap[1] + snap[3]/2, sn_tier[0], sn_tier[1] - sn_tier[3]/2)

    # 3. GATEKEEPER (Diamond at Y = 870)
    rel_gate = draw_diamond(850, 870, 210, 62, "GATEKEEPER\n(FS001 Enforcement)", bg="#fca5a5", stroke="#991b1b")
    add_line(snap[0], snap[1] + snap[3]/2, rel_gate[0], rel_gate[1] - rel_gate[3]/2, stroke="#991b1b", stroke_w=2.5)

    # 4. ASSET_ALLOCATION (Target of Gatekeeper at Y = 1050)
    alloc = draw_entity(850, 1050, 270, 66, "ASSET_ALLOCATION\n(Portfolio Strategy)", bg="#fee2e2", stroke="#991b1b")
    add_line(rel_gate[0], rel_gate[1] + rel_gate[3]/2, alloc[0], alloc[1] - alloc[3]/2, stroke="#991b1b", stroke_w=2.5)
    add_label(alloc[0] + 25, alloc[1] - alloc[3]/2 - 14, "Enforces", font_size=11, color="#991b1b", bold=True)

    # Attributes of Allocation (Fanning out to the left)
    al_pk = draw_attribute(570, 1000, 110, 34, "allocation_id", is_pk=True)
    add_line(alloc[0] - alloc[2]/2, alloc[1] - 18, al_pk[0] + al_pk[2]/2, al_pk[1])
    al_eq = draw_attribute(550, 1050, 110, 34, "equity_pct")
    add_line(alloc[0] - alloc[2]/2, alloc[1], al_eq[0] + al_eq[2]/2, al_eq[1])
    al_ovr = draw_attribute(550, 1100, 110, 34, "is_override")
    add_line(alloc[0] - alloc[2]/2, alloc[1] + 18, al_ovr[0] + al_ovr[2]/2, al_ovr[1])
    al_rsn = draw_attribute(710, 1150, 130, 34, "override_reason")
    add_line(alloc[0] - 50, alloc[1] + alloc[3]/2, al_rsn[0], al_rsn[1] - al_rsn[3]/2)

    # 5. POLICY_AUDIT_LOG (Horizontal to the right of Asset Allocation: X = 1380, Y = 1050)
    aud = draw_entity(1380, 1050, 240, 62, "POLICY_AUDIT_LOG\n(Compliance Ledger)", bg="#fff1f2", stroke="#831843")
    rel_aud = draw_diamond(1120, 1050, 160, 52, "RECORDS_LOG", bg="#ffe4e6", stroke="#9f1239")
    add_line(alloc[0] + alloc[2]/2, alloc[1], rel_aud[0] - rel_aud[2]/2, rel_aud[1])
    add_line(rel_aud[0] + rel_aud[2]/2, rel_aud[1], aud[0] - aud[2]/2, aud[1])
    add_label(rel_aud[0], rel_aud[1] - 32, "if override=true", font_size=10, color="#9f1239")

    au_pk = draw_attribute(1380, 1150, 100, 34, "log_id", is_pk=True)
    add_line(aud[0], aud[1] + aud[3]/2, au_pk[0], au_pk[1] - au_pk[3]/2)
    au_tier = draw_attribute(1520, 1150, 110, 34, "enforced_tier")
    add_line(aud[0] + 50, aud[1] + aud[3]/2, au_tier[0], au_tier[1] - au_tier[3]/2)

    # =========================================================================
    # 5. MULTI-PARADIGM ENGINES (MongoDB & pgvector at Level Y = 680 and Y = 870)
    # Perfectly level horizontal corridors with ZERO crossings!
    # =========================================================================
    # A. MongoDB Document Store (X = 1850, Y = 680)
    # NOTICE: Sits at EXACTLY Y = 680, horizontally aligned with FINANCIAL_SNAPSHOT (Y = 680)!
    mgo = draw_entity(1850, 680, 260, 70, "DAILY_EXPENSE\n(MongoDB Document Store)", bg="#d1fae5", stroke="#065f46")

    # USER logs spend into MongoDB (Diagonal through open space X in [1550, 1850], Y in [320, 680])
    rel_log = draw_diamond(1680, 500, 140, 50, "LOGS_SPEND", bg="#d1fae5", stroke="#065f46")
    add_line(usr[0] + 30, usr[1] + usr[3]/2, rel_log[0], rel_log[1] - rel_log[3]/2)
    add_label(rel_log[0] - 15, rel_log[1] - rel_log[3]/2 - 12, "1", font_size=13, color="#1e40af", bold=True)
    add_line(rel_log[0], rel_log[1] + rel_log[3]/2, mgo[0] - 40, mgo[1] - mgo[3]/2)
    add_label(mgo[0] - 55, mgo[1] - mgo[3]/2 - 12, "N", font_size=13, color="#065f46", bold=True)

    # Attributes of MongoDB (Upper-Right and Lower-Right of Daily Expense)
    mg_amt = draw_attribute(2060, 650, 95, 34, "amount")
    add_line(mgo[0] + mgo[2]/2, mgo[1] - 15, mg_amt[0] - mg_amt[2]/2, mg_amt[1])
    mg_meta = draw_attribute(2060, 700, 120, 34, "merchant_meta")
    add_line(mgo[0] + mgo[2]/2, mgo[1] + 15, mg_meta[0] - mg_meta[2]/2, mg_meta[1])

    # THE PERFECT HORIZONTAL GREEN SYNC BRIDGE (Y = 680):
    # Snapshot (850, 680) <--------------------- MongoDB (1850, 680)
    rel_sync = draw_diamond(1350, 680, 200, 58, "SYNCS_MTD\n(Aggregation Pipeline)", bg="#dcfce7", stroke="#15803d")
    add_line(snap[0] + snap[2]/2, snap[1], rel_sync[0] - rel_sync[2]/2, rel_sync[1], stroke="#15803d", stroke_w=2.5)
    add_label(rel_sync[0] - 140, rel_sync[1] - 18, "Updates Tier", font_size=11, color="#15803d", bold=True)
    add_line(rel_sync[0] + rel_sync[2]/2, rel_sync[1], mgo[0] - mgo[2]/2, mgo[1], stroke="#15803d", stroke_w=2.5)
    add_label(rel_sync[0] + 140, rel_sync[1] - 18, "$match + $group", font_size=11, color="#15803d", bold=True)

    # B. pgvector Semantic Guidance Engine (X = 1850, Y = 870)
    # NOTICE: Sits at EXACTLY Y = 870, horizontally aligned with GATEKEEPER (Y = 870)!
    vec = draw_entity(1850, 870, 260, 70, "RECOVERY_PLAYBOOK\n(pgvector Semantic Store)", bg="#ede9fe", stroke="#5b21b6")

    # THE PERFECT HORIZONTAL PURPLE VECTOR BRIDGE (Y = 870):
    # Gatekeeper (850, 870) ---------------------> pgvector (1850, 870)
    rel_vec = draw_diamond(1350, 870, 190, 58, "RETRIEVES_RAG\n(Cosine <=> Match)", bg="#ede9fe", stroke="#5b21b6")
    add_line(rel_gate[0] + rel_gate[2]/2, rel_gate[1], rel_vec[0] - rel_vec[2]/2, rel_vec[1], stroke="#5b21b6", stroke_w=2.5)
    add_label(rel_vec[0] - 130, rel_vec[1] - 18, "Tier Hard-Filter", font_size=11, color="#5b21b6", bold=True)
    add_line(rel_vec[0] + rel_vec[2]/2, rel_vec[1], vec[0] - vec[2]/2, vec[1], stroke="#5b21b6", stroke_w=2.5)
    add_label(rel_vec[0] + 130, rel_vec[1] - 18, "Top 3 Playbooks", font_size=11, color="#5b21b6", bold=True)

    v_pk = draw_attribute(2060, 840, 110, 34, "playbook_id", is_pk=True)
    add_line(vec[0] + vec[2]/2, vec[1] - 15, v_pk[0] - v_pk[2]/2, v_pk[1])
    v_emb = draw_attribute(2060, 895, 125, 34, "embedding(384)")
    add_line(vec[0] + vec[2]/2, vec[1] + 15, v_emb[0] - v_emb[2]/2, v_emb[1])

    # Final wrap in Excalidraw envelope
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
    diagram = generate_flawless_chen_er()
    clean_path = r"C:\Users\Ankit Umadi\Downloads\finshield_phase1\finshield_phase1\finshield_chen_clean.excalidraw"
    with open(clean_path, "w", encoding="utf-8") as f:
        json.dump(diagram, f, indent=2)
    
    main_path = r"C:\Users\Ankit Umadi\Downloads\finshield_phase1\finshield_phase1\finshield_er_diagram.excalidraw"
    with open(main_path, "w", encoding="utf-8") as f:
        json.dump(diagram, f, indent=2)

    print(f"Flawless Chen ER diagram successfully generated at:\n{clean_path}\n{main_path}")
    print(f"Total elements: {len(diagram['elements'])}")
