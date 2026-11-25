"""Builds the five seed files of the synthetic tenant `zz` (QA-02).

    python3 build.py <reference-seed-dir> <output-dir>

`zz` is a fictional airline: invented name, a made-up code, no real airline, vendor or mark, no real
filing. Global dimensions (pools, levers, allocation keys, addressability tags, years) and the
lever-input defaults come from the reference tenant seed given on the command line, because those are
the global model's. Everything tenant-specific is generated here with a fixed seed, so the output is
deterministic: five VPs, thirteen domains, a four-group workforce, five vendors and an outside-in
baseline with lines in all eleven pools.

The JSON files are the artefact; edit them directly if needed and keep `seed.test.ts` green.
"""
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

REF = Path(sys.argv[1])
OUT = Path(sys.argv[2])
rng = random.Random(20261123)
ref = lambda f: json.load(open(REF / f))
ref_members, ref_values, ref_scen, ref_lib = (
    ref("dimension_members.json"),
    ref("variable_values.json"),
    ref("scenarios.json"),
    ref("lever_library.json"),
)


def jitter(x, spread=0.08):
    return x * (1 + rng.uniform(-spread, spread))


# --------------------------------------------------------------------------- tenant dimensions
POOLS = ref_members["pool"]
TENANT_L1 = {
    "internal_labour": "A. Own workforce - home region",
    "captive_labour": "B. Own workforce - offshore centre",
    "si_contingent": "C. Contractors & service providers",
    "consulting": "D. Advisory services",
    "software": "E. Licences & subscriptions",
    "airline_platforms": "F. Core airline platforms",
    "cloud": "G. Cloud consumption",
    "dc_hardware": "H. Hosting & hardware",
    "network": "I. Connectivity",
    "end_user": "J. Workplace technology",
    "other": "K. Other IT costs",
}
pool_members = [{**p, "tenant_label": TENANT_L1[p["id"]]} for p in POOLS]

DOMAINS = [
    ("customer_digital", "Customer & digital"),
    ("revenue_and_loyalty", "Revenue & loyalty"),
    ("flight_operations", "Flight operations"),
    ("crew_and_maintenance", "Crew & maintenance"),
    ("airport_and_cargo", "Airport & cargo"),
    ("finance_people_systems", "Finance & people systems"),
    ("data_and_ai", "Data & AI"),
    ("security_and_risk", "Security & risk"),
    ("cloud_and_hosting", "Cloud & hosting"),
    ("network_and_workplace", "Network & workplace"),
    ("it_management_office", "IT management office"),
    ("shared_delivery_overhead", "Shared delivery overhead"),
    ("out_of_scope_memo", "Out of scope (memo)"),
]
domain_members = [{"id": i, "label": l, "description": ""} for i, l in DOMAINS]

VPS = [
    ("vp_digital", "Digital & Customer Technology"),
    ("vp_flightops", "Flight & Airport Operations Technology"),
    ("vp_enterprise", "Enterprise Systems Technology"),
    ("vp_data", "Data, Security & Risk"),
    ("vp_platform", "Cloud, Network & Workplace Platforms"),
]
vp_members = [{"id": i, "label": l} for i, l in VPS]
VP_IDS = [i for i, _ in VPS]

# domain ownership: each row sums to 1 over the five VPs; the memo domain sums to 0
D, F, E, A, P = VP_IDS
DOM_SHARE = {
    "customer_digital": {D: 1},
    "revenue_and_loyalty": {D: 1},
    "flight_operations": {F: 1},
    "crew_and_maintenance": {F: 1},
    "airport_and_cargo": {F: 0.7, D: 0.3},
    "finance_people_systems": {E: 1},
    "data_and_ai": {D: 0.3, F: 0.2, E: 0.2, A: 0.3},
    "security_and_risk": {A: 1},
    "cloud_and_hosting": {P: 1},
    "network_and_workplace": {P: 1},
    "it_management_office": {E: 0.4, P: 0.6},
    "shared_delivery_overhead": {D: 0.25, F: 0.25, E: 0.2, A: 0.1, P: 0.2},
    "out_of_scope_memo": {},
}

VENDORS = [
    # id, label, preferred, role, book ($M, set from the lines below)
    ("sp_alpha", "Test Service Provider Alpha", 1, "Application development & maintenance"),
    ("sp_bravo", "Test Service Provider Bravo", 1, "Infrastructure & hosting services"),
    ("sp_charlie", "Test Service Provider Charlie", 1, "Testing & quality engineering"),
    ("sp_delta", "Test Service Provider Delta", 1, "Data & analytics services"),
    ("sp_echo", "Test Service Provider Echo", 0, "Niche airline-domain services (not on the panel)"),
]

LGROUPS = [
    ("flight_deck", "Flight deck crew"),
    ("cabin_crew", "Cabin crew"),
    ("technical_operations", "Technical operations & line maintenance"),
    ("ground_operations", "Ground, airport & customer service"),
]
lgroup_members = [{"id": i, "label": l} for i, l in LGROUPS]

# --------------------------------------------------------------------------- baseline lines
lines = []  # dicts without id
HC = {"us": 2200, "gcc": 380, "ctr": 640}

PREFERRED_LEVERS = ["L03", "L04", "L08"]
LEVER_OF = {
    "internal_labour": (["L05"], "Workforce mix / spans & layers"),
    "captive_labour": ([], "Follows headcount only"),
    "si_contingent": (["L01", "L07", "L08"], "Demand management / panel consolidation / rate card"),
    "consulting": (["L02"], "Approval gate and demand management"),
    "software": (["L10"], "Licence right-sizing / renewal tension"),
    "airline_platforms": (["L15"], "Volume tiers at renewal only"),
    "cloud": (["L11"], "Rightsizing / commitments"),
    "dc_hardware": (["L12"], "Consolidation / extended refresh"),
    "network": (["L13"], "Competitive re-tender"),
    "end_user": (["L14"], "Extended refresh cycle"),
    "other": ([], "None"),
}


def add(pool, l2, name, vendor, qty, unit, unit_cost, addr, domain, *, drv="none", capex=0.0,
        nature=None, accounting="Opex", driver_text="", conf="L", source="outside-in estimate",
        levers=None, hook=None, vendor_key=None, memo=0, notes=None):
    lv, h = LEVER_OF[pool]
    nature = nature or {
        "internal_labour": "Labor", "captive_labour": "Labor", "si_contingent": "Labor",
        "consulting": "Services", "software": "Software", "airline_platforms": "Airline platform",
        "cloud": "Compute", "dc_hardware": "Hardware", "network": "Network", "end_user": "Hardware",
        "other": "Other",
    }[pool]
    row = {
        "pool": pool, "l1_label": TENANT_L1[pool], "l2": l2, "name": name, "vendor": vendor,
        "nature": nature, "accounting": accounting, "driver_text": driver_text,
        "qty": qty, "unit": unit, "unit_cost_usd": round(unit_cost, 2), "addr": addr,
        "confidence": conf, "source": source, "lever_hook": hook or h,
        "lever_ids": lv if levers is None else levers, "notes": notes, "domain": domain, "drv": drv,
        "in_scope": 0 if memo else 1, "memo": memo, "_capex": capex,
    }
    if vendor_key:
        row["vendor_key"] = vendor_key
    lines.append(row)


# --- own workforce, home region: FTE-driven (3 lines per function)
US_FUNCS = [
    ("Digital & customer engineering", 380, "customer_digital", 0.3, 128000),
    ("Revenue & loyalty engineering", 190, "revenue_and_loyalty", 0.3, 126000),
    ("Flight & crew systems engineering", 260, "flight_operations", 0.3, 121000),
    ("Maintenance & airport systems engineering", 200, "crew_and_maintenance", 0.3, 112000),
    ("Finance & people systems", 170, "finance_people_systems", 0.0, 117000),
    ("Data & analytics", 260, "data_and_ai", 0.3, 133000),
    ("Security & risk", 150, "security_and_risk", 0.0, 139000),
    ("Cloud & infrastructure engineering", 310, "cloud_and_hosting", 0.0, 124000),
    ("Network & workplace operations", 190, "network_and_workplace", 0.0, 99000),
    ("IT leadership & programme office", 90, "it_management_office", 0.0, 152000),
]
assert sum(f[1] for f in US_FUNCS) == HC["us"]
for fn, fte, dom, cx, base in US_FUNCS:
    base = round(jitter(base, 0.03), -2)
    kw = dict(drv="us", conf="M", domain=dom)
    add("internal_labour", "Base salaries", f"Base salaries - {fn}", "Own employees", fte, "FTE", base,
        "partly", capex=cx, accounting="Opex / capitalizable", driver_text="Headcount x avg base salary",
        source="headcount x regional wage benchmark", **kw)
    add("internal_labour", "Benefits & payroll taxes", f"Benefits & payroll tax - {fn}", "Own employees", fte,
        "FTE", round(base * 0.22, -1), "locked", driver_text="Headcount x base x burden %",
        source="burden benchmark", hook="Follows headcount only", levers=[], **kw)
    add("internal_labour", "Variable pay", f"Variable pay - {fn}", "Own employees", fte, "FTE",
        round(base * 0.045, -1), "locked", driver_text="Headcount x base x variable %",
        source="outside-in estimate", hook="Follows headcount only", levers=[], **{**kw, "conf": "L"})
for nm, amt, dom, addr in [
    ("Training & certification", 2.1, "it_management_office", "addressable"),
    ("Recruiting & relocation", 1.4, "it_management_office", "addressable"),
    ("Staff travel & events", 1.1, "shared_delivery_overhead", "addressable"),
]:
    add("internal_labour", "Other people costs", nm, "Various", 1, "annual", amt * 1e6, addr, dom,
        driver_text="Annual budget", levers=[], hook="Policy / discretionary spend")

# --- own workforce, offshore centre
GCC_FUNCS = [
    ("Application engineering", 140, "shared_delivery_overhead", 37500),
    ("Testing & quality engineering", 70, "shared_delivery_overhead", 33500),
    ("Data operations", 60, "data_and_ai", 36500),
    ("Infrastructure operations", 70, "cloud_and_hosting", 35000),
    ("Service desk", 40, "network_and_workplace", 27000),
]
assert sum(f[1] for f in GCC_FUNCS) == HC["gcc"]
for fn, fte, dom, cost in GCC_FUNCS:
    cost = round(jitter(cost, 0.03), -2)
    add("captive_labour", "Offshore centre compensation", f"Offshore compensation - {fn}", "Own employees",
        fte, "FTE", cost, "partly", dom, drv="gcc", capex=0.3, accounting="Opex / capitalizable",
        driver_text="Headcount x avg cost", conf="M", source="headcount x offshore wage benchmark")
    add("captive_labour", "Offshore centre statutory & benefits", f"Offshore statutory & benefits - {fn}",
        "Own employees", fte, "FTE", round(cost * 0.18, -1), "locked", dom, drv="gcc",
        driver_text="Headcount x comp x burden %", source="burden benchmark", hook="Follows headcount only")
for nm, amt, addr in [("Offshore facility & utilities", 1.6, "partly"), ("Offshore tools & equipment", 0.9, "addressable"),
                      ("Offshore transition & travel", 0.7, "addressable")]:
    add("captive_labour", "Offshore centre overheads", nm, "Various", 1, "annual", amt * 1e6, addr,
        "shared_delivery_overhead", driver_text="Annual budget", hook="Follows headcount only", levers=[])

# --- contractors & service providers
VENDOR_LINES = {
    "sp_alpha": [("Application development - customer & revenue", 120, 82000, "customer_digital"),
                 ("Application maintenance - flight & airport systems", 100, 76000, "flight_operations")],
    "sp_bravo": [("Hosting & managed infrastructure operations", 80, 93000, "cloud_and_hosting"),
                 ("Service desk & workplace operations", 70, 52000, "network_and_workplace")],
    "sp_charlie": [("Test automation & quality engineering", 110, 68000, "shared_delivery_overhead"),
                   ("Release management & DevOps support", 50, 91000, "shared_delivery_overhead")],
    "sp_delta": [("Data platform engineering", 45, 98000, "data_and_ai"),
                 ("Reporting & analytics delivery", 40, 71000, "data_and_ai")],
    "sp_echo": [("Crew-planning domain services", 22, 118000, "crew_and_maintenance"),
                ("Airport systems domain services", 24, 104000, "airport_and_cargo")],
}
for vid, label, pref, _ in VENDORS:
    for nm, fte, rate, dom in VENDOR_LINES[vid]:
        add("si_contingent", "Preferred SIs (T&M / managed capacity)" if pref else "Long-tail SIs & boutiques",
            f"{label} - {nm}", label, fte, "FTE", round(jitter(rate, 0.03), -2), "addressable", dom,
            capex=0.3, accounting="Opex / capitalizable", driver_text="FTE x blended annual rate", conf="M",
            source="vendor book of business; rate card", levers=PREFERRED_LEVERS if pref else ["L01", "L07", "L08"],
            hook="Rate card / panel consolidation / offshore shift", vendor_key=vid)
TAIL = [
    ("Mobile app agency", "customer_digital", 5, 90000), ("Loyalty integration boutique", "revenue_and_loyalty", 7, 96000),
    ("Crew tooling boutique", "crew_and_maintenance", 6, 99000), ("Airport kiosk integrator", "airport_and_cargo", 8, 85000),
    ("Finance systems implementation partner", "finance_people_systems", 9, 105000),
    ("Security testing boutique", "security_and_risk", 6, 112000), ("Data science boutique", "data_and_ai", 10, 108000),
    ("Network engineering contractors", "network_and_workplace", 12, 79000), ("Cloud migration boutique", "cloud_and_hosting", 9, 101000),
]
for i, (nm, dom, fte, rate) in enumerate(TAIL, 1):
    add("si_contingent", "Long-tail SIs & boutiques", f"Long-tail provider {i} - {nm}", "Various small providers",
        fte, "FTE", round(jitter(rate, 0.05), -2), "addressable", dom, capex=0.3,
        accounting="Opex / capitalizable", driver_text="FTE x blended annual rate",
        source="accounts-payable sample", hook="Panel consolidation", levers=["L01", "L07", "L08"])
# staff augmentation scales with contractor headcount: on-shore at the on-shore rate, off-shore at the off-shore rate
STAFF_AUG = [
    ("Onshore developers", 80, 178560, "shared_delivery_overhead"), ("Onshore testers", 52, 178560, "shared_delivery_overhead"),
    ("Onshore data engineers", 60, 178560, "data_and_ai"), ("Offshore developers", 210, 57660, "shared_delivery_overhead"),
    ("Offshore testers", 130, 57660, "shared_delivery_overhead"), ("Offshore support analysts", 108, 57660, "network_and_workplace"),
]
assert sum(s[1] for s in STAFF_AUG) == HC["ctr"]
for nm, fte, rate, dom in STAFF_AUG:
    add("si_contingent", "Staff augmentation (via MSP)", f"Staff augmentation - {nm}", "Managed service programme",
        fte, "FTE", rate, "addressable", dom, drv="ctr", capex=0.3, accounting="Opex / capitalizable",
        driver_text="Contractors x blended annual rate", conf="M", source="MSP invoices",
        levers=["L01", "L03", "L06", "L08"], hook="Offshore shift / demand management")

# --- advisory
for nm, amt, dom in [("Strategy & transformation advisory", 5.2, "it_management_office"),
                     ("Architecture & engineering advisory", 4.1, "shared_delivery_overhead"),
                     ("Security & risk advisory", 3.4, "security_and_risk"),
                     ("Data & AI advisory", 4.6, "data_and_ai"),
                     ("Programme assurance & audit support", 3.2, "it_management_office")]:
    add("consulting", "Consulting & advisory", nm, "Various firms", 1, "portfolio", jitter(amt, 0.05) * 1e6,
        "addressable", dom, driver_text="Annual engagements", source="engagement list")

# --- non-labour pools: (l2, name, vendor text, qty, unit, unit cost, addr, domain, capex share)
SOFTWARE = [
    ("Productivity & collaboration", "Productivity suite - knowledge workers", 9500, "users", 440, "partly", "network_and_workplace"),
    ("Productivity & collaboration", "Productivity suite - frontline licences", 21000, "users", 96, "partly", "network_and_workplace"),
    ("Enterprise applications", "ERP core licences & support", 1, "annual", 9.6e6, "partly", "finance_people_systems"),
    ("Enterprise applications", "Human capital management subscription", 1, "annual", 4.4e6, "partly", "finance_people_systems"),
    ("Enterprise applications", "Procurement & spend management", 1, "annual", 2.1e6, "addressable", "finance_people_systems"),
    ("Customer & contact centre", "CRM platform subscriptions", 2400, "seats", 1900, "partly", "customer_digital"),
    ("Customer & contact centre", "Contact-centre platform", 1800, "seats", 1650, "partly", "customer_digital"),
    ("Customer & contact centre", "Digital experience & personalisation tooling", 1, "annual", 5.2e6, "addressable", "customer_digital"),
    ("Customer & contact centre", "Marketing automation & analytics", 1, "annual", 3.1e6, "addressable", "revenue_and_loyalty"),
    ("IT service management", "Service management platform", 5200, "users", 920, "partly", "it_management_office"),
    ("Security", "Endpoint & identity security suite", 1, "annual", 7.4e6, "partly", "security_and_risk"),
    ("Security", "Network & cloud security subscriptions", 1, "annual", 5.9e6, "partly", "security_and_risk"),
    ("Security", "Security monitoring & response platform", 1, "annual", 4.3e6, "partly", "security_and_risk"),
    ("Observability & ITOps", "Monitoring & observability", 1, "annual", 4.8e6, "addressable", "cloud_and_hosting"),
    ("Data & AI", "Data warehouse & lakehouse platform", 1, "annual", 8.7e6, "partly", "data_and_ai"),
    ("Data & AI", "BI & visualisation licences", 3800, "users", 540, "addressable", "data_and_ai"),
    ("Data & AI", "ML & AI development tooling", 1, "annual", 3.9e6, "addressable", "data_and_ai"),
    ("Dev & integration tools", "Source control, CI/CD & testing tools", 1, "annual", 4.6e6, "addressable", "shared_delivery_overhead"),
    ("Dev & integration tools", "Integration & API management", 1, "annual", 5.3e6, "partly", "shared_delivery_overhead"),
    ("Infrastructure software", "Operating system & virtualisation licences", 1, "annual", 6.1e6, "partly", "cloud_and_hosting"),
    ("Infrastructure software", "Database licences & support", 1, "annual", 10.2e6, "partly", "cloud_and_hosting"),
    ("Long-tail software", "Departmental subscriptions (long tail)", 1, "annual", 4.9e6, "addressable", "shared_delivery_overhead"),
]
for l2, nm, qty, unit, uc, addr, dom in SOFTWARE:
    add("software", l2, nm, "Software vendor", qty, unit, jitter(uc, 0.03), addr, dom,
        driver_text="Licences x unit price", conf="L", source="contract register sample")

PLATFORMS = [
    ("Passenger service system", "Reservations & inventory platform (in-house, run costs)", "Platform vendor", 1, "annual", 7.8e6, "locked", "revenue_and_loyalty"),
    ("Passenger service system", "Departure control platform licences", "Platform vendor", 1, "annual", 5.1e6, "locked", "airport_and_cargo"),
    ("Passenger service system", "Per-passenger distribution fees", "Distribution network", 118e6, "PB", 0.054, "locked", "revenue_and_loyalty"),
    ("Flight operations", "Flight planning & dispatch", "Platform vendor", 1, "annual", 4.6e6, "locked", "flight_operations"),
    ("Flight operations", "Weather & navigation data", "Data provider", 1, "annual", 3.2e6, "locked", "flight_operations"),
    ("Flight operations", "Electronic flight bag", "Platform vendor", 1, "annual", 1.9e6, "partly", "flight_operations"),
    ("Aircraft communications", "Aircraft data link messaging", "Industry network", 1, "annual", 2.7e6, "locked", "flight_operations"),
    ("Crew systems", "Crew planning & rostering", "Platform vendor", 1, "annual", 4.9e6, "partly", "crew_and_maintenance"),
    ("Crew systems", "Crew tracking & disruption recovery", "Platform vendor", 1, "annual", 3.1e6, "partly", "crew_and_maintenance"),
    ("Maintenance & engineering", "Maintenance & engineering records", "Platform vendor", 1, "annual", 4.2e6, "partly", "crew_and_maintenance"),
    ("Maintenance & engineering", "Parts & inventory management", "Platform vendor", 1, "annual", 2.3e6, "partly", "crew_and_maintenance"),
    ("Airport systems", "Common-use airport terminal systems", "Industry network", 160, "sites", 24000, "partly", "airport_and_cargo"),
    ("Airport systems", "Baggage tracking & reconciliation", "Platform vendor", 1, "annual", 2.4e6, "partly", "airport_and_cargo"),
    ("Commercial systems", "Revenue management & pricing", "Platform vendor", 1, "annual", 4.4e6, "partly", "revenue_and_loyalty"),
    ("Commercial systems", "Loyalty programme platform", "Platform vendor", 1, "annual", 3.6e6, "partly", "revenue_and_loyalty"),
    ("Industry & regulatory", "Industry settlement & regulatory reporting", "Industry bodies", 1, "annual", 1.8e6, "locked", "finance_people_systems"),
]
for l2, nm, vend, qty, unit, uc, addr, dom in PLATFORMS:
    add("airline_platforms", l2, nm, vend, qty, unit, jitter(uc, 0.02), addr, dom,
        driver_text="Contracted fee schedule", conf="L", source="contract register sample")

CLOUD = [
    ("Primary cloud (committed)", "Primary cloud - compute (VMs, containers, app services)", 1, "annual", 11.5e6, "partly", "cloud_and_hosting"),
    ("Primary cloud (committed)", "Primary cloud - storage & backup", 1, "annual", 4.2e6, "partly", "cloud_and_hosting"),
    ("Primary cloud (committed)", "Primary cloud - data & analytics services", 1, "annual", 6.8e6, "partly", "data_and_ai"),
    ("Primary cloud (committed)", "Primary cloud - networking & egress", 1, "annual", 3.0e6, "addressable", "cloud_and_hosting"),
    ("Secondary cloud", "Secondary cloud - compute & storage", 1, "annual", 7.4e6, "partly", "cloud_and_hosting"),
    ("Secondary cloud", "Secondary cloud - AI & machine learning services", 1, "annual", 5.2e6, "addressable", "data_and_ai"),
    ("Digital channels hosting", "Web & mobile hosting and content delivery", 1, "annual", 6.3e6, "partly", "customer_digital"),
    ("Digital channels hosting", "Customer data platform hosting", 1, "annual", 3.7e6, "partly", "customer_digital"),
    ("Cloud support & marketplace", "Cloud support plans", 1, "annual", 3.4e6, "addressable", "cloud_and_hosting"),
    ("Cloud support & marketplace", "Marketplace software consumed on cloud", 1, "annual", 8.9e6, "partly", "shared_delivery_overhead"),
]
for l2, nm, qty, unit, uc, addr, dom in CLOUD:
    add("cloud", l2, nm, "Cloud provider", qty, unit, jitter(uc, 0.03), addr, dom, driver_text="Annual consumption",
        conf="L", source="cloud billing export sample")

DC = [
    ("Data center facilities", "Colocation space & power", 1, "annual", 7.1e6, "partly", "cloud_and_hosting", 0.0),
    ("Data center facilities", "Facility operations & maintenance", 1, "annual", 2.6e6, "partly", "cloud_and_hosting", 0.0),
    ("Servers & compute", "Server refresh (capex)", 1400, "servers", 6200, "partly", "cloud_and_hosting", 1.0),
    ("Servers & compute", "Server hardware maintenance", 1, "annual", 2.4e6, "addressable", "cloud_and_hosting", 0.0),
    ("Storage & backup", "Storage arrays (capex)", 1, "annual", 3.1e6, "partly", "cloud_and_hosting", 1.0),
    ("Storage & backup", "Storage & backup maintenance", 1, "annual", 1.9e6, "addressable", "cloud_and_hosting", 0.0),
    ("Network hardware", "Network hardware refresh (capex)", 1, "annual", 2.5e6, "partly", "network_and_workplace", 1.0),
    ("Network hardware", "Network hardware maintenance", 1, "annual", 1.8e6, "addressable", "network_and_workplace", 0.0),
]
for l2, nm, qty, unit, uc, addr, dom, cx in DC:
    add("dc_hardware", l2, nm, "Hardware & facilities vendors", qty, unit, jitter(uc, 0.03), addr, dom, capex=cx,
        accounting="Hardware capex" if cx else "Opex", driver_text="Annual cost", conf="L", source="asset register sample")

NET = [
    ("WAN & connectivity", "Airport and station circuits", 280, "sites", 14000, "addressable", "network_and_workplace"),
    ("WAN & connectivity", "Corporate and data-centre links", 1, "annual", 3.6e6, "addressable", "network_and_workplace"),
    ("Mobile & wireless", "Mobile voice & data plans", 9800, "lines", 560, "addressable", "network_and_workplace"),
    ("Mobile & wireless", "Wireless access infrastructure", 1, "annual", 1.9e6, "partly", "network_and_workplace"),
    ("Voice & contact centre telecom", "Contact-centre voice carriage", 1, "annual", 3.3e6, "addressable", "customer_digital"),
    ("Voice & contact centre telecom", "Unified communications", 1, "annual", 2.1e6, "addressable", "network_and_workplace"),
    ("Edge & delivery", "Internet edge & DDoS protection", 1, "annual", 1.7e6, "partly", "security_and_risk"),
    ("Network services", "Managed network services", 1, "annual", 4.4e6, "partly", "network_and_workplace"),
]
for l2, nm, qty, unit, uc, addr, dom in NET:
    add("network", l2, nm, "Carriers & network providers", qty, unit, jitter(uc, 0.03), addr, dom,
        driver_text="Circuits x price", conf="L", source="carrier invoice sample")

EUC = [
    ("Laptops & desktops", "Laptop refresh (capex)", 21000, "devices", 340, "partly", "network_and_workplace", 1.0),
    ("Laptops & desktops", "Desktop & peripheral refresh (capex)", 4200, "devices", 280, "partly", "network_and_workplace", 1.0),
    ("Mobile devices", "Smartphone refresh (capex)", 7600, "devices", 410, "partly", "network_and_workplace", 1.0),
    ("Airport devices", "Airport kiosks & scanners (capex)", 640, "devices", 4300, "partly", "airport_and_cargo", 1.0),
    ("Airport devices", "Frontline handheld devices (capex)", 5200, "devices", 520, "partly", "airport_and_cargo", 1.0),
    ("Print & imaging", "Managed print services", 1, "annual", 1.6e6, "addressable", "network_and_workplace", 0.0),
    ("End-user services", "Device management & support tooling", 1, "annual", 4.2e6, "addressable", "network_and_workplace", 0.0),
    ("End-user services", "Workplace technology services", 1, "annual", 3.8e6, "addressable", "network_and_workplace", 0.0),
]
for l2, nm, qty, unit, uc, addr, dom, cx in EUC:
    add("end_user", l2, nm, "Device & service vendors", qty, unit, jitter(uc, 0.03), addr, dom, capex=cx,
        accounting="Hardware capex" if cx else "Opex", driver_text="Devices x unit price", conf="L",
        source="asset register sample")

OTHER = [
    ("IT governance & admin", "IT administration & supplies", 2.1e6, "it_management_office", "addressable"),
    ("IT governance & admin", "Research & advisory subscriptions", 1.1e6, "it_management_office", "addressable"),
    ("IT governance & admin", "Management reserve / contingency", 1.7e6, "it_management_office", "addressable"),
    ("Distribution", "Distribution gateway connectivity", 1.2e6, "revenue_and_loyalty", "locked"),
    ("Payments", "Payment processing technology fees", 1.4e6, "revenue_and_loyalty", "locked"),
    ("Regional partners", "Regional partner IT recharges", 0.9e6, "airport_and_cargo", "partly"),
    ("Capital", "Capitalised internal project labour", 0.6e6, "shared_delivery_overhead", "partly"),
]
for l2, nm, uc, dom, addr in OTHER:
    add("other", l2, nm, "Various", 1, "annual", jitter(uc, 0.03), addr, dom, driver_text="Annual budget", conf="L",
        source="outside-in estimate", levers=[], hook="None")
for i in range(1, 5):  # memo lines: outside the IT budget, amount 0, owned by no VP
    add("other", "Memo items", f"Memo item {i} - recharged outside the IT budget", "n/a", 1, "memo", 0, "locked",
        "out_of_scope_memo", memo=1, accounting="Memo", nature="Memo", driver_text="Memo only", source="finance memo",
        levers=[], hook="None")

line_members, amount, capex_share = [], {}, {}
for n, row in enumerate(lines, 1):
    lid = f"zz_{n:03d}"
    cx = row.pop("_capex")
    row = {"id": lid, "legacy_id": f"ZZ-{n:03d}", **row}
    line_members.append(row)
    amount[lid] = round(row["qty"] * row["unit_cost_usd"] / 1e6, 6)
    capex_share[lid] = cx

by_pool = defaultdict(float)
for row in line_members:
    by_pool[row["pool"]] += amount[row["id"]]
assert set(by_pool) == {p["id"] for p in POOLS}, "every pool needs lines"

# --------------------------------------------------------------------------- lever library (global text, neutral)
lib = json.loads(json.dumps(ref_lib))
REWRITE = {
    "L03": {
        "hypothesis": "Many onshore contractor roles (development, test, data, L2 support) do not need to sit in a hub city. Moving them to the offshore centre at roughly a quarter of the cost, after a productivity allowance, is the largest unit-cost arbitrage on offer.",
        "timing_note": "Mar start, 6-month ramp; offshore hiring speed is the constraint",
    },
    "L05": {
        "hypothesis": "Core diagnostic: an offshore centre built on top of the home-region base, not in place of it, never reaches the P&L. Fix by (a) moving backfill of leavers to the offshore centre by default, (b) harvesting budgeted vacancies, (c) spans & layers, (d) targeted relocations.",
        "risks": "Morale and attrition of key talent; reputational risk in the home hubs; ops-critical knowledge concentration.",
        "overlap": "Biggest internal pool but slowest. Pays off mostly in the year after the target year.",
    },
    "L07": {
        "hypothesis": "A large share (about 30%) of SI spend sits outside the preferred panel, with weaker rates and no volume leverage. Moving half of it to the panel at 10-15% better rates also builds leverage for lever 8.",
        "risks": "Niche skills lost; concentration risk with the panel; small vendors may be diverse-supplier commitments.",
    },
    "L09": {
        "label": "Application rationalisation",
        "hypothesis": "An airline with a large application estate typically carries 10-20% duplicate or low-use apps. The first wave can retire a few hundred.",
        "risks": "Data retention and regulatory duties; hidden integrations; business owners resist.",
    },
    "L10": {
        "hypothesis": "Shelfware (10-30% of licences unused), premium-tier suite over-licensing and renewals without competitive tension. Airline ops software (crew, ops, revenue management) is sticky and gets lower savings.",
        "mechanism": "RR = pool x shelfware % + suite spend x (1 - shelf) x suite % + other x (1 - shelf) x renewal share x renewal cut",
        "slider_inputs": "Shelfware %, suite %, renewal share, renewal cut",
        "risks": "Audit exposure with large enterprise vendors; price uplifts at renewal (5-10%) offset part of the saving.",
    },
    "L11": {
        "hypothesis": "20-30% of cloud spend is typically waste (idle, over-sized, uncommitted). Fast and reliable, but small in absolute terms: tens of millions, not hundreds.",
    },
    "L12": {"risks": "Mainframe flight-ops systems are off-limits short term; aging kit failure risk."},
    "L13": {
        "hypothesis": "Carrier re-bid, MPLS to SD-WAN, mobile line audit. Airport circuits are constrained by airport authorities and industry networks."
    },
    "L15": {
        "hypothesis": "Per-passenger distribution fees, industry messaging, navigation and weather data: few alternatives and multi-year terms. Treat as largely locked; small wins from volume tiers and message optimisation.",
        "mechanism": "RR = partly addressable platform spend x reduction %",
    },
    "L17": {
        "hypothesis": "The target is a 2027 outlay below 2026, so cost increases (home-region merit, offshore wages, vendor COLA, software uplifts, cloud growth) must be absorbed first. Every increase avoided counts dollar for dollar.",
        "benchmark": "Only part of the cost increases is contractually contestable; merit and offshore wages are HR policy and left as headwinds",
    },
}
for lever in lib["levers"]:
    for k, v in REWRITE.get(lever["id"], {}).items():
        assert k in lever, (lever["id"], k)
        lever[k] = v
lever_members = [dict(m) for m in ref_members["lever"]]
for m in lever_members:
    if m["id"] in REWRITE and "label" in REWRITE[m["id"]]:
        m["label"] = REWRITE[m["id"]]["label"]

# --------------------------------------------------------------------------- members file
members = {
    "pool": pool_members,
    "line": line_members,
    "domain": domain_members,
    "vp": vp_members,
    "lever": lever_members,
    "akey": ref_members["akey"],
    "vendor": [{"id": i, "label": l, "preferred": p, "role": r} for i, l, p, r in VENDORS],
    "addr_tag": ref_members["addr_tag"],
    "year": ref_members["year"],
    "iyear": ref_members["iyear"],
    "lgroup": lgroup_members,
}

# --------------------------------------------------------------------------- values
vals = json.loads(json.dumps(ref_values))  # global defaults and lever inputs start from the reference defaults

vendor_book = defaultdict(float)
for row in line_members:
    if row.get("vendor_key"):
        vendor_book[row["vendor_key"]] += amount[row["id"]]


def put(k, v):
    assert k in vals, k
    vals[k] = v


r2 = lambda x, n=2: round(x, n)
# --- target and governance: target as a share of the base, a different VP method mix than the reference tenant
put("g.target_mode", 2)
put("g.target_pct", 0.12)
put("g.target_net", 80)
put("g.absorb_growth", 0)
put("g.vp_target_method", 1)
put("g.chargeback_on", 1)
# --- workforce the lines were sized at
for k, v in [("hc.us", HC["us"]), ("hc.us_seed", HC["us"]), ("hc.gcc", HC["gcc"]), ("hc.gcc_seed", HC["gcc"]),
             ("hc.ctr", HC["ctr"]), ("hc.ctr_seed", HC["ctr"])]:
    put(k, v)
put("hc.ctr_on_share", 0.3)
put("rate.ctr_on_hourly", 96.0)
put("rate.ctr_off_hourly", 31.0)
put("rate.billable_hours", 1860)
put("wf.prod_factor", 1.15)
put("wf.us_attrition", 0.085)
put("wf.change_share", 0.4)
# --- baseline
put("vendor.book", {v: r2(vendor_book[v], 3) for v, *_ in VENDORS})
put("line.amount", amount)
put("line.capex_share", capex_share)
put("addr.share", {"locked": 0, "partly": 0.3, "addressable": 0.7})
put("pool.growth", {"internal_labour": 0.034, "captive_labour": 0.075, "si_contingent": 0.03, "consulting": 0.025,
                    "software": 0.065, "airline_platforms": 0.035, "cloud": 0.1, "dc_hardware": 0.015,
                    "network": 0.01, "end_user": 0.02, "other": 0.025})
put("sub.sw_ms_share", 0.18)
put("sub.dc_maint_share", 0.45)
put("portfolio.apps", 1100)
put("portfolio.app_cost", 0.1)
put("portfolio.app_lab", 0.3)
# --- org: domain ownership, shared-services owner, usage override on, manual targets
put("org.dom_share", {f"{d},{v}": DOM_SHARE[d].get(v, 0) for d, _ in DOMAINS for v in VP_IDS})
put("org.ss_flag", {v: 1 if v == P else 0 for v in VP_IDS})
put("org.usage_override_on", 1)
put("org.usage_override", dict(zip(VP_IDS, [0.28, 0.22, 0.2, 0.12, 0.18])))
put("org.manual_target", {v: 15 for v in VP_IDS})
# --- lever tuning: the offshore centre is small, so the GCC levers start low
put("lev.L03.pct", 0.25)
put("lev.L04.pct", 0.08)
put("lev.L05.nb", 0.6)
put("lev.L05.bf", 0.6)
put("lev.L09.n", 100)
put("lev.L09.split_sw", 0.45)
put("lev.L09.split_cloud", 0.35)
# --- corporate drivers: a mid-size carrier, fictional history, scaled below the reference tenant
ASM25, LF = 205000, 83.0
put("corp.asm25", ASM25)
put("corp.asm_g", {"fy26": 2.0, "fy27": 2.5})
put("corp.lf", {"fy25": 83.0, "fy26": 83.4, "fy27": 83.6})
put("corp.yield25", 17.9)
put("corp.yield_g", {"fy26": 9.0, "fy27": 3.0})
put("corp.cargo25", 470)
put("corp.cargo_g", {"fy26": 2.0, "fy27": 2.5})
put("corp.other25", 2450)
put("corp.other_g", {"fy26": 6.0, "fy27": 5.0})
put("corp.gpa25", 14.3)
put("corp.ac25", 640)
put("corp.ac_add", {"fy26": 12, "fy27": 16})
put("corp.lease_n", {"fy25": 215, "fy26": 215, "fy27": 220})
put("corp.lease_rate25", 301.0)
put("corp.dpa25", 1.78)
put("corp.oda25", 330)
put("corp.mxr25", 3.4)
put("corp.dep25", 790)
put("corp.aptr25", 2780.0)
put("corp.reg25", 3350)
put("corp.reg_da25", 215)
put("corp.oth25", 4350)
put("corp.si", {"fy25": 95, "fy26": 0, "fy27": 0})
put("corp.debt_open", 19800)
put("corp.debt_chg", {"fy25": -820, "fy26": 0, "fy27": -300})
put("corp.cash_open", 4600)
put("corp.oth_inc", {"fy25": 55, "fy26": 35, "fy27": 35})
put("corp.tax", {"fy25": 24.5, "fy26": 24.0, "fy27": 24.0})
put("corp.cash_tax", {"fy25": 0, "fy26": 4, "fy27": 4})
put("corp.shares", {"fy25": 612.0, "fy26": 614.0, "fy27": 616.0})
put("corp.capex", {"fy25": 2650, "fy26": 2800, "fy27": 2950})
put("corp.slb", {"fy25": 210, "fy26": 180, "fy27": 180})
put("corp.oplease", {"fy25": 4650, "fy26": 4600, "fy27": 4600})
put("corp.pension", {"fy25": 330, "fy26": 300, "fy27": 270})
put("corp.price_now", 9.4)
put("corp.pe", 7.5)
put("corp.ev_mult", 6.9)
put("corp.cust_opex", 80)
put("corp.cust_capex", 8)
put("corp.cust_ot", 20)
put("corp.cust_opex28", 120)
put("corp.cust_capex28", 12)
put("corp.it_swb", 28)
put("corp.cal_ocf25", 2050)
put("corp.cal_fcf25", 55)
put("corp.cal_cash25", 4100)
# labour groups follow this carrier's own unions, not the reference tenant's
LAB = {  # id: (headcount FY25, annual cost per head $k, hc growth FY26/FY27 %, wage growth FY26/FY27 %)
    "flight_deck": (9800, 305, (2.5, 2.0), (4.2, 4.0)),
    "cabin_crew": (17500, 96, (2.5, 2.0), (3.6, 3.4)),
    "technical_operations": (12400, 118, (2.0, 2.0), (3.8, 3.8)),
    "ground_operations": (23600, 74, (1.5, 1.5), (3.2, 3.2)),
}
put("corp.lab_hc25", {g: LAB[g][0] for g, _ in LGROUPS})
put("corp.lab_rate25", {g: LAB[g][1] for g, _ in LGROUPS})
put("corp.lab_hc_g", {f"{g},{y}": LAB[g][2][i] for g, _ in LGROUPS for i, y in enumerate(("fy26", "fy27"))})
put("corp.lab_wage_g", {f"{g},{y}": LAB[g][3][i] for g, _ in LGROUPS for i, y in enumerate(("fy26", "fy27"))})
put("corp.ben_load", {"fy25": 12.0, "fy26": 12.2, "fy27": 12.4})
put("corp.cpi", {"fy25": 2.6, "fy26": 2.6, "fy27": 2.3})
put("corp.fix_share", {"fy25": 70.0, "fy26": 70.0, "fy27": 70.0})
put("corp.fix_rate", {"fy25": 5.5, "fy26": 5.4, "fy27": 5.3})
put("corp.sell_pct", {"fy25": 4.1, "fy26": 4.1, "fy27": 4.1})

# --------------------------------------------------------------------------- scenarios, tenant, library
scen = json.loads(json.dumps(ref_scen))
scen["tenant"] = "zz"  # the five global presets, copied; lever inputs stay at the library defaults

# Registry bounds (variables.json, two folders above the reference seed). The reference seed's defaults and its
# "full stretch" preset sit above a few slider maxima, which VR04 reports; zz copies them clamped to the bound.
bounds = {v["id"]: (v.get("min"), v.get("max")) for v in json.load(open(REF.parent.parent / "variables.json"))["variables"]}
clamped = []


def clamp(var, x, where):
    lo, hi = bounds[var]
    y = x if lo is None or x >= lo else lo
    y = y if hi is None or y <= hi else hi
    if y != x:
        clamped.append(f"{where}: {var} {x} -> {y}")
    return y


def clamp_values(values, where):
    for var, v in values.items():
        values[var] = (
            {k: clamp(var, x, where) for k, x in v.items()} if isinstance(v, dict) else clamp(var, v, where)
        )


clamp_values(vals, "defaults")
for s in scen["scenarios"]:
    clamp_values(s["values"], s["id"])

tenant = {
    "id": "zz",
    "name": "Zz Synthetic Test Airline",
    "currency": "USD",
    "base_year": 2026,
    "target_year": 2027,
    "fiscal_calendar": "calendar",
    "market_data_as_of": "2026-11-22",
    "ticker": "ZZTST",
    "demo_date": "2026-12-04",
}


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


OUT.mkdir(parents=True, exist_ok=True)
dump("tenant.json", tenant)
dump("dimension_members.json", members)
dump("variable_values.json", vals)
dump("scenarios.json", scen)
dump("lever_library.json", lib)
for c in clamped:
    print("clamped", c)
print(f"zz: {len(line_members)} lines, base ${sum(by_pool.values()):.1f}M", {k: round(v, 1) for k, v in by_pool.items()})
