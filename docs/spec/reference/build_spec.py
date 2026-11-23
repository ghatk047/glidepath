"""Builds the machine-readable spec (variables.json, formula_graph.json) and the AA tenant
seed (seed/aa/*.json) from the three existing models. Reads them; never modifies them.

Usage: python3 build_spec.py <out_dir>
"""
import json, sys, os, re
from openpyxl import load_workbook

PF = "/mnt/project-files"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(os.path.join(OUT, "seed", "aa"), exist_ok=True)

# ============================================================================ dimensions
POOLS = [  # canonical id, AA L1 label, third-party?, swb?, shared default
    ("internal_labour", "1. Labor - Internal US", 0, 1, 0, "US labour"),
    ("captive_labour", "2. Labor - India GCC", 0, 1, 0, "India GCC"),
    ("si_contingent", "3. External labor - SIs & contingent", 1, 0, 0, "SI & contingent"),
    ("consulting", "4. Consulting & professional services", 1, 0, 0, "Consulting"),
    ("software", "5. Software licences & SaaS", 1, 0, 1, "Software"),
    ("airline_platforms", "6. Airline systems & platforms", 1, 0, 0, "Airline platforms"),
    ("cloud", "7. Public cloud", 1, 0, 1, "Cloud"),
    ("dc_hardware", "8. Data center & hardware", 1, 0, 1, "DC & hardware"),
    ("network", "9. Network & telecom", 1, 0, 1, "Network"),
    ("end_user", "10. End-user computing & devices", 1, 0, 1, "End-user"),
    ("other", "11. Other IT overhead", 0, 0, 0, "Other"),
]
L1_TO_POOL = {p[1]: p[0] for p in POOLS}
LEVER_POOL_NAME = {p[5]: p[0] for p in POOLS}
VPS = [("vp_commercial", "Commercial Technology", 0), ("vp_operations", "Operations Technology", 0),
       ("vp_corporate", "Corporate Technology", 0), ("vp_infra", "Infrastructure & All Others", 1)]
slug = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")

# ---------------------------------------------------------------- baseline line items
wb = load_workbook(f"{PF}/baseline/AA_IT_Cost_Baseline_v0.1.xlsx", data_only=True)
li = wb["Line_Items"]
rows = [[c.value for c in r] for r in li.iter_rows(min_row=2) if r[0].value]
om = json.load(open(f"{PF}/baseline/org_map_l1_by_vp.json"))
DOMAINS = list(om["domain_to_vp_pct"].keys())
ADDR = {"Locked": "locked", "Partly addressable": "partly", "Addressable": "addressable"}

HOOK_RULES = [  # free-text lever hook in baseline -> lever ids (rule-based, reviewable)
    (r"demand|stage-gate|intake|discretionary|scope rational", ["L01"]),
    (r"consult|advisory", ["L02"]),
    (r"gcc|insource|conversion to fte", ["L03", "L04"]),
    (r"spans|workforce mix|hiring freeze|internal mobility|retention", ["L05"]),
    (r"automation|aiops|ai deflection", ["L06"]),
    (r"tail vendor|panel", ["L07"]),
    (r"rate card", ["L08"]),
    (r"application rational|retire|decommission|module rational", ["L09"]),
    (r"licen|seat|reharvest|bundle|renegotiate|right-size subscription|e5|open-source|consolidate onto|tool", ["L10"]),
    (r"rightsiz|reservation|savings plan|finops|tiering|egress|ephemeral|token|vcore", ["L11"]),
    (r"third-party maint|refresh|life extension|server consolid|virtualization|mainframe|capacity right", ["L12"]),
    (r"pool plans|teams phone|pbx|cdn|sms|ip messaging|re-tender|competitive|lar", ["L13"]),
    (r"device|catalogue|standard|repair|itad|print|vdi|intune", ["L14"]),
    (r"look-to-book|caching|outcome-based|value-based|tier|bu budget", ["L15"]),
    (r"self-audit|invoice|policy", ["L16"]),
]
def hook_levers(h, pool):
    h = (h or "").lower(); out = []
    if h in ("", "none", "follows headcount only", "out of scope", "none in 12 months"): return []
    for pat, ids in HOOK_RULES:
        if re.search(pat, h): out += [i for i in ids if i not in out]
    return out

lines = []
for r in rows:
    pool = L1_TO_POOL.get(r[2])
    if pool is None:  # memo rows: keep with pool 'other' and zero amount, flagged
        pool = "other"
    unit, l2 = (r[10] or ""), (r[3] or "")
    drv = "none"
    if r[2].startswith("1.") and unit == "FTE": drv = "us"
    elif r[2].startswith("2.") and unit == "FTE": drv = "gcc"
    elif r[2].startswith("3.") and unit == "FTE" and ("Long-tail" in l2 or "Staff augmentation" in l2): drv = "ctr"
    amt = (r[13] or 0) / 1e6
    lines.append({"id": r[0].lower().replace("-", "_"), "legacy_id": r[0], "in_scope": 1 if r[1] == "Y" else 0,
                  "memo": 1 if str(r[2]).startswith("M.") else 0, "pool": pool, "l1_label": r[2], "l2": l2, "name": r[4],
                  "vendor": r[5], "nature": r[6], "accounting": r[7], "driver_text": r[8], "qty": r[9], "unit": unit,
                  "unit_cost_usd": r[11], "addr": ADDR.get(r[18], "locked"), "confidence": r[21], "source": r[22],
                  "lever_hook": r[23], "lever_ids": hook_levers(r[23], pool), "notes": r[24], "domain": slug(r[25] or "out_of_scope_memo"),
                  "drv": drv, "_amount": round(amt, 6), "_capex_share": r[14] or 0})

# ---------------------------------------------------------------- lever model inputs
spec = json.load(open(f"{PF}/levers/app_slider_spec.json"))
SPEC = {s["key"]: s for s in spec}
SC_KEYS = ["rates_only", "A", "B", "C", "D"]
SCEN = [("rates", "Rate cuts only", "rates_only"), ("A", "A. Commercial & consumption", "A"), ("B", "B. Operating-model reset", "B"),
        ("C", "C. Balanced (recommended)", "C"), ("D", "D. Full stretch", "D")]
LIBSRC = open(f"{PF}/levers/src/library.py").read()
LIB = eval(LIBSRC[LIBSRC.index("LIB = [") + 6: LIBSRC.index("\n]\n", LIBSRC.index("LIB = [")) + 2])
LEVER_KEY = json.load(open(f"{PF}/levers/org_map_used.json"))["lever_alloc_key"]
def akey(name):
    if name.startswith("Third-party"): return "blend"
    if name == "Apps": return "apps"
    return LEVER_POOL_NAME[name]
LEVERS = []
for t in LIB:
    lid = f"L{t[0]:02d}"
    LEVERS.append({"id": lid, "order": t[0], "label": t[1], "category": t[2], "hypothesis": t[3], "mechanism": t[4],
                   "slider_inputs": t[5], "benchmark": t[6], "one_time_note": t[7], "timing_note": t[8], "risks": t[9],
                   "overlap": t[10], "confidence_label": t[11], "alloc_key": akey(LEVER_KEY[str(t[0])])})

# ---------------------------------------------------------------- corporate inputs
cspec = json.load(open(f"{PF}/corporate/AA_Corporate_Model_v0.1_spec.json"))
CIN = {x["key"]: x for x in cspec["inputs"]}

# ============================================================================ variable registry
VARS, VALUES, SCVAL = [], {}, {s[0]: {} for s in SCEN}
def V(id, label, unit, default, mn=None, mx=None, step=None, group="", layer="", source="assumption", conf="M", note="",
      dims=None, scen=None, legacy=None, typ="number", role="driver", ui="slider", hero=False, seed_only=False, kind=None):
    v = {"id": id, "kind": kind or ("decision" if id.startswith("lev.") else "fact_or_estimate"), "label": label, "unit": unit, "type": typ, "dims": dims or [], "min": mn, "max": mx, "step": step,
         "group": group, "layer": layer, "role": role, "ui": {"control": ui, "hero": hero},
         "source": source, "confidence": conf, "note": note, "scenario_varies": scen is not None, "legacy": legacy}
    if not seed_only: v["aa_default"] = default
    else: v["aa_default"] = "seeded (see seed/aa/variable_values.json)"
    if scen is not None: v["aa_scenario_values"] = scen
    VARS.append(v); VALUES[id] = default
    if scen is not None:
        for sid, val in scen.items(): SCVAL[sid][id] = val

def scen_from(key, f=lambda x: x):
    d = SPEC[key]["defaults"]; return {sid: f(d[k]) for sid, _, k in SCEN}

G, W, B, O, LV, P, C = "Target & governance", "Workforce & rates", "Baseline & pools", "Org map & chargeback", "Levers", "P&L hand-off", "Corporate drivers"
# --- target & governance
V("g.target_mode", "Target expressed as: 1 = $ amount, 2 = % of CY26 base", "enum", 1, 1, 2, 1, G, "target", "spec", "H", "Lets another airline set '10% of base' instead of a dollar figure.", typ="enum", ui="segmented")
V("g.target_net", "Net cut in CY27 IT outlay vs CY26 (CIO target)", "$M", 100, 50, 150, 5, G, "target", "user", "H", "User 2026-11-22: $100M = 4 VPs x $25M (~10% of ~$1B).", legacy=["levers:target", "baseline:Net savings target 2027", "levers:Org_Map total CIO net cut"], hero=True)
V("g.target_pct", "Net cut as % of CY26 base (used if target mode = 2)", "%", 0.10, 0.02, 0.2, 0.005, G, "target", "user", "H", "", legacy=["baseline:Target basis"])
V("g.absorb_growth", "Absorb CY27 cost growth inside the target (1 = yes)", "0/1", 1, 0, 1, 1, G, "target", "user", "H", "User: CY27 spend must be below CY26 after COLA/merit, so the gross bar = target + growth.", legacy=["levers:headw"], typ="bool", ui="toggle")
V("g.head_start", "Head start: months of lever work done before Jan 2027", "months", 1, 0, 3, 1, G, "levers", "levers", "M", "Moves every lever's start month earlier (floor = January).", legacy=["levers:head"], scen=scen_from("head"), typ="int")
V("g.ot_in_year", "Share of one-time costs incurred in CY27 (rest pre-funded in CY26)", "%", 1.0, 0, 1, 0.1, G, "levers", "levers", "M", "Reinterpreted from v0.3 'share expensed in 2027': the non-CY27 share is treated as incurred in CY26, outside both tests.", legacy=["levers:ot_exp"])
V("g.ot_out_share", "Share of CY27 one-time costs funded outside the IT budget", "%", 0.5, 0, 1, 0.05, G, "target", "user", "M", "User: some can be funded outside IT. 50% is an assumption. Still hits AA's P&L.", legacy=["levers:ot_out"], hero=True)
V("g.it_dep_life", "Useful life of IT capex (D&A relief from capex saved)", "years", 5, 2, 10, 1, P, "pnl", "levers", "M", "Merges levers dep_life and corporate it_life (both 5).", legacy=["levers:dep_life", "corporate:it_life"], typ="int")
V("g.da_first_year_factor", "D&A convention in the year capex is saved (0.5 = half-year)", "x", 0.5, 0, 1, 0.5, P, "pnl", "levers", "H", "")
V("g.vp_target_method", "VP target method: 1 = proportional to addressable, 2 = equal, 3 = manual", "enum", 1, 1, 3, 1, O, "vp", "user", "H", "User decision 2026-11-22: proportional.", legacy=["baseline:Org_Map target method", "levers:Org_Map target method"], typ="enum", ui="segmented")
V("g.chargeback_on", "Credit shared-infrastructure savings and growth to consuming VPs (1 = on)", "0/1", 1, 0, 1, 1, O, "vp", "user", "H", "User: shared infra savings credited back to VPs by usage.", legacy=["levers:Org_Map chargeback"], typ="bool", ui="toggle")
V("g.vp_alloc_method", "Lever-to-VP allocation: 1 = one key per lever (v0.3), 2 = by pool effects", "enum", 1, 1, 2, 1, O, "vp", "spec", "M", "Method 2 allocates each pool a lever touches (e.g. GCC cost added by relocation) by that pool's ownership.", typ="enum", ui="segmented")

# --- workforce & rates
V("hc.us", "Internal US IT employees", "FTE", 3000, 2000, 4000, 50, W, "baseline", "user", "H", "User confirmed 2026-11-22.", legacy=["baseline:HC_Internal", "levers:us_fte"], hero=True, typ="int")
V("hc.us_seed", "US headcount at which the baseline lines were sized", "FTE", 3000, None, None, None, W, "baseline", "baseline", "H", "Calibration constant: US labour lines scale by hc.us / hc.us_seed.", role="calibration", ui="hidden", typ="int")
V("hc.gcc", "Offshore captive (India GCC) employees", "FTE", 900, 300, 2500, 25, W, "baseline", "user", "H", "User confirmed ~900 (press May 2026 said ~400).", legacy=["baseline:HC_GCC", "levers:gcc_fte"], hero=True, typ="int")
V("hc.gcc_seed", "GCC headcount at which the baseline lines were sized", "FTE", 900, None, None, None, W, "baseline", "baseline", "H", "", role="calibration", ui="hidden", typ="int")
V("hc.ctr", "Contingent workers (badged contractors)", "FTE", 800, 500, 1100, 25, W, "baseline", "user", "H", "User ~800. Scales long-tail SI and staff-aug lines; preferred SIs held at book.", legacy=["baseline:HC_Contingent"], hero=True, typ="int")
V("hc.ctr_seed", "Contractor headcount at which tail/staff-aug lines were sized", "FTE", 800, None, None, None, W, "baseline", "baseline", "H", "", role="calibration", ui="hidden", typ="int")
V("hc.ctr_on_share", "Share of contractors onshore / onsite", "%", 0.35, 0.1, 0.7, 0.05, W, "levers", "user", "M", "User OK'd 35% onshore.", legacy=["levers:ctr_on_fte (280)", "levers:ctr_off_fte (520)"])
V("rate.ctr_on_hourly", "Onshore contractor blended rate", "$/hr", 101.06, 60, 160, 1, W, "levers", "levers", "M", "= v0.3 $0.19M/FTE at 1,880 hrs.", legacy=["levers:ctr_on_cost"])
V("rate.ctr_off_hourly", "Offshore SI blended rate", "$/hr", 31.38, 18, 50, 0.5, W, "levers", "levers", "M", "= v0.3 $0.059M/FTE at 1,880 hrs.", legacy=["levers:ctr_off_cost"])
V("rate.billable_hours", "Billable hours per contractor FTE-year", "hours", 1880, 1700, 2000, 10, W, "levers", "baseline", "H", "Reconciled: baseline 1,880 (H) vs levers 1,900.", legacy=["baseline:Billable hours per FTE-year"], typ="int")
V("wf.prod_factor", "Offshore/GCC heads needed per onshore head", "x", 1.2, 1.0, 1.5, 0.05, W, "levers", "levers", "M", "Range 1.1-1.3.", legacy=["levers:prod_factor"])
V("wf.us_attrition", "US IT voluntary attrition", "%/yr", 0.09, 0.04, 0.15, 0.005, W, "levers", "levers", "M", "Reconciled: levers 9% kept (drives lever 5); baseline said 8% but did not use it in any formula.", legacy=["levers:attrition", "baseline:Annual voluntary attrition"])
V("wf.change_share", "Share of SI spend that is change/project work", "%", 0.45, 0.2, 0.7, 0.05, W, "levers", "levers", "M", "", legacy=["levers:change_share"])
V("vendor.book", "Preferred SI book of business", "$M", {"dxc": 25, "cognizant": 18, "ibm": 15, "si6": 12, "coforge": 8, "infosys": 5}, 0, 60, 0.5, W, "baseline", "baseline", "M",
  "Reconciled to baseline Vendors tab (system of record). v0.3 levers had IBM 18 / Cognizant 15 / #6 14. DXC and Infosys are user figures.", dims=["vendor"], legacy=["baseline:Vendors", "levers:si_*"])

# --- baseline & pools
V("line.amount", "CY26 normalized outlay per line (opex + cash capex)", "$M", {l["id"]: l["_amount"] for l in lines}, 0, None, None, B, "baseline", "baseline", "M", "415 lines from AA_IT_Cost_Baseline_v0.1 'Counted 2026 outlay'. Converted $ -> $M.", dims=["line"], seed_only=True, ui="table")
V("line.capex_share", "Capex share of the line's outlay", "%", {l["id"]: l["_capex_share"] for l in lines}, 0, 1, 0.01, B, "baseline", "baseline", "M", "", dims=["line"], seed_only=True, ui="table")
V("addr.share", "Share of spend movable within 12 months, by addressability tag", "%", {"locked": 0, "partly": 0.35, "addressable": 0.75}, 0, 1, 0.05, B, "baseline", "baseline", "M", "", dims=["addr_tag"], legacy=["baseline:Addressable share - *"])
GROWTH = {L1_TO_POOL[k]: v for k, v in om["cy27_growth_rate_by_pool"].items()}
V("pool.growth", "CY27 status-quo cost growth by pool", "%/yr", GROWTH, -0.05, 0.2, 0.005, B, "baseline", "baseline", "L", "Advisor estimates (merit, COLA, renewal uplifts, consumption). Weighted ~4.3%.", dims=["pool"], legacy=["baseline:Growth", "levers:g_*"])
V("pool.shared", "Pool is a shared service (chargeback applies)", "0/1", {p[0]: p[4] for p in POOLS}, 0, 1, 1, O, "vp", "levers", "M", "", dims=["pool"], typ="bool", ui="toggle", legacy=["levers:Org_Map shared pools"])
V("pool.swb_flag", "Pool is employee cost (lands in salaries, wages & benefits)", "0/1", {p[0]: p[3] for p in POOLS}, 0, 1, 1, P, "pnl", "spec", "H", "Replaces the corporate model's flat 30% it_swb assumption.", dims=["pool"], typ="bool", ui="toggle")
V("sub.sw_ms_share", "Microsoft share of software spend", "%", round(35 / 157.2, 5), 0, 0.5, 0.01, B, "levers", "levers", "M", "v0.3: $35M of $157.2M.", legacy=["levers:sw_ms"])
V("sub.dc_maint_share", "Hardware maintenance share of DC & hardware opex (rest = colo/facilities)", "%", 0.5, 0, 1, 0.05, B, "levers", "levers", "L", "v0.3: $6M maint + $6M colo.", legacy=["levers:dc_maint", "levers:dc_colo"])
V("portfolio.apps", "Applications in portfolio", "#", 1800, 500, 3000, 50, B, "levers", "user", "M", "Upper bound for lever 9.", typ="int", legacy=["baseline:Applications in portfolio", "levers:apps"])
V("portfolio.app_cost", "Average annual run cost of a retirement-candidate app", "$M", 0.09, 0.02, 0.4, 0.01, B, "levers", "levers", "L", "", legacy=["levers:app_cost"])
V("portfolio.app_lab", "Labour share of app run cost (excluded from lever 9)", "%", 0.35, 0, 0.7, 0.05, B, "levers", "levers", "L", "", legacy=["levers:app_lab"])

# --- org map
V("org.dom_share", "Share of each IT domain owned by each VP", "%",
  {f"{slug(d)},{vp[0]}": om["domain_to_vp_pct"][d][i] for d in DOMAINS for i, vp in enumerate(VPS)}, 0, 1, 0.05, O, "vp", "user", "H",
  "Each domain row must sum to 1 (memo domain to 0). User confirmed Infra owns shared platforms, EUC, telco, cyber; Corporate owns HR/Finance systems; CIO office assumed Infra.", dims=["domain", "vp"], ui="matrix", legacy=["baseline:Org_Map"])
V("org.ss_flag", "VP is the shared-services owner whose shared slice is re-credited", "0/1", {vp[0]: vp[2] for vp in VPS}, 0, 1, 1, O, "vp", "levers", "M", "Exactly one VP should be 1.", dims=["vp"], typ="bool", ui="toggle", legacy=["levers:shared_services_slot"])
V("org.usage_override_on", "Use metered usage keys instead of the default proxy (1 = yes)", "0/1", 0, 0, 1, 1, O, "vp", "levers", "M", "", typ="bool", ui="toggle")
V("org.usage_override", "Metered usage key by VP (used if override on)", "%", {vp[0]: 0.25 for vp in VPS}, 0, 1, 0.01, O, "vp", "assumption", "L", "Should sum to 1.", dims=["vp"])
V("org.manual_target", "Manual VP net target (method 3)", "$M", {vp[0]: 25 for vp in VPS}, 0, 100, 0.5, O, "vp", "user", "H", "Original CIO split: $25M each.", dims=["vp"])

# --- levers (from v0.3 app_slider_spec + constants promoted from formulas)
PARAM = {  # v0.3 key -> (lever, param, typ)
 "l1_cut": ("L01", "cut"), "l1_rel": ("L01", "rel"), "l2_cut": ("L02", "cut"), "l3_pct": ("L03", "pct"), "l3_tc": ("L03", "tc"),
 "l4_pct": ("L04", "pct"), "l4_tc": ("L04", "tc"), "l4_pf": ("L04", "pf"), "l5_nb": ("L05", "nb"), "l5_bf": ("L05", "bf"),
 "l5_sl": ("L05", "sl"), "l5_rel": ("L05", "rel"), "l5_vac": ("L05", "vac"), "l5_sev": ("L05", "sev"), "l6_gain": ("L06", "gain"),
 "l6_cap": ("L06", "cap"), "l6_tool": ("L06", "tool"), "l7_pct": ("L07", "pct"), "l7_diff": ("L07", "diff"), "l8_cov": ("L08", "cov"),
 "l8_cut": ("L08", "cut"), "l8_leak": ("L08", "leak"), "l9_n": ("L09", "n"), "l9_dc": ("L09", "dc"), "l10_shelf": ("L10", "shelf"),
 "l10_ms": ("L10", "ms"), "l10_ren": ("L10", "ren"), "l10_rcut": ("L10", "rcut"), "l11_pct": ("L11", "pct"), "l12_tpm": ("L12", "tpm"),
 "l12_life": ("L12", "life"), "l12_colo": ("L12", "colo"), "l13_pct": ("L13", "pct"), "l14_pct": ("L14", "pct"), "l15_pct": ("L15", "pct"),
 "l16_pct": ("L16", "pct"), "l17_cola": ("L17", "cola"), "l17_sw": ("L17", "sw"), "l17_cl": ("L17", "cl"),
}
CONF = {"L01": "H", "L02": "H", "L03": "M", "L04": "M", "L05": "M", "L06": "L", "L07": "M", "L08": "M", "L09": "L", "L10": "M",
        "L11": "H", "L12": "M", "L13": "M", "L14": "H", "L15": "L", "L16": "H", "L17": "M"}
for k, (lid, prm) in PARAM.items():
    s = SPEC[k]; sc = scen_from(k)
    typ = "int" if s["unit"] in ("#",) else "number"
    V(f"lev.{lid}.{prm}", s["label"], s["unit"], sc["C"], s["min"], s["max"], s["step"], LV, "levers", "levers", CONF[lid], s["note"], scen=sc, legacy=[f"levers:{k}"], typ=typ,
      kind="estimate" if prm in ("tc", "pf", "sev", "tool", "dc", "leak", "ren") else "decision")
PROMOTED = [  # constants that were hard-coded inside v0.3 formulas -> now inputs
 ("L01", "ot_pct", "One-time cost as % of run-rate (PMO, governance)", "%", 0.05, 0, 0.3),
 ("L02", "ot_pct", "One-time cost as % of run-rate", "%", 0.0, 0, 0.3),
 ("L05", "reloc_sev", "Severance per relocated US role, as multiple of loaded cost", "x", 0.5, 0, 1.5),
 ("L05", "hire_cost", "Hiring cost per GCC backfill / relocated role", "$M", 0.01, 0, 0.05),
 ("L06", "setup", "AI enablement one-time cost (if lever active)", "$M", 1.0, 0, 5),
 ("L07", "ot_pct", "One-time cost as % of run-rate (transition, KT)", "%", 0.25, 0, 0.6),
 ("L08", "ot_pct", "One-time cost as % of run-rate (advisors)", "%", 0.05, 0, 0.3),
 ("L09", "split_sw", "Share of app-retirement saving landing in software", "%", 0.5, 0, 1),
 ("L09", "split_cloud", "Share of app-retirement saving landing in cloud (rest DC & hardware)", "%", 0.3, 0, 1),
 ("L10", "ot_pct", "One-time cost as % of run-rate (SAM tool, advisors)", "%", 0.1, 0, 0.3),
 ("L11", "setup", "FinOps one-time cost (if lever active)", "$M", 0.5, 0, 3),
 ("L12", "tpm_saving", "Saving on maintenance moved to third-party (TPM)", "%", 0.4, 0.2, 0.6),
 ("L12", "ot_pct", "One-time cost as % of run-rate", "%", 0.15, 0, 0.5),
 ("L13", "ot_pct", "One-time cost as % of run-rate (SD-WAN migration)", "%", 0.4, 0, 1),
 ("L14", "ot_pct", "One-time cost as % of run-rate", "%", 0.1, 0, 0.5),
 ("L15", "ot_pct", "One-time cost as % of run-rate", "%", 0.0, 0, 0.5),
 ("L16", "ot_pct", "One-time cost as % of run-rate (contingency fee)", "%", 0.25, 0, 0.5),
]
for lid, prm, lab, unit, d, mn, mx in PROMOTED:
    V(f"lev.{lid}.{prm}", lab, unit, d, mn, mx, 0.01 if unit != "$M" else 0.1, LV, "levers", "levers", "L", "Was a constant inside the v0.3 formula; promoted to an input.", legacy=["levers:formula constant"], kind="estimate")
for typ_, key, lab, unit, mn, mx, st in [("s", "start", "Start month in 2027 (1 = Jan)", "month", 1, 12, 1), ("r", "ramp", "Ramp to full run-rate", "months", 1, 12, 1),
                                         ("c", "conf", "Confidence of realisation", "%", 0, 1, 0.05)]:
    sc = {sid: {f"L{n:02d}": SPEC[f"{typ_}{n}"]["defaults"][k] for n in range(1, 18)} for sid, _, k in SCEN}
    V(f"lev.{key}", lab, unit, sc["C"], mn, mx, st, LV, "levers", "levers", "M", "Per lever.", dims=["lever"], scen=sc, legacy=[f"levers:{typ_}1..{typ_}17"], typ="int" if key != "conf" else "number", kind="estimate" if key == "conf" else "decision")
V("lev.realize", "Realisation multiplier on in-year saving (simulation only; 1 = as planned)", "x", {f"L{n:02d}": 1 for n in range(1, 18)}, 0, 1.5, 0.05, LV, "simulation", "spec", "H", "Set by Monte Carlo draws; users normally leave at 1.", dims=["lever"], role="simulation", ui="hidden", kind="simulation")
V("lev.on", "Lever switched on (1) or off (0)", "0/1", {f"L{n:02d}": 1 for n in range(1, 18)}, 0, 1, 1, LV, "levers", "spec", "H", "New: lets solvers and users drop a lever without zeroing its inputs.", dims=["lever"], typ="bool", ui="toggle")

# --- corporate (from corporate spec json)
YR = {"FY2025A": "fy25", "FY2026E": "fy26", "FY2027E": "fy27"}
SKIP = {"it_scen", "it_life"}
LAB = {"pil": "pilots", "fa": "flight_attendants", "mx": "mechanics", "ag": "airport_frontline", "mg": "management"}
labvars = {"hc25": {}, "rate25": {}, "hc_g": {}, "wage_g": {}}
for key, x in CIN.items():
    if key in SKIP: continue
    m = re.match(r"(pil|fa|mx|ag|mg)_(hc25|rate25|hc_g|wage_g)$", key)
    if m:
        g, f = m.groups()
        if f in ("hc25", "rate25"): labvars[f][LAB[g]] = x["defaults"]["FY2025A"]
        else:
            for y, v in x["defaults"].items():
                if v is not None: labvars[f][f"{LAB[g]},{YR[y]}"] = v
        labvars.setdefault("_meta_" + f, x); continue
    vals = {YR[y]: v for y, v in x["defaults"].items() if v is not None}
    src = {"S1": "filing", "S2": "filing", "S3": "filing", "S4": "levers", "S6": "market", "A": "assumption", "C": "calibrated"}.get(x["source"], x["source"])
    if len(vals) == 1:
        V(f"corp.{key}", x["label"], x["unit"], list(vals.values())[0], x["min"], x["max"], x["step"], C, "corporate", src, x["confidence"], x["note"],
          legacy=[f"corporate:{key}"], ui="slider" if x["slider"] else "number", role="calibration" if not x["slider"] else "driver")
    else:
        V(f"corp.{key}", x["label"], x["unit"], vals, x["min"], x["max"], x["step"], C, "corporate", src, x["confidence"], x["note"],
          dims=["iyear"], legacy=[f"corporate:{key}"], ui="slider" if x["slider"] else "number", role="calibration" if x.get("calibration_plug") else "driver")
for f, lab, unit, mn, mx, st in [("hc25", "Headcount FY2025 by labor group", "FTE", None, None, None), ("rate25", "Average pay per FTE FY2025 (before benefits load)", "$k", None, None, None),
                                 ("hc_g", "Headcount growth by labor group", "%", -15, 15, 0.5), ("wage_g", "Pay-rate increase by labor group", "%", -5, 15, 0.5)]:
    meta = labvars["_meta_" + f]
    V(f"corp.lab_{f}", lab, unit, labvars[f], mn, mx, st, C, "corporate", "assumption", "L" if f in ("hc25", "rate25") else "M", "Labor split by group is an analyst estimate.",
      dims=["lgroup"] if f in ("hc25", "rate25") else ["lgroup", "iyear"], legacy=[f"corporate:*_{f}"])
V("corp.it_override", "Use custom IT program values instead of the live lever model (1 = yes)", "0/1", 0, 0, 1, 1, C, "corporate", "spec", "H", "Replaces corporate it_scen = 6 'Custom'. Scenario choice now comes from the active scenario.", typ="bool", ui="toggle", legacy=["corporate:it_scen"])
V("corp.it_swb_mode", "IT labor share of opex savings: 1 = derived from lever pool effects, 0 = manual %", "enum", 1, 0, 1, 1, C, "corporate", "spec", "M", "Only moves savings between P&L lines; EBITDA and EPS unaffected.", typ="enum", ui="segmented")
for k, lab, v in [("cal_ocf25", "FY2025 reported operating cash flow (calibration)", 3099), ("cal_fcf25", "FY2025 reported free cash flow (calibration)", -83),
                  ("cal_cash25", "FY2025 reported year-end cash & ST investments (calibration)", 5836)]:
    V(f"corp.{k}", lab, "$M", v, None, None, None, C, "corporate", "filing", "H", "Solves the FY2025 working-capital / other investing / other financing plugs.", role="calibration", ui="number")

# ============================================================================ formula graph
NODES = []
def N(id, expr=None, dims=None, cases=None, unit="$M", label="", layer="", out=False, members=None):
    n = {"id": id, "dims": dims or [], "unit": unit, "label": label, "layer": layer, "output": out}
    if expr is not None: n["expr"] = expr
    if cases: n["cases"] = [{"when": w, "expr": e} for w, e in cases]
    if members: n["members"] = members
    NODES.append(n)

# ---- 1 baseline
L = "baseline"
N("base.line_scale", "IF(line.drv == 'us', hc.us / hc.us_seed, IF(line.drv == 'gcc', hc.gcc / hc.gcc_seed, IF(line.drv == 'ctr', hc.ctr / hc.ctr_seed, 1)))", ["line"], unit="x", label="Headcount scaling of the line", layer=L)
N("base.line_outlay", "line.amount * base.line_scale", ["line"], label="CY26 outlay of the line", layer=L)
N("base.line_capex", "base.line_outlay * line.capex_share", ["line"], layer=L)
N("base.line_addressable", "base.line_outlay * addr.share[line.addr]", ["line"], layer=L)
N("base.line_growth", "base.line_outlay * pool.growth[line.pool]", ["line"], layer=L)
for k, lab in [("outlay", "CY26 outlay by pool"), ("capex", "CY26 cash capex by pool"), ("addressable", "Addressable spend by pool"), ("growth", "CY27 status-quo growth by pool")]:
    N(f"base.pool_{k}", f"SUM(l in line where l.pool == pool, base.line_{k}[l])", ["pool"], label=lab, layer=L, out=True)
N("base.pool_capex_share", "SAFEDIV(base.pool_capex, base.pool_outlay, 0)", ["pool"], unit="%", layer=L)
N("base.total", "SUM(p in pool, base.pool_outlay[p])", label="CY26 normalized IT outlay", layer=L, out=True)
N("base.capex_total", "SUM(p in pool, base.pool_capex[p])", layer=L, out=True)
N("base.opex_total", "base.total - base.capex_total", layer=L, out=True)
N("base.addressable_total", "SUM(p in pool, base.pool_addressable[p])", layer=L, out=True)
N("base.headwinds", "SUM(p in pool, base.pool_growth[p])", label="CY27 cost growth to absorb", layer=L, out=True)
N("base.locked_total", "SUM(l in line where l.addr == 'locked', base.line_outlay[l])", layer=L, out=True)
N("base.locked_share", "SAFEDIV(base.locked_total, base.total, 0)", unit="%", layer=L, out=True)
N("base.fees_addressable", "SUM(l in line where AND(l.pool == 'airline_platforms', l.addr != 'locked'), base.line_outlay[l])", label="Airline platform spend not locked", layer=L)

# ---- 2 lever-model pools (derived from baseline)
L = "levers"
for k, e, lab, u in [
    ("us_total", "base.pool_outlay['internal_labour']", "US internal labour cost", "$M"),
    ("us_cost", "lv.us_total / hc.us", "US loaded cost per FTE", "$M/FTE"),
    ("gcc_total", "base.pool_outlay['captive_labour']", "Captive (GCC) cost", "$M"),
    ("gcc_cost", "lv.gcc_total / hc.gcc", "GCC loaded cost per FTE", "$M/FTE"),
    ("on0", "hc.ctr * hc.ctr_on_share", "Onshore contractor FTE", "FTE"),
    ("off0", "hc.ctr * (1 - hc.ctr_on_share)", "Offshore contractor FTE", "FTE"),
    ("on_cost", "rate.ctr_on_hourly * rate.billable_hours / 1000000", "Onshore contractor cost per FTE", "$M/FTE"),
    ("off_cost", "rate.ctr_off_hourly * rate.billable_hours / 1000000", "Offshore contractor cost per FTE", "$M/FTE"),
    ("ext", "base.pool_outlay['si_contingent']", "SI & contingent spend", "$M"),
    ("ctr_cost", "lv.on0 * lv.on_cost + lv.off0 * lv.off_cost", "Contingent T&M cost", "$M"),
    ("ms0", "lv.ext - lv.ctr_cost", "Managed / fixed-price SI services", "$M"),
    ("pref", "SUM(v in vendor, vendor.book[v] * v.preferred)", "Preferred SI book", "$M"),
    ("tail", "lv.ext - lv.pref", "Long-tail SI spend", "$M"),
    ("cons", "base.pool_outlay['consulting']", "Consulting", "$M"),
    ("sw", "base.pool_outlay['software']", "Software", "$M"),
    ("sw_ms", "lv.sw * sub.sw_ms_share", "Microsoft software", "$M"),
    ("cloud", "base.pool_outlay['cloud']", "Cloud", "$M"),
    ("dc_capex", "base.pool_capex['dc_hardware']", "Hardware & infrastructure cash capex", "$M"),
    ("dc_opex", "base.pool_outlay['dc_hardware'] - lv.dc_capex", "DC & hardware opex", "$M"),
    ("dc_maint", "lv.dc_opex * sub.dc_maint_share", "Hardware maintenance", "$M"),
    ("dc_colo", "lv.dc_opex - lv.dc_maint", "Colo & facilities", "$M"),
    ("net", "base.pool_outlay['network']", "Network & telecom", "$M"),
    ("euc", "base.pool_outlay['end_user']", "End-user", "$M"),
    ("fees", "base.pool_outlay['airline_platforms']", "Airline platforms", "$M"),
    ("fees_addr", "base.fees_addressable", "Airline platforms not locked", "$M"),
]:
    N(f"lv.{k}", e, unit=u, label=lab, layer=L)

def lp(lid, p): return f"lev.{lid}.{p}"
on = lambda lid: f"lev.on['{lid}']"
# L01
N("lev.L01.f", f"{on('L01')} * (wf.change_share * {lp('L01','cut')} + (1 - wf.change_share) * {lp('L01','rel')})", unit="%", label="Share of SI volume removed", layer=L)
N("lev.L01.rr", "lev.L01.f * (lv.on0 * lv.on_cost + lv.off0 * lv.off_cost + lv.ms0)", layer=L)
N("lev.L01.ot", f"{lp('L01','ot_pct')} * lev.L01.rr", layer=L)
N("lev.L01.on1", "lv.on0 * (1 - lev.L01.f)", unit="FTE", layer=L); N("lev.L01.off1", "lv.off0 * (1 - lev.L01.f)", unit="FTE", layer=L); N("lev.L01.ms1", "lv.ms0 * (1 - lev.L01.f)", layer=L)
# L02
N("lev.L02.rr", f"{on('L02')} * lv.cons * {lp('L02','cut')}", layer=L); N("lev.L02.ot", f"{lp('L02','ot_pct')} * lev.L02.rr", layer=L)
# L03
N("lev.L03.h", f"{on('L03')} * lev.L01.on1 * {lp('L03','pct')}", unit="FTE", label="Onshore roles relocated", layer=L)
N("lev.L03.rr", "lev.L03.h * (lv.on_cost - lv.gcc_cost * wf.prod_factor)", layer=L)
N("lev.L03.ot", f"lev.L03.h * {lp('L03','tc')}", layer=L)
N("lev.L03.on3", "lev.L01.on1 - lev.L03.h", unit="FTE", layer=L); N("lev.L03.gcc_add", "lev.L03.h * wf.prod_factor", unit="FTE", layer=L)
# L04
N("lev.L04.h", f"{on('L04')} * lev.L01.off1 * {lp('L04','pct')}", unit="FTE", layer=L)
N("lev.L04.rr", f"lev.L04.h * (lv.off_cost - lv.gcc_cost * {lp('L04','pf')})", layer=L)
N("lev.L04.ot", f"lev.L04.h * {lp('L04','tc')}", layer=L); N("lev.L04.off4", "lev.L01.off1 - lev.L04.h", unit="FTE", layer=L)
# L05
N("lev.L05.h", f"{on('L05')} * hc.us * wf.us_attrition * {lp('L05','nb')}", unit="FTE", label="US leavers not backfilled onshore", layer=L)
N("lev.L05.r", f"{on('L05')} * hc.us * {lp('L05','rel')}", unit="FTE", label="US roles relocated beyond attrition", layer=L)
N("lev.L05.us_saving", f"(lev.L05.h + lev.L05.r) * lv.us_cost + {on('L05')} * lv.us_total * ({lp('L05','sl')} + {lp('L05','vac')})", layer=L)
N("lev.L05.gcc_added", f"(lev.L05.h * {lp('L05','bf')} + lev.L05.r) * lv.gcc_cost * wf.prod_factor", layer=L)
N("lev.L05.rr", "lev.L05.us_saving - lev.L05.gcc_added", layer=L)
N("lev.L05.ot", f"{on('L05')} * lv.us_total * {lp('L05','sl')} * {lp('L05','sev')} + lev.L05.r * lv.us_cost * {lp('L05','reloc_sev')} + (lev.L05.h * {lp('L05','bf')} + lev.L05.r) * {lp('L05','hire_cost')}", layer=L)
# L06
N("lev.L06.g", f"{on('L06')} * {lp('L06','gain')}", unit="%", layer=L)
N("lev.L06.pool", "lev.L03.on3 * lv.on_cost + lev.L04.off4 * lv.off_cost + lev.L01.ms1", label="Remaining SI + managed pool", layer=L)
N("lev.L06.si_saving", f"lev.L06.pool * lev.L06.g * {lp('L06','cap')}", layer=L)
N("lev.L06.rr", f"lev.L06.si_saving - {on('L06')} * {lp('L06','tool')}", layer=L)
N("lev.L06.ot", f"IF(lev.L06.g > 0, {lp('L06','setup')}, 0)", layer=L)
# L07
N("lev.L07.ext", f"lev.L06.pool * (1 - lev.L06.g * {lp('L06','cap')})", layer=L)
N("lev.L07.rr", f"{on('L07')} * lev.L07.ext * SAFEDIV(lv.tail, lv.ext, 0) * {lp('L07','pct')} * {lp('L07','diff')}", layer=L)
N("lev.L07.ot", f"{lp('L07','ot_pct')} * lev.L07.rr", layer=L)
# L08
N("lev.L08.ext", "lev.L07.ext - lev.L07.rr", layer=L)
N("lev.L08.rr", f"{on('L08')} * lev.L08.ext * {lp('L08','cov')} * {lp('L08','cut')} * (1 - {lp('L08','leak')})", layer=L)
N("lev.L08.ot", f"{lp('L08','ot_pct')} * lev.L08.rr", layer=L)
# L09
N("lev.L09.rr", f"{on('L09')} * {lp('L09','n')} * portfolio.app_cost * (1 - portfolio.app_lab)", layer=L)
N("lev.L09.ot", f"{on('L09')} * {lp('L09','n')} * {lp('L09','dc')}", layer=L)
N("lev.L09.sw9", f"lv.sw - {lp('L09','split_sw')} * lev.L09.rr", layer=L); N("lev.L09.cl9", f"lv.cloud - {lp('L09','split_cloud')} * lev.L09.rr", layer=L)
# L10
N("lev.L10.msp", "SAFEDIV(lv.sw_ms * lev.L09.sw9, lv.sw, 0)", layer=L)
N("lev.L10.rr", f"{on('L10')} * (lev.L09.sw9 * {lp('L10','shelf')} + lev.L10.msp * (1 - {lp('L10','shelf')}) * {lp('L10','ms')} + (lev.L09.sw9 - lev.L10.msp) * (1 - {lp('L10','shelf')}) * {lp('L10','ren')} * {lp('L10','rcut')})", layer=L)
N("lev.L10.ot", f"{lp('L10','ot_pct')} * lev.L10.rr", layer=L)
# L11
N("lev.L11.rr", f"{on('L11')} * lev.L09.cl9 * {lp('L11','pct')}", layer=L)
N("lev.L11.ot", f"IF({on('L11')} * {lp('L11','pct')} > 0, {lp('L11','setup')}, 0)", layer=L)
# L12
N("lev.L12.capex_saving", f"{on('L12')} * lv.dc_capex * {lp('L12','life')}", layer=L)
N("lev.L12.rr", f"{on('L12')} * (lv.dc_maint * {lp('L12','tpm')} * {lp('L12','tpm_saving')} + lv.dc_colo * {lp('L12','colo')}) + lev.L12.capex_saving", layer=L)
N("lev.L12.ot", f"{lp('L12','ot_pct')} * lev.L12.rr", layer=L)
for lid, pool_expr in [("L13", "lv.net"), ("L14", "lv.euc"), ("L15", "lv.fees_addr")]:
    N(f"lev.{lid}.rr", f"{on(lid)} * {pool_expr} * {lp(lid,'pct')}", layer=L); N(f"lev.{lid}.ot", f"{lp(lid,'ot_pct')} * lev.{lid}.rr", layer=L)
# L16
N("lev.L16.pool", f"lev.L08.ext - lev.L08.rr + lv.cons * (1 - lev.on['L02'] * {lp('L02','cut')}) + lev.L09.sw9 - lev.L10.rr + lev.L09.cl9 - lev.L11.rr + lv.dc_maint + lv.dc_colo + lv.net + lv.euc + lv.fees", label="Remaining third-party spend", layer=L)
N("lev.L16.rr", f"{on('L16')} * lev.L16.pool * {lp('L16','pct')}", layer=L); N("lev.L16.ot", f"{lp('L16','ot_pct')} * lev.L16.rr", layer=L)
# L17
N("lev.L17.si_avoid", f"{on('L17')} * lv.ext * pool.growth['si_contingent'] * {lp('L17','cola')}", layer=L)
N("lev.L17.sw_avoid", f"{on('L17')} * lv.sw * pool.growth['software'] * {lp('L17','sw')}", layer=L)
N("lev.L17.cl_avoid", f"{on('L17')} * lv.cloud * pool.growth['cloud'] * {lp('L17','cl')}", layer=L)
N("lev.L17.rr", "lev.L17.si_avoid + lev.L17.sw_avoid + lev.L17.cl_avoid", layer=L); N("lev.L17.ot", "0", layer=L)

IDS = [f"L{n:02d}" for n in range(1, 18)]
N("lev.rr", None, ["lever"], [({"lever": [i]}, f"lev.{i}.rr") for i in IDS], label="Run-rate annual saving", layer=L, out=True)
N("lev.ot", None, ["lever"], [({"lever": [i]}, f"lev.{i}.ot") for i in IDS], label="One-time cost to achieve (before funding split)", layer=L, out=True)
N("lev.eff_start", "MAX(1, lev.start - g.head_start)", ["lever"], unit="month", layer=L)
N("lev.ramp_factor", "IF(13 - lev.eff_start <= lev.ramp, (13 - lev.eff_start) * (14 - lev.eff_start) / (2 * lev.ramp), (lev.ramp + 1) / 2 + (13 - lev.eff_start - lev.ramp)) / 12", ["lever"], unit="%", label="Share of run-rate realised in CY27 (linear ramp)", layer=L)
N("lev.iy", "lev.rr * lev.ramp_factor * lev.realize", ["lever"], label="CY27 in-year saving", layer=L, out=True)
N("lev.iy_risk", "lev.iy * lev.conf", ["lever"], label="Confidence-weighted CY27 saving", layer=L)
# pool effects (run-rate, + = saving on that pool); sum over pools = lev.rr
EFF = {
 "L01": "IF(pool == 'si_contingent', lev.L01.rr, 0)",
 "L02": "IF(pool == 'consulting', lev.L02.rr, 0)",
 "L03": "IF(pool == 'si_contingent', lev.L03.h * lv.on_cost, 0) - IF(pool == 'captive_labour', lev.L03.h * lv.gcc_cost * wf.prod_factor, 0)",
 "L04": "IF(pool == 'si_contingent', lev.L04.h * lv.off_cost, 0) - IF(pool == 'captive_labour', lev.L04.h * lv.gcc_cost * lev.L04.pf, 0)",
 "L05": "IF(pool == 'internal_labour', lev.L05.us_saving, 0) - IF(pool == 'captive_labour', lev.L05.gcc_added, 0)",
 "L06": "IF(pool == 'si_contingent', lev.L06.si_saving, 0) - IF(pool == 'software', lev.on['L06'] * lev.L06.tool, 0)",
 "L07": "IF(pool == 'si_contingent', lev.L07.rr, 0)",
 "L08": "IF(pool == 'si_contingent', lev.L08.rr, 0)",
 "L09": "lev.L09.rr * (IF(pool == 'software', lev.L09.split_sw, 0) + IF(pool == 'cloud', lev.L09.split_cloud, 0) + IF(pool == 'dc_hardware', 1 - lev.L09.split_sw - lev.L09.split_cloud, 0))",
 "L10": "IF(pool == 'software', lev.L10.rr, 0)",
 "L11": "IF(pool == 'cloud', lev.L11.rr, 0)",
 "L12": "IF(pool == 'dc_hardware', lev.L12.rr, 0)",
 "L13": "IF(pool == 'network', lev.L13.rr, 0)",
 "L14": "IF(pool == 'end_user', lev.L14.rr, 0)",
 "L15": "IF(pool == 'airline_platforms', lev.L15.rr, 0)",
 "L16": "lev.on['L16'] * lev.L16.pct * (IF(pool == 'si_contingent', lev.L08.ext - lev.L08.rr, 0) + IF(pool == 'consulting', lv.cons * (1 - lev.on['L02'] * lev.L02.cut), 0) + IF(pool == 'software', lev.L09.sw9 - lev.L10.rr, 0) + IF(pool == 'cloud', lev.L09.cl9 - lev.L11.rr, 0) + IF(pool == 'dc_hardware', lv.dc_maint + lv.dc_colo, 0) + IF(pool == 'network', lv.net, 0) + IF(pool == 'end_user', lv.euc, 0) + IF(pool == 'airline_platforms', lv.fees, 0))",
 "L17": "IF(pool == 'si_contingent', lev.L17.si_avoid, 0) + IF(pool == 'software', lev.L17.sw_avoid, 0) + IF(pool == 'cloud', lev.L17.cl_avoid, 0)",
}
N("lev.eff", None, ["lever", "pool"], [({"lever": [i]}, EFF[i]) for i in IDS], label="Run-rate saving by pool touched", layer=L)
N("lev.rr_check", "lev.rr - SUM(p in pool, lev.eff[lever, p])", ["lever"], label="Check: pool effects sum to run-rate (must be 0)", layer=L)
N("lev.capex_rr", None, ["lever"], [({"lever": ["L12"]}, "lev.L12.capex_saving"), (None, "SUM(p in pool, lev.eff[lever, p] * base.pool_capex_share[p])")], label="Capex part of run-rate saving", layer=L)
N("lev.cx", "SAFEDIV(lev.capex_rr, lev.rr, 0)", ["lever"], unit="%", label="Capex share of lever saving", layer=L)
N("lev.swb_rr", "SUM(p in pool, lev.eff[lever, p] * pool.swb_flag[p] * (1 - base.pool_capex_share[p]))", ["lever"], label="Employee-cost (SWB) opex part of run-rate saving", layer=L)

# ---- results
L = "results"
for k, e, lab in [
    ("tot_rr", "SUM(l in lever, lev.rr[l])", "Run-rate savings (exit CY27)"),
    ("tot_iy", "SUM(l in lever, lev.iy[l])", "CY27 in-year gross savings"),
    ("tot_ot_raw", "SUM(l in lever, lev.ot[l])", "One-time costs, all"),
    ("tot_ot_all", "res.tot_ot_raw * g.ot_in_year", "CY27 one-time costs (AA P&L bears all)"),
    ("tot_ot_it", "res.tot_ot_all * (1 - g.ot_out_share)", "CY27 one-time costs charged to IT"),
    ("tot_ot_out", "res.tot_ot_all - res.tot_ot_it", "CY27 one-time costs funded outside IT"),
    ("net", "res.tot_iy - res.tot_ot_it", "NET CY27 outlay reduction (CIO test)"),
    ("risk_gross", "SUM(l in lever, lev.iy_risk[l])", "Confidence-weighted gross"),
    ("risk", "res.risk_gross - res.tot_ot_it", "Risk-adjusted net"),
    ("target", "IF(g.target_mode == 2, g.target_pct * base.total, g.target_net)", "Net target"),
    ("bar", "res.target + g.absorb_growth * base.headwinds", "Gross bar to clear"),
    ("gap", "res.net - res.bar", "Gap to bar (negative = shortfall)"),
    ("gap_risk", "res.risk - res.bar", "Gap to bar, risk-adjusted"),
    ("coverage", "SAFEDIV(res.net, res.bar, 0)", "Coverage of bar"),
    ("rate_share", "SAFEDIV(lev.iy['L08'], res.net, 0)", "Rate renegotiation share of net"),
    ("cy27_outlay", "base.total + base.headwinds - res.net", "CY27 IT outlay after program"),
    ("cy27_vs_cy26_pct", "SAFEDIV(res.cy27_outlay - base.total, base.total, 0)", "CY27 vs CY26 outlay change"),
    ("fte_us", f"hc.us - lev.L05.h - lev.L05.r - {on('L05')} * hc.us * lev.L05.sl", "End-state US employees"),
    ("fte_on", "lev.L03.on3", "End-state onshore contractors"),
    ("fte_off", "lev.L04.off4", "End-state SI offshore FTE"),
    ("fte_gcc", "hc.gcc + lev.L03.gcc_add + lev.L04.h * lev.L04.pf + (lev.L05.h * lev.L05.bf + lev.L05.r) * wf.prod_factor", "End-state GCC"),
    ("offshore_mix", "SAFEDIV(res.fte_gcc + res.fte_off, res.fte_gcc + res.fte_off + res.fte_us + res.fte_on, 0)", "Offshore share of delivery FTE"),
]:
    N(f"res.{k}", e, unit="%" if k in ("coverage", "rate_share", "offshore_mix", "cy27_vs_cy26_pct") else ("FTE" if k.startswith("fte") else "$M"), label=lab, layer=L, out=True)

# ---- P&L hand-off (replaces pnl_feed.json)
L = "pnl"
for k, e, lab in [
    ("o27", "SUM(l in lever, lev.iy[l] * (1 - lev.cx[l]))", "CY27 opex savings"),
    ("c27", "SUM(l in lever, lev.iy[l] * lev.cx[l])", "CY27 capex savings"),
    ("ot27", "res.tot_ot_all", "CY27 one-time costs (P&L, all funding)"),
    ("ot27_it", "res.tot_ot_it", "of which IT budget"), ("ot27_out", "res.tot_ot_out", "of which outside IT"),
    ("e27", "pnl.o27 - pnl.ot27", "CY27 EBITDA impact"), ("e27x", "pnl.o27", "CY27 EBITDA if one-time = special items"),
    ("d27", "pnl.c27 / g.it_dep_life * g.da_first_year_factor", "CY27 D&A relief"), ("ebit27", "pnl.e27 + pnl.d27", "CY27 EBIT impact"),
    ("cash27", "res.net", "CY27 IT-budget outlay reduction"), ("cash27_co", "pnl.o27 + pnl.c27 - pnl.ot27", "CY27 company cash impact"),
    ("o28", "SUM(l in lever, lev.rr[l] * (1 - lev.cx[l]))", "CY28 opex savings (run-rate)"),
    ("c28", "SUM(l in lever, lev.rr[l] * lev.cx[l])", "CY28 capex savings (run-rate)"),
    ("e28", "pnl.o28", "CY28 EBITDA impact"), ("d28", "(pnl.c27 + g.da_first_year_factor * pnl.c28) / g.it_dep_life", "CY28 D&A relief"),
    ("ebit28", "pnl.e28 + pnl.d28", "CY28 EBIT impact"), ("cash28", "res.tot_rr", "CY28 outlay reduction"),
    ("swb27", "SUM(l in lever, SAFEDIV(lev.iy[l] * lev.swb_rr[l], lev.rr[l], 0))", "CY27 savings landing in SWB"),
    ("swb_share27", "SAFEDIV(pnl.swb27, pnl.o27, 0)", "SWB share of CY27 opex savings"),
]:
    N(f"pnl.{k}", e, unit="%" if k == "swb_share27" else "$M", label=lab, layer=L, out=True)

# ---- VP lens
L = "vp"
N("vp.pool_usd", "SUM(l in line where l.pool == pool, base.line_outlay[l] * org.dom_share[l.domain, vp])", ["vp", "pool"], label="Outlay owned by VP", layer=L)
N("vp.alloc", "SAFEDIV(vp.pool_usd, base.pool_outlay[pool], 0)", ["vp", "pool"], unit="%", label="Share of pool owned by VP", layer=L)
N("vp.outlay", "SUM(p in pool, vp.pool_usd[vp, p])", ["vp"], layer=L, out=True)
N("vp.addressable", "SUM(l in line, base.line_addressable[l] * org.dom_share[l.domain, vp])", ["vp"], layer=L, out=True)
N("vp.ss_alloc", "SUM(u in vp, vp.alloc[u, pool] * org.ss_flag[u])", ["pool"], unit="%", label="Shared-services VP slice of pool", layer=L)
N("vp.nonshared", "SUM(p in pool, vp.alloc[vp, p] * base.pool_outlay[p] * (1 - pool.shared[p]))", ["vp"], label="Non-shared spend owned (usage proxy)", layer=L)
N("vp.usage_default", "SAFEDIV(vp.nonshared, SUM(u in vp, vp.nonshared[u]), 0)", ["vp"], unit="%", layer=L)
N("vp.usage", "IF(org.usage_override_on == 1, org.usage_override, vp.usage_default)", ["vp"], unit="%", label="Usage key", layer=L)
N("vp.eff_alloc", "vp.alloc + g.chargeback_on * pool.shared[pool] * (vp.ss_alloc[pool] * vp.usage - org.ss_flag[vp] * vp.ss_alloc[pool])", ["vp", "pool"], unit="%", label="Effective allocation after chargeback", layer=L)
N("vp.ss_shared_addr", "SUM(u in vp, org.ss_flag[u] * SAFEDIV(vp.addressable[u] * SUM(p in pool, vp.alloc[u, p] * base.pool_outlay[p] * pool.shared[p]), SUM(p in pool, vp.alloc[u, p] * base.pool_outlay[p]), 0))", label="Shared-services addressable spend in shared pools", layer=L)
N("vp.eff_addr", "vp.addressable + g.chargeback_on * vp.ss_shared_addr * (vp.usage - org.ss_flag[vp])", ["vp"], label="Effective addressable (drives targets)", layer=L, out=True)
N("vp.growth", "SUM(p in pool, base.pool_growth[p] * vp.eff_alloc[vp, p])", ["vp"], label="VP's own CY27 cost growth", layer=L, out=True)
N("vp.n_active", "SUM(u in vp, IF(vp.eff_addr[u] > 0, 1, 0))", unit="#", layer=L)
N("vp.target", "IF(g.vp_target_method == 1, SAFEDIV((res.target + SUM(u in vp, vp.growth[u])) * vp.eff_addr, SUM(u in vp, vp.eff_addr[u]), 0) - vp.growth, IF(g.vp_target_method == 2, IF(vp.eff_addr > 0, SAFEDIV(res.target, vp.n_active, 0), 0), org.manual_target))", ["vp"], label="VP net target", layer=L, out=True)
N("vp.bar", "vp.target + g.absorb_growth * vp.growth", ["vp"], label="VP gross bar", layer=L, out=True)
N("vp.key_share", None, ["vp", "akey"], [({"akey": ["apps"]}, "vp.eff_alloc[vp, 'si_contingent']"),
                                        ({"akey": ["blend"]}, "SAFEDIV(SUM(p in pool where p.third_party == 1, vp.eff_alloc[vp, p] * base.pool_outlay[p]), SUM(p in pool where p.third_party == 1, base.pool_outlay[p]), 0)"),
                                        (None, "vp.eff_alloc[vp, akey]")], unit="%", label="VP share by allocation key", layer=L)
N("vp.lever_share", "IF(g.vp_alloc_method == 1, vp.key_share[vp, lever.alloc_key], SAFEDIV(SUM(p in pool, lev.eff[lever, p] * vp.eff_alloc[vp, p]), lev.rr[lever], 0))", ["lever", "vp"], unit="%", label="VP share of lever", layer=L)
N("vp.savings", "SUM(l in lever, lev.iy[l] * vp.lever_share[l, vp])", ["vp"], layer=L, out=True)
N("vp.savings_risk", "SUM(l in lever, lev.iy_risk[l] * vp.lever_share[l, vp])", ["vp"], layer=L)
N("vp.one_time", "SUM(l in lever, lev.ot[l] * vp.lever_share[l, vp]) * g.ot_in_year * (1 - g.ot_out_share)", ["vp"], label="One-time charged to IT", layer=L, out=True)
N("vp.net", "vp.savings - vp.one_time", ["vp"], layer=L, out=True)
N("vp.gap", "vp.net - vp.bar", ["vp"], label="Gap vs VP bar", layer=L, out=True)
N("vp.gap_risk", "vp.savings_risk - vp.one_time - vp.bar", ["vp"], layer=L, out=True)
N("vp.coverage", "SAFEDIV(vp.net, vp.bar, 0)", ["vp"], unit="%", layer=L, out=True)
N("vp.check", "SUM(u in vp, vp.net[u]) - res.net", label="Check: VP nets sum to total (0 unless lever shares leak)", layer=L)

# ---- IT program into the corporate model
L = "it_bridge"
for k, src_, cust in [("opex27", "pnl.o27", "corp.cust_opex"), ("capex27", "pnl.c27", "corp.cust_capex"), ("ot27", "pnl.ot27", "corp.cust_ot"),
                      ("opex28", "pnl.o28", "corp.cust_opex28"), ("capex28", "pnl.c28", "corp.cust_capex28")]:
    N(f"it.{k}_src", f"IF(corp.it_override == 1, {cust}, {src_})", layer=L)
N("it.risk_factor", "IF(AND(corp.it_risk == 1, corp.it_override == 0), SAFEDIV(res.risk_gross, res.tot_iy, 1), 1)", unit="x", layer=L)
for k in ("opex27", "capex27", "opex28", "capex28"):
    N(f"it.{k}", f"it.{k}_src * it.risk_factor * corp.it_on", layer=L)
N("it.ot27", "it.ot27_src * corp.it_on", layer=L)
N("it.da27", "it.capex27 / g.it_dep_life * g.da_first_year_factor", layer=L)
N("it.da28", "it.capex27 / g.it_dep_life + it.capex28 / g.it_dep_life * g.da_first_year_factor", layer=L)
N("it.swb_share", "IF(AND(corp.it_swb_mode == 1, corp.it_override == 0), pnl.swb_share27, corp.it_swb / 100)", unit="%", layer=L)
N("it.swb27", "it.opex27 * it.swb_share", layer=L); N("it.oth27", "it.opex27 - it.swb27", layer=L)
N("it.ot_adj", "IF(corp.it_ot_si == 1, 0, it.ot27)", layer=L); N("it.ot_si", "IF(corp.it_ot_si == 1, it.ot27, 0)", layer=L)

# ---- corporate P&L (dims: year = fy25, fy26, fy27b (base), fy27it (+IT))
L = "corporate"
Y = ["year"]
F25 = {"year": ["fy25"]}
def grow(node, base, g):  # chain: FY25 value, then prev * (1 + g/100)
    return [(F25, base), (None, f"{node}[year.prev] * (1 + {g}[year.in] / 100)")]
CP = [
 ("asm", None, grow("pl.asm", "corp.asm25", "corp.asm_g"), "m", "ASMs"),
 ("gap", "corp.gdp[year.in] - corp.gdp_ref[year.in]", None, "pts", "GDP gap"),
 ("lf", "corp.lf[year.in] + corp.lf_gdp[year.in] * pl.gap", None, "%", "Load factor"),
 ("rpm", "pl.asm * pl.lf / 100", None, "m", "RPMs"),
 ("yield", None, [(F25, "corp.yield25"), (None, "pl.yield[year.prev] * (1 + (corp.yield_g[year.in] + corp.yield_gdp[year.in] * pl.gap) / 100)")], "cents", "Yield"),
 ("rev_pax", "pl.rpm * pl.yield / 100 * (1 - corp.fx_share[year.in] / 100 * corp.usd[year.in] / 100)", None, "$M", "Passenger revenue"),
 ("rev_cargo", None, grow("pl.rev_cargo", "corp.cargo25", "corp.cargo_g"), "$M", "Cargo revenue"),
 ("rev_other", None, grow("pl.rev_other", "corp.other25", "corp.other_g"), "$M", "Other revenue"),
 ("rev", "pl.rev_pax + pl.rev_cargo + pl.rev_other", None, "$M", "Total revenue"),
 ("gpa", None, [(F25, "corp.gpa25"), (None, "pl.gpa[year.prev] * (1 - corp.fuel_eff[year.in] / 100)")], "gal/k ASM", "Fuel burn"),
 ("gal", "pl.asm * pl.gpa / 1000", None, "m gal", "Gallons"),
 ("jet", "IF(corp.fuel_mode[year.in] == 1, (corp.brent[year.in] + corp.crack[year.in]) / 42 + corp.fuel_tax[year.in], corp.jet_direct[year.in])", None, "$/gal", "Jet fuel price"),
 ("fuel", "pl.gal * pl.jet", None, "$M", "Fuel expense"),
 ("wages", "SUM(g in lgroup, pl.lab_cost[year, g])", None, "$M", "Total pay"),
 ("benefits", "pl.wages * corp.ben_load[year.in] / 100", None, "$M", "Benefits"),
 ("it_swb", "0 - year.it * it.swb27", None, "$M", "IT program: labor savings"),
 ("swb_xps", "pl.wages + pl.benefits + pl.it_swb", None, "$M", "SWB before profit sharing"),
 ("ac", None, [(F25, "corp.ac25"), (None, "pl.ac[year.prev] + corp.ac_add[year.in]")], "#", "Mainline aircraft"),
 ("mxr", None, grow("pl.mxr", "corp.mxr25", "corp.mx_infl"), "$M", "Maintenance per aircraft"),
 ("maint", "pl.ac * pl.mxr", None, "$M", "Maintenance"),
 ("dep", None, [(F25, "corp.dep25"), (None, "pl.dep[year.prev] * (1 + corp.asm_g[year.in] / 100) / (1 + corp.gauge_g[year.in] / 100)")], "k", "Departures"),
 ("aptr", None, grow("pl.aptr", "corp.aptr25", "corp.apt_infl"), "$", "Airport cost per departure"),
 ("airport", "pl.dep * pl.aptr / 1000", None, "$M", "Rent & landing fees"),
 ("leaser", None, grow("pl.leaser", "corp.lease_rate25", "corp.lease_g"), "$k/mo", "Lease rate"),
 ("rent", "corp.lease_n[year.in] * pl.leaser * 12 / 1000", None, "$M", "Aircraft rent"),
 ("selling", "pl.rev_pax * corp.sell_pct[year.in] / 100", None, "$M", "Selling"),
 ("regcap", None, [(F25, "1"), (None, "pl.regcap[year.prev] * (1 + corp.reg_cap_g[year.in] / 100)")], "x", "Regional capacity index"),
 ("regional", None, [(F25, "corp.reg25"), (None, "pl.regional[year.prev] * (1 + corp.reg_cap_g[year.in] / 100) * (1 + corp.reg_infl[year.in] / 100)")], "$M", "Regional expenses"),
 ("oth_base", None, [(F25, "corp.oth25"), (None, "pl.oth_base[year.prev] * (1 + corp.oth_vol[year.in] * corp.asm_g[year.in] / 100) * (1 + (corp.cpi[year.in] + corp.oth_prem[year.in]) / 100)")], "$M", "Other opex before IT"),
 ("it_oth", "0 - year.it * it.oth27", None, "$M", "IT program: non-labor savings"),
 ("it_ot", "year.it * it.ot_adj", None, "$M", "IT one-time costs in adjusted results"),
 ("other", "pl.oth_base + pl.it_oth + pl.it_ot", None, "$M", "Other opex"),
 ("dpa", None, grow("pl.dpa", "corp.dpa25", "corp.dpa_g"), "$M", "D&A per owned aircraft"),
 ("da_ac", "(pl.ac - corp.lease_n[year.in]) * pl.dpa", None, "$M", "Aircraft D&A"),
 ("da_oth", None, [(F25, "corp.oda25"), (None, "pl.da_oth[year.prev] * (1 + corp.oda_g[year.in] / 100) - year.it * it.da27")], "$M", "Non-aircraft D&A"),
 ("da", "pl.da_ac + pl.da_oth", None, "$M", "D&A mainline"),
 ("reg_da", "corp.reg_da25 * pl.regcap", None, "$M", "Regional D&A"),
 ("opex_xps", "pl.fuel + pl.swb_xps + pl.regional + pl.reg_da + pl.maint + pl.airport + pl.rent + pl.selling + pl.da + pl.other", None, "$M", "Opex before profit sharing"),
 ("debt_close", None, [(F25, "corp.debt_open + corp.debt_chg['fy25']"), (None, "pl.debt_close[year.prev] + corp.debt_chg[year.in]")], "$M", "Debt year-end"),
 ("debt_avg", None, [(F25, "corp.debt_open + corp.debt_chg['fy25'] / 2"), (None, "pl.debt_close[year.prev] + corp.debt_chg[year.in] / 2")], "$M", "Average debt"),
 ("rate", "corp.fix_share[year.in] / 100 * corp.fix_rate[year.in] + (1 - corp.fix_share[year.in] / 100) * (corp.sofr[year.in] + corp.flt_spread[year.in])", None, "%", "Blended rate"),
 ("int_exp", "pl.debt_avg * pl.rate / 100", None, "$M", "Interest expense"),
 ("cash_open", None, [(F25, "corp.cash_open"), (None, "pl.cash_close[year.prev]")], "$M", "Opening cash"),
 ("int_inc", "pl.cash_open * (corp.sofr[year.in] + corp.cash_spread[year.in]) / 100", None, "$M", "Interest income"),
 ("oth_inc", "corp.oth_inc[year.in]", None, "$M", "Other nonoperating"),
 ("pretax_pps", "pl.rev - pl.opex_xps - pl.int_exp + pl.int_inc + pl.oth_inc", None, "$M", "Pre-tax before profit sharing"),
 ("ps", "MAX(0, pl.pretax_pps) * corp.ps_rate[year.in] / 100", None, "$M", "Profit sharing"),
 ("swb", "pl.swb_xps + pl.ps", None, "$M", "SWB"),
 ("opex", "pl.opex_xps + pl.ps", None, "$M", "Opex ex special items"),
 ("ebit", "pl.rev - pl.opex", None, "$M", "Adjusted EBIT"),
 ("op_margin", "pl.ebit / pl.rev * 100", None, "%", "Adjusted operating margin"),
 ("ebitda", "pl.ebit + pl.da + pl.reg_da", None, "$M", "Adjusted EBITDA"),
 ("ebitdar", "pl.ebitda + pl.rent", None, "$M", "Adjusted EBITDAR"),
 ("casm_x", "(pl.opex - pl.fuel) / pl.asm * 100", None, "cents", "CASM ex fuel"),
 ("pretax", "pl.pretax_pps - pl.ps", None, "$M", "Adjusted pre-tax"),
 ("taxx", "pl.pretax * corp.tax[year.in] / 100", None, "$M", "Tax"),
 ("ni", "pl.pretax - pl.taxx", None, "$M", "Adjusted net income"),
 ("sh", "corp.shares[year.in] - corp.buyback[year.in] / corp.price_now", None, "m", "Diluted shares"),
 ("eps", "pl.ni / pl.sh", None, "$", "Adjusted EPS"),
 ("si", "corp.si[year.in] + year.it * it.ot_si", None, "$M", "Special items"),
 ("ni_gaap", "pl.ni - pl.si * (1 - corp.tax[year.in] / 100)", None, "$M", "GAAP net income"),
 ("eps_gaap", "pl.ni_gaap / pl.sh", None, "$", "GAAP EPS"),
 ("cf_int", "0 - pl.int_exp + pl.int_inc + pl.oth_inc", None, "$M", "Net interest (cash)"),
 ("cf_tax", "0 - MAX(0, pl.pretax) * corp.cash_tax[year.in] / 100", None, "$M", "Cash taxes"),
 ("cf_si", "0 - pl.si", None, "$M", "Special items paid"),
 ("cf_wc", None, [(F25, "corp.cal_ocf25 - (pl.ebitda + pl.cf_int + pl.cf_tax + pl.cf_si)"), (None, "corp.wc[year.in]")], "$M", "Working capital & other"),
 ("ocf", "pl.ebitda + pl.cf_int + pl.cf_tax + pl.cf_si + pl.cf_wc", None, "$M", "Operating cash flow"),
 ("cf_capex", "0 - corp.capex[year.in] + year.it * it.capex27", None, "$M", "Capex"),
 ("cf_slb", "corp.slb[year.in]", None, "$M", "Sale-leaseback"),
 ("cf_oi", None, [(F25, "corp.cal_fcf25 - (pl.ocf + pl.cf_capex + pl.cf_slb)"), (None, "corp.oth_inv[year.in]")], "$M", "Other investing"),
 ("fcf", "pl.ocf + pl.cf_capex + pl.cf_slb + pl.cf_oi", None, "$M", "Free cash flow"),
 ("cf_of", None, [(F25, "corp.cal_cash25 - (pl.cash_open + pl.fcf + corp.debt_chg['fy25'] - corp.buyback['fy25'])"), (None, "corp.oth_fin[year.in]")], "$M", "Other financing"),
 ("cash_close", "pl.cash_open + pl.fcf + corp.debt_chg[year.in] - corp.buyback[year.in] + pl.cf_of", None, "$M", "Cash year-end"),
 ("total_debt", "pl.debt_close + corp.oplease[year.in] + corp.pension[year.in]", None, "$M", "Total debt (AA definition)"),
 ("net_debt", "pl.total_debt - pl.cash_close", None, "$M", "Net debt"),
 ("lev", "pl.net_debt / pl.ebitdar", None, "x", "Leverage"),
]
for k, e, cases, u, lab in CP:
    N(f"pl.{k}", e, Y, cases, unit=u, label=lab, layer=L, out=k in ("rev", "ebitda", "ebitdar", "ebit", "ni", "eps", "fcf", "net_debt", "op_margin", "eps_gaap", "lev"))
N("pl.lab_hc", None, ["year", "lgroup"], [(F25, "corp.lab_hc25[lgroup]"), (None, "pl.lab_hc[year.prev, lgroup] * (1 + corp.lab_hc_g[lgroup, year.in] / 100)")], unit="FTE", layer=L)
N("pl.lab_rate", None, ["year", "lgroup"], [(F25, "corp.lab_rate25[lgroup]"), (None, "pl.lab_rate[year.prev, lgroup] * (1 + corp.lab_wage_g[lgroup, year.in] / 100)")], unit="$k", layer=L)
N("pl.lab_cost", "pl.lab_hc * pl.lab_rate / 1000", ["year", "lgroup"], layer=L)
# valuation (FY2027 cases only)
VM = {"year": ["fy27b", "fy27it"]}
L = "valuation"
N("val.pe_valid", "AND(pl.eps['fy27b'] > 0, pl.eps['fy27it'] > 0)", unit="0/1", layer=L)
N("val.ev", "pl.ebitdar * corp.ev_mult", Y, members=VM, layer=L)
N("val.eqv", "val.ev - pl.net_debt", Y, members=VM, layer=L)
N("val.px_ev", "val.eqv / pl.sh", Y, members=VM, unit="$", layer=L)
N("val.px_pe", "pl.eps * corp.pe", Y, members=VM, unit="$", layer=L)
N("val.px", "IF(val.pe_valid, corp.w_pe / 100 * val.px_pe + (1 - corp.w_pe / 100) * val.px_ev, val.px_ev)", Y, members=VM, unit="$", label="Implied share price", layer=L, out=True)
N("val.px_vs", "(val.px / corp.price_now - 1) * 100", Y, members=VM, unit="%", layer=L, out=True)
N("val.mcap", "val.px * pl.sh", Y, members=VM, layer=L, out=True)
# bridge (pure IT effect, all else equal)
L = "bridge"
for k in ("ebitda", "ebit", "pretax", "ni", "eps", "eps_gaap", "fcf", "net_debt", "ps"):
    N(f"br.{k}27", f"pl.{k}['fy27it'] - pl.{k}['fy27b']", unit="$" if "eps" in k else "$M", label=f"IT effect on {k}, CY27", layer=L, out=True)
N("br.px27", "val.px['fy27it'] - val.px['fy27b']", unit="$", label="IT effect on share price, CY27", layer=L, out=True)
N("br.mcap27", "br.px27 * pl.sh['fy27it']", label="IT effect on equity value, CY27", layer=L, out=True)
N("br.eps_pct27", "SAFEDIV(br.eps27, pl.eps['fy27b'], 0) * 100", unit="%", layer=L, out=True)
N("br.int28", "(br.fcf27 + 0.5 * (it.opex28 + it.capex28)) * (corp.sofr['fy27'] + corp.cash_spread['fy27']) / 100", layer=L)
N("br.pps28", "it.opex28 + it.da28 + br.int28", layer=L)
N("br.ps28", "0 - br.pps28 * corp.ps_rate['fy27'] / 100", layer=L)
N("br.ebitda28", "it.opex28 + br.ps28", label="IT effect on EBITDA, CY28 run-rate", layer=L, out=True)
N("br.pretax28", "br.ebitda28 + it.da28 + br.int28", layer=L)
N("br.ni28", "br.pretax28 * (1 - corp.tax['fy27'] / 100)", layer=L, out=True)
N("br.eps28", "br.ni28 / pl.sh['fy27it']", unit="$", label="IT effect on EPS, CY28 run-rate", layer=L, out=True)
N("br.fcf28", "br.ebitda28 + br.int28 - MAX(0, br.pretax28) * corp.cash_tax['fy27'] / 100 + it.capex28", layer=L)
N("br.px28", "corp.w_pe / 100 * br.eps28 * corp.pe + (1 - corp.w_pe / 100) * (br.ebitda28 * corp.ev_mult + br.fcf27 + br.fcf28) / pl.sh['fy27it']", unit="$", label="IT effect on share price, CY28 run-rate", layer=L, out=True)
N("br.fuel_equiv_cents", "br.ebitda27 / pl.gal['fy27b'] * 100", unit="c/gal", label="Jet fuel change with the same EBITDA effect", layer=L, out=True)

_dup = {n["id"] for n in NODES} & {v["id"] for v in VARS}
assert not _dup, f"node/variable id collision: {_dup}"
assert len({n["id"] for n in NODES}) == len(NODES), "duplicate node id"
# ============================================================================ write
DIMS = [
 {"id": "pool", "label": "Cost pool (canonical L1)", "scope": "global", "attributes": ["label", "tenant_label", "third_party", "order"]},
 {"id": "line", "label": "Baseline cost line", "scope": "tenant", "attributes": ["pool", "domain", "addr", "drv", "l2", "name", "vendor", "nature", "accounting", "lever_ids", "in_scope", "memo", "confidence", "source", "legacy_id"]},
 {"id": "domain", "label": "IT domain (drives VP ownership)", "scope": "tenant", "attributes": ["label", "description"]},
 {"id": "vp", "label": "Org unit (VP)", "scope": "tenant", "attributes": ["label"]},
 {"id": "lever", "label": "Savings lever (library)", "scope": "global+tenant", "attributes": ["label", "order", "alloc_key", "category"]},
 {"id": "akey", "label": "Lever allocation key (pools + apps + blend)", "scope": "system", "attributes": ["label"]},
 {"id": "vendor", "label": "Vendor (preferred SI panel)", "scope": "tenant", "attributes": ["label", "preferred", "role"]},
 {"id": "addr_tag", "label": "Addressability tag", "scope": "global", "attributes": ["label"]},
 {"id": "year", "label": "Corporate model column", "scope": "system", "attributes": ["label", "in", "prev", "it"]},
 {"id": "iyear", "label": "Corporate input year", "scope": "system", "attributes": ["label"]},
 {"id": "lgroup", "label": "Airline labor group", "scope": "tenant", "attributes": ["label"]},
]
dm = {
 "pool": [{"id": p[0], "label": p[5], "tenant_label": p[1], "third_party": p[2], "order": i + 1} for i, p in enumerate(POOLS)],
 "line": [{k: v for k, v in l.items() if not k.startswith("_")} for l in lines],
 "domain": [{"id": slug(d), "label": d, "description": ""} for d in DOMAINS],
 "vp": [{"id": v[0], "label": v[1]} for v in VPS],
 "lever": [{k: l[k] for k in ("id", "label", "order", "alloc_key", "category")} for l in LEVERS],
 "akey": [{"id": p[0], "label": p[5]} for p in POOLS] + [{"id": "apps", "label": "Apps (SI split proxy)"}, {"id": "blend", "label": "Third-party blend"}],
 "vendor": [{"id": "dxc", "label": "DXC Technology", "preferred": 1, "role": "Infrastructure & legacy managed services"},
            {"id": "cognizant", "label": "Cognizant", "preferred": 1, "role": "App development & maintenance"},
            {"id": "ibm", "label": "IBM", "preferred": 1, "role": "Hosting, middleware, consulting"},
            {"id": "si6", "label": "Preferred SI #6 (TBC)", "preferred": 1, "role": "App services"},
            {"id": "coforge", "label": "Coforge", "preferred": 1, "role": "Airline / travel domain apps"},
            {"id": "infosys", "label": "Infosys", "preferred": 1, "role": "App development & testing"}],
 "addr_tag": [{"id": "locked", "label": "Locked"}, {"id": "partly", "label": "Partly addressable"}, {"id": "addressable", "label": "Addressable"}],
 "year": [{"id": "fy25", "label": "FY2025A", "in": "fy25", "prev": "", "it": 0}, {"id": "fy26", "label": "FY2026E", "in": "fy26", "prev": "fy25", "it": 0},
          {"id": "fy27b", "label": "FY2027E base", "in": "fy27", "prev": "fy26", "it": 0}, {"id": "fy27it", "label": "FY2027E + IT", "in": "fy27", "prev": "fy26", "it": 1}],
 "iyear": [{"id": "fy25", "label": "FY2025A"}, {"id": "fy26", "label": "FY2026E"}, {"id": "fy27", "label": "FY2027E"}],
 "lgroup": [{"id": v, "label": k} for k, v in [("Pilots (APA)", "pilots"), ("Flight attendants (APFA)", "flight_attendants"), ("Mechanics & fleet service (TWU-IAM)", "mechanics"),
                                               ("Airport, reservations & other frontline", "airport_frontline"), ("Management, support & corporate (incl. IT staff)", "management")]],
}
graph = {"spec_version": "1.0.0", "model_id": "it_savings_unified", "units": "USD millions unless stated; + = saving",
         "expression_language": "see 03_formula_graph.md section 2", "dimensions": DIMS,
         "layers": ["baseline", "levers", "results", "pnl", "vp", "it_bridge", "corporate", "valuation", "bridge"], "nodes": NODES}
json.dump(graph, open(os.path.join(OUT, "formula_graph.json"), "w"), indent=1)
json.dump({"spec_version": "1.0.0", "count": len(VARS), "variables": VARS}, open(os.path.join(OUT, "variables.json"), "w"), indent=1)
json.dump(dm, open(os.path.join(OUT, "seed", "aa", "dimension_members.json"), "w"), indent=1)
json.dump(VALUES, open(os.path.join(OUT, "seed", "aa", "variable_values.json"), "w"), indent=1)
json.dump({"tenant": "aa", "default_scenario": "C", "scenarios": [{"id": sid, "label": lab, "values": SCVAL[sid]} for sid, lab, _ in SCEN]},
          open(os.path.join(OUT, "seed", "aa", "scenarios.json"), "w"), indent=1)
json.dump({"levers": LEVERS}, open(os.path.join(OUT, "seed", "aa", "lever_library.json"), "w"), indent=1)
json.dump({"id": "aa", "name": "American Airlines", "currency": "USD", "base_year": 2026, "target_year": 2027, "fiscal_calendar": "calendar",
           "market_data_as_of": "2026-11-22", "ticker": "AAL", "demo_date": "2026-12-04"}, open(os.path.join(OUT, "seed", "aa", "tenant.json"), "w"), indent=1)
print("vars", len(VARS), "nodes", len(NODES), "lines", len(lines))
