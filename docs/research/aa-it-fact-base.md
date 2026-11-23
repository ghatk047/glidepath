# American Airlines IT: Public Fact Base

*Workstream 2 of 3 · Neutral-advisor background · Compiled 22 Nov 2026 from public sources only (no ZoomInfo / intent-data subscriptions)*

**Confidence key.** **H** = company filing, company press release, or on-record executive quote. **M** = reputable press, or a vendor case study naming AA. **L** = aggregator / intent-data site, anonymous sourcing, or single blogger. **INFERENCE** = our own reasoning or arithmetic, not a reported fact.

Companion sheet: [aa-vendor-product-sheet.xlsx](/mnt/project-files/research/aa-vendor-product-sheet.xlsx) (vendors, products, peer benchmarks, source list).

---

## 1. Ten things the MD should know

1. **AA is margin-thin, so $100M matters.** FY2025 revenue $54.6B, adjusted operating margin 3.0%, adjusted net income $237M (H). $100M of IT savings is about 6% of FY25 adjusted operating income and roughly 40% of adjusted net income (INFERENCE).
2. **The CIO budget looks lean against benchmarks.** $1B is about 1.8% of revenue. SITA puts airline IT spend at 3.6% to 3.8% of revenue (M). The gap most likely means a large share of AA's tech spend (distribution/GDS fees, business-unit IT, connectivity, capitalised projects) sits outside the CIO's $1B (INFERENCE). Savings are harder to find in a budget that already benchmarks low.
3. **AA says it has *increased* IT spend and US IT headcount every year since 2021** (H, AA statement via View from the Wing, Mar 2025). The CIO said tech spend was rising "well north of" revenue growth (H, Dallas Morning News, Jul 2024). This is consistent with the CFO's complaint that the cost base has not come down.
4. **The India GCC is younger and smaller than the brief assumes.** Hyderabad hiring started late 2024. Reuters (May 2026, anonymous sources) put it at about 400 staff, targeting about 800 by early 2027 (L/M). The working assumption of ~1,000 in the GCC should be checked with AA. It may include planned headcount or a different scope.
5. **The GCC is an insourcing play, not a vendor-rate play.** AA said it is terminating "underperforming vendors" and bringing "several third-party IT contracts in house," staffed by an AA subsidiary (H, Mar 2025). This directly affects the SI book (Infosys, Cognizant, DXC, IBM, Coforge).
6. **DXC is structurally embedded.** 20+ year partner running "some of AA's most critical systems," including mainframe modernization of the Flight Operating System (FOS). Former CIO: "we wouldn't be flying without DXC" (M, DXC case study, 2023). This makes DXC both the largest savings pool and the highest switching risk.
7. **Sabre is locked in.** Multi-year renewal (Dec 2024) of the SabreSonic passenger service system and Sabre PRISM, settling 13 years of litigation (H/M). PSS cost is near-unavoidable in 2027.
8. **Multi-cloud with Azure as primary.** IBM Cloud (2016 deal, VMware estate, aa.com/mobile/kiosk) and Microsoft Azure ("preferred cloud" since May 2022) (H/M). Oracle OCI also hosts the AAdvantage Siebel loyalty stack (M). Running three clouds plus residual data centers and mainframe is a classic consolidation lever.
9. **The CIO's agenda is resiliency, engineering excellence, modernization and AI.** Ganesh Jayaram (Chief Digital & Information Officer since 2022) frames GenAI as an internal productivity play (H). Outage minutes fell about 30% per year 2022 to 2024 (H). Cost reduction is not his headline message.
10. **Corporate rightsizing has already started.** November 2025 cuts of "hundreds" of management and support roles at Fort Worth HQ, including technology (M). Some easy headcount savings may already be in the 2026 base.

---

## 2. Company context

| Metric (FY2025) | Value | Conf. | Source |
|---|---|---|---|
| Total operating revenue | $54,633M | H | [Q4 2025 earnings presentation (SEC)](https://www.sec.gov/Archives/edgar/data/4515/000000620126000008/earningspresentation.htm) |
| Total operating expenses (GAAP) | $53,166M | H | same |
| Opex ex fuel and special items | $42,286M | H | same |
| Operating margin, adjusted | 3.0% ($1,629M) | H | same |
| Net income GAAP / adjusted | $111M / $237M | H | [AA press release, 27 Jan 2026](https://news.aa.com/news/news-details/2026/American-Airlines-reports-fourth-quarter-and-full-year-2025-financial-results-CORP-FI-01/default.aspx) |
| Adjusted EBITDAR margin | 9.3% | H | earnings presentation |
| Total debt | $36.5B (cut $2.1B in 2025) | H | press release |
| Employees | ~130,000 | H | press release |
| Free cash flow | -$83M | H | earnings presentation |
| 2026 adjusted EPS guide | $1.70 to $2.70 | H | press release |

**INFERENCE:** IT at $1B equals about 2.4% of opex ex-fuel, or about $7,700 per AA employee.

---

## 3. Technology stack (what is publicly known)

### 3.1 Core airline systems
| Domain | Platform / vendor | Conf. | Notes and source |
|---|---|---|---|
| Passenger service system (res, inventory, DCS) | **Sabre SabreSonic** | H | Multi-year renewal Dec 2024 ([Nasdaq/TheFly](https://www.nasdaq.com/articles/sabre-and-american-airlines-extend-it-partnership)). AA ran PSS on the Sabre mainframe for decades ([Computerworld 2013](https://www.computerworld.com/article/2827592/from-build-to-buy--american-airlines-changes-modernization-course-midflight.html)). |
| Corporate travel contract mgmt | Sabre PRISM | H | same renewal |
| Distribution | Sabre, Amadeus, Travelport GDS; NDC via Sabre since 2023 | M | Nasdaq; RFP.wiki citing AA 2022 release |
| Flight operations | **FOS (Flight Operating System)**, mainframe, being modernised to DevOps toolchain by DXC | M | [DXC case study](https://dxc.com/insights/customer-stories/american-airlines-reaches-cruising-altitude) |
| Integration | Flight Hub ESB on IBM WebSphere / MQ (2007 onward) | M (dated) | Computerworld 2013 |
| Loyalty / CRM | **Oracle Siebel Loyalty** for AAdvantage (100M+ members, ~300M tx/day) on OCI Exadata | M | [Oracle Solution Innovator page](https://docs.oracle.com/cd/G15000_01/SiebelInfoPortal/american_airlines.html) |
| Inflight connectivity | **Viasat + Intelsat** (900+ mainline aircraft); free Wi-Fi sponsored by **AT&T** from Jan 2026 | H | [AA release Apr 2025](https://news.aa.com/news/news-details/2025/Connecting-the-world-American-Airlines-to-provide-complimentary-inflight-Wi-Fi-sponsored-by-ATT-MKG-OB-04/default.aspx), [AT&T release Jan 2026](https://about.att.com/aboutus/pressrelease/2026/american-airlines-launches-free-wifi.html) |
| Electronic flight bag | Apple iPad (pilots); Samsung tablets for FAs and mechanics (2013) | M (dated) | Computerworld 2013 |

### 3.2 Cloud and infrastructure
| Item | Detail | Conf. | Source |
|---|---|---|---|
| Microsoft Azure | "Preferred cloud platform" for airline apps and key workloads; Operations Hub; Microsoft "one of the airline's largest technology partners" | H | [Microsoft/AA release, 18 May 2022](https://news.microsoft.com/2022/05/18/american-airlines-and-microsoft-partnership-takes-flight-to-create-a-smoother-travel-experience-for-customers-and-better-technology-tools-for-team-members/) |
| IBM Cloud | 2016 non-exclusive deal; IBM Cloud for VMware; hundreds of VMs (aa.com, mobile, kiosks) moved via HCX; avoided hardware refresh capex; IBM 24x7 app support onshore + offshore | M | [Fortune 2016](https://fortune.com/2016/11/29/american-airlines-lands-on-ibm-cloud-for-some-of-its-tech/), [IBM case study (~2018)](https://www.ibm.com/case-studies/american-airlines) |
| Oracle Cloud Infrastructure | Hosts Siebel loyalty on Exadata Cloud Service | M | Oracle page |
| Mainframe | Still present (FOS); modernisation with DXC | M | DXC case study |
| Teradata VantageCloud on Azure; Databricks; Snowflake | Data platforms (conflicting reports) | L | RFP.wiki, komo.ai |
| Dynatrace | Observability across Azure, IBM Cloud, on-prem, Kubernetes | L | RFP.wiki |

### 3.3 Enterprise applications
| Domain | Product | Conf. | Source |
|---|---|---|---|
| HR / payroll | **SAP SuccessFactors + SAP Payroll** on HANA Enterprise Cloud, implemented by Deloitte ("Project Spring", 2016 to 2018; 150+ interfaces) | M | [Deloitte case study](https://www.deloitte.com/cy/en/alliances/sap/case-studies/american-airlines-recognized-with-sap-innovation-digital-trailblazer-award.html) |
| Productivity / collaboration | Microsoft 365, Teams, Power Apps (ConnectMe frontline app) | H | Microsoft 2022 release |
| Procure-to-pay | Coupa (Invoice 2018; source-to-pay) | L/M | AppsRunTheWorld, RFP.wiki |
| Financial close | Trintech Cadency | L | RFP.wiki |
| Leave management | AbsenceSoft | L | AppsRunTheWorld |
| Customer messaging AI | ASAPP | L | RFP.wiki |
| Data catalog / quality | Alation, Monte Carlo | L | RFP.wiki |
| Streaming | Striim (MongoDB to Azure data lake) | L | RFP.wiki |
| CRM (GTM) | Salesforce | L | komo.ai |

**Not found publicly:** ITSM tool (ServiceNow is likely but unconfirmed), identity/security stack, ERP general ledger vendor, telecom WAN carrier, end-user device vendor. These are big cost lines in any airline. Ask AA for the vendor master.

---

## 4. Vendors and systems integrators

| Vendor | Public evidence | Book size (from client brief) | Conf. |
|---|---|---|---|
| **DXC Technology** (ex-HP/EDS lineage) | 20+ year partner; critical systems; mainframe/FOS modernisation; cloud migration; RPA | ~$25M (largest SI) | M |
| **IBM** | 2016 cloud deal; app support center onshore+offshore; WebSphere middleware | between $5M and $25M | M |
| **Microsoft** | Azure preferred cloud; M365 | software/cloud, not SI book | H |
| **Sabre** | PSS, PRISM, GDS | software/transaction fees | H |
| **Oracle** | Siebel loyalty, OCI | software/cloud | M |
| **SAP / Deloitte** | HR and payroll platform; Deloitte as implementer | software + consulting | M |
| **Infosys** | No AA-specific public case study found | ~$5M | client brief only |
| **Cognizant** | No AA-specific public case study found | between $5M and $25M | client brief only |
| **Coforge** | Two anonymous "leading airline" case studies (one: 350 apps / 1,800 servers on AWS+Azure Arc; one: ServiceNow AIOps service desk). Cannot attribute to AA. | between $5M and $25M | L |
| **Viasat, Intelsat, AT&T** | Connectivity and sponsorship | likely outside CIO budget | H |
| **PwC** | Treasury transformation case study (2026) | consulting | M |

**History worth knowing (M, Computerworld 2013):** AA built its modernisation (Jetstream PSS and Horizon FOS replacements) with EDS/HP, switched from build to buy in January 2012, and ended the HP contract in 2012. AA has walked away from a major SI once before, so the MD can use that as credible negotiating history.

**INFERENCE on the SI book:** Six preferred SIs with a ~$5M to ~$25M range suggests roughly $60M to $90M across the preferred panel. That is small against a $1B budget. Rate haircuts of 5% to 10% on the preferred panel alone would yield only about $3M to $9M. This supports the brief's thesis that bill-rate pressure cannot carry the $100M target.

---

## 5. India GCC (Hyderabad)

| Fact | Detail | Conf. | Source |
|---|---|---|---|
| Announced / opened | Reports Aug 2024; hiring began late 2024; HITEC City | M | [Aviation A2Z Aug 2024](https://aviationa2z.com/index.php/2024/08/08/american-airlines-it-hub-in-hyderabad-india-exclusive/), [AIM May 2026](https://analyticsindiamag.com/gcc/from-american-to-southwest-inside-hyderabads-rise-as-aviation-gcc-capital) |
| Entity | Employees of an AA Group subsidiary (captive, not vendor) | H | [View from the Wing, Mar 2025](https://viewfromthewing.com/american-airlines-moves-up-to-30-of-its-it-to-india-smart-strategy-or-short-sighted-cost-cut/) |
| Headcount | ~400 (May 2026); target ~800 by early 2027. AA on record: "several hundred" | L/M | [PeopleMatters, May 2026](https://www.peoplematters.in/news/recruiting-and-onboarding/american-airlines-plans-to-double-india-tech-workforce-to-800-employees-49967) (Reuters, anonymous sources) |
| Share of IT | 20% to 30% of IT operation moving to India | L | View from the Wing (single blogger) |
| Functions | Software engineering, AI, cybersecurity, 24x7 support | M | PeopleMatters, AIM |
| Stated rationale | Insource vendor work, not primarily cost-cutting; drop "underperforming vendors" | H | AA statement via View from the Wing |
| Savings | Blogger estimate "eight figures annually" | L | View from the Wing |
| Operating model | "Teams in Fort Worth, Phoenix and Hyderabad work closely with the business" | H | AA to Reuters via PeopleMatters |

**Discrepancy to resolve:** the brief says the GCC has ~900 to 1,000 people. Public reporting says ~400 today and ~800 by early 2027. If the brief's figure is right, the GCC scaled faster than reported. If public reporting is right, the GCC ramp is itself a 2027 lever still in flight.

**Why the cost base hasn't fallen (INFERENCE):** a GCC adds cost before it removes cost. AA is building captive capacity while US headcount also grew (per AA's own statement), and vendor exits lag. Unless onshore roles and vendor contracts are actually released, a GCC raises run-rate cost. This is probably the single most important diagnostic for the CFO's question.

---

## 6. CIO statements (Ganesh Jayaram, Chief Digital & Information Officer)

- Appointed 2022 ([AA release](https://news.aa.com/news/news-details/2022/American-Airlines-Names-Ganesh-Jayaram-Chief-Digital-and-Information-Officer-CORP-EXEC-08/)). Predecessor Maya Leibman (CIO 2011 to 2022) drove the build-to-buy pivot and cloud moves.
- Three priorities: "delivering resilient products, driving technical engineering excellence and modernizing its technology stack" ([CIO Dive, Jul 2025](https://www.ciodive.com/news/american-airlines-cio-redefine-cx-tech/752066/)). (H)
- "Really increasing year over year spend in technology, well north of what our revenue projections would be" ([Dallas Morning News, Jul 2024](https://dallasnews.com/business/airlines/2024/07/08/i-always-sleep-with-one-eye-open-american-airlines-it-chief-talks-security-and-change)). (H)
- GenAI focus is internal productivity and efficiency (same interview). Cybersecurity is the top worry. Outage minutes down ~30% per year. ~2,000 IT staff at Fort Worth HQ, plus Phoenix. (H)
- "IT is reengineering how they work" ([AA newsroom, Jun 2024](https://news.aa.com/news/news-details/2024/Tell-Me-Why-Were-reengineering-the-way-we-work---Ganesh-Jayaram-CORP-OTH-06/default.aspx)). Mar 2026 episode on using AI "to build a more efficient airline" ([AA newsroom](https://news.aa.com/news/news-details/2026/Tell-Me-Why-Our-technology-focus-is-to-enable-the-goals-of-the-airline-Ganesh-Jayaram-CORP-OTH-03/default.aspx)). (H)

**Reading for the MD (INFERENCE):** the CIO's public narrative is investment and resiliency. A $100M net-savings mandate cuts across that, so the app should show savings that fund, rather than fight, the modernisation agenda (decommissioning, cloud consolidation, vendor insourcing, AI productivity).

---

## 7. Peer benchmarks

| Airline | IT spend | Revenue | IT % of rev | IT per employee | Conf. / source |
|---|---|---|---|---|---|
| **Industry (SITA)** | $36B airlines (2025); $37B (2024) | n/a | **3.6%** (2025), 3.8% (2024), 3.6% (2023), 4.1% (2022) | n/a | M. [Travolution on SITA 2025](https://www.travolution.com/news/sita-says-record-tech-spend-hinges-on-data-coordination/), [PhocusWire on SITA 2024](https://www.phocuswire.com/sita-airline-it-insights-2024) |
| **Lufthansa Group** | €1.45B IT budget; ~8,000 IT staff | €35.4B (2023) | **~4.1%** | ~€15,000 per group employee (96.7k) | M. [CIO.de, Jan 2025](https://www.cio.de/article/3701102/deutsche-lufthansa-ag-it-fakten-und-it-strategie.html) |
| **Southwest** | ~$1B/yr historically; $1.3B (2023); ~$1.7B (2024, incl. upgrades and maintenance) | $26.1B (2023) | **~6.5%** (2024, post-meltdown catch-up) | ~$23,000 (~74k staff, INFERENCE) | H/M. [CFO Dive Jan 2023](https://www.cfodive.com/news/southwest-ups-tech-spend/641449/), [CIO Dive Jan 2024](https://www.ciodive.com/news/southwest-invests-billions-technology-cloud/705898/) |
| **American (CIO budget)** | ~$1B (client brief) | $54.6B (2025) | **~1.8%** | **~$7,700** | INFERENCE |
| **Delta** | Not disclosed. Kyndryl 5-yr infra deal (2023); AWS sole cloud | ~$61B (2024, approx.) | n/a | n/a | M. [CIO Dive Feb 2023](https://www.ciodive.com/news/Kyndryl-Delta-Air-Lines-hybrid-cloud-deal-AWS/643430/) |
| **United** | Not disclosed. DXC mainframe modernisation | ~$57B (2024, approx.) | n/a | n/a | M. [DXC case study 2025](https://dxc.com/us/en/insights/customer-stories/digital-transformation-solutions-united-airlines) |
| **Air France-KLM** | Not disclosed. TCS 3-yr cloud / data-center-exit deal (Nov 2024) | n/a | n/a | n/a | M. [TCS release](https://www.tcs.com/who-we-are/newsroom/press-release/tcs-signs-multi-year-deal-air-france-klm-accelerate-data-driven-aviation) |
| **IAG** | Not found in public sources in this pass | | | | gap |

Other useful benchmarks:
- **Internal IT cost per FTE (INFERENCE):** $1B / ~5,000 IT heads = ~$200k all-in cost per head, including non-labor spend.
- **Cloud savings are real but modest:** Southwest's CEO said cloud savings would be "tens of millions rather than hundreds of millions" (H, CIO Dive Jan 2024). Use this to cap the cloud lever in the app.
- **Disruption cost:** irregular operations cost each carrier $50M to $200M a year (M, [Avasant 2026](https://avasant.com/report/airlines-and-airports-digital-services-delivering-industry-specific-value-through-ai-first-solutions/)). Southwest's Dec 2022 meltdown cost ~$800M (M). Savings that raise outage risk are a false economy.
- **Provider landscape (Avasant 2026):** Leaders in airline digital services are Capgemini, Cognizant, HCLTech, Coforge, TCS, Tech Mahindra, Wipro. DXC, Infosys, IBM and Accenture are rated "Innovators" (M). Useful for competitive tension on the SI panel.

**How to read the benchmark gap (INFERENCE):** SITA's 3.6% is an airline-wide figure that typically includes distribution technology, PSS transaction fees, business-unit IT and capitalised spend. AA's 1.8% is the CIO's cost centre only. Put AA's ~$2.0B "airline-wide equivalent" (3.6% x $54.6B) next to the $1B and the gap suggests ~$1B of tech-like spend sits elsewhere in AA's P&L. That's a scoping question for the MD: is any of it in play for the $100M?

---

## 8. Implications for the savings model (handed to Workstream 3)

| Hypothesis | Evidence | Strength |
|---|---|---|
| H1. Rate haircuts on the preferred SI panel yield single-digit millions | SI book ~$60M to $90M (brief) | Strong |
| H2. GCC benefits only land if onshore roles and vendor contracts are released in step | AA grew US IT headcount while building GCC; insourcing intent stated | Strong |
| H3. Three-cloud estate (Azure, IBM Cloud, OCI) plus mainframe and residual DCs carries consolidation savings, but capped (tens of millions) | Public cloud deals; Southwest analogue | Medium |
| H4. DXC concentration is a negotiating lever and a risk; mainframe/FOS exit is multi-year | DXC case study; Computerworld history | Medium |
| H5. Sabre PSS and distribution fees are largely non-addressable in 2027 | Dec 2024 multi-year renewal | Strong |
| H6. Application rationalisation across ~1,800 apps is a major lever (licences, hosting, support) | App count from brief; heavy SaaS/point-tool footprint visible in aggregator data | Medium (needs app inventory) |
| H7. Microsoft is a top-3 spend vendor; EA / Azure commit renegotiation is material | "One of largest technology partners" (2022) | Medium |
| H8. Some 2026 savings are already banked from Nov 2025 HQ rightsizing, so the 2027 base may be lower than flat | Skift / CBS Nov 2025 | Medium |

---

## 9. Gaps and what to ask AA for

1. Vendor master with FY2025 spend by supplier (to replace public guesses).
2. GCC actual headcount, cost per head and the roles or contracts it replaced.
3. Cloud bills by provider and remaining data-center footprint.
4. Application inventory with owner, licence cost, hosting cost, and usage.
5. Whether depreciation, Sabre fees and connectivity sit in the $1B.
6. ITSM, security and telecom vendors (none found publicly).

## 10. Source quality notes

- The SITA North America report is registration-gated and was not read; regional % of revenue is therefore missing.
- Aggregator data (RFP.wiki, AppsRunTheWorld, komo.ai) is directional; use it only as prompts for AA to confirm.
- Several AA vendor case studies are dated (2013 to 2018) and describe the Leibman era.
- Delta and United revenue figures above are approximate and quoted from memory; verify before the demo.
- A PeopleMatters headline about "5,000" AA job cuts in Nov 2025 was not verified and is excluded. Skift and CBS describe "hundreds."
