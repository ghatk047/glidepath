# 03b · Formula node catalogue

Generated from `formula_graph.json`. Every node is overridable (pinnable) per scenario unless noted. See 03_formula_graph.md for the language and the layer walk-through.

## Layer: baseline (18 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `base.line_scale` | line | x | `IF(line.drv == 'us', hc.us / hc.us_seed, IF(line.drv == 'gcc', hc.gcc / hc.gcc_seed, IF(line.drv == 'ctr', hc.ctr / hc.ctr_seed, 1)))` | Headcount scaling of the line |
| `base.line_outlay` | line | $M | `line.amount * base.line_scale` | CY26 outlay of the line |
| `base.line_capex` | line | $M | `base.line_outlay * line.capex_share` |  |
| `base.line_addressable` | line | $M | `base.line_outlay * addr.share[line.addr]` |  |
| `base.line_growth` | line | $M | `base.line_outlay * pool.growth[line.pool]` |  |
| `base.pool_outlay` ★ | pool | $M | `SUM(l in line where l.pool == pool, base.line_outlay[l])` | CY26 outlay by pool |
| `base.pool_capex` ★ | pool | $M | `SUM(l in line where l.pool == pool, base.line_capex[l])` | CY26 cash capex by pool |
| `base.pool_addressable` ★ | pool | $M | `SUM(l in line where l.pool == pool, base.line_addressable[l])` | Addressable spend by pool |
| `base.pool_growth` ★ | pool | $M | `SUM(l in line where l.pool == pool, base.line_growth[l])` | CY27 status-quo growth by pool |
| `base.pool_capex_share` | pool | % | `SAFEDIV(base.pool_capex, base.pool_outlay, 0)` |  |
| `base.total` ★ |  | $M | `SUM(p in pool, base.pool_outlay[p])` | CY26 normalized IT outlay |
| `base.capex_total` ★ |  | $M | `SUM(p in pool, base.pool_capex[p])` |  |
| `base.opex_total` ★ |  | $M | `base.total - base.capex_total` |  |
| `base.addressable_total` ★ |  | $M | `SUM(p in pool, base.pool_addressable[p])` |  |
| `base.headwinds` ★ |  | $M | `SUM(p in pool, base.pool_growth[p])` | CY27 cost growth to absorb |
| `base.locked_total` ★ |  | $M | `SUM(l in line where l.addr == 'locked', base.line_outlay[l])` |  |
| `base.locked_share` ★ |  | % | `SAFEDIV(base.locked_total, base.total, 0)` |  |
| `base.fees_addressable` |  | $M | `SUM(l in line where AND(l.pool == 'airline_platforms', l.addr != 'locked'), base.line_outlay[l])` | Airline platform spend not locked |

## Layer: levers (96 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `lv.us_total` |  | $M | `base.pool_outlay['internal_labour']` | US internal labour cost |
| `lv.us_cost` |  | $M/FTE | `lv.us_total / hc.us` | US loaded cost per FTE |
| `lv.gcc_total` |  | $M | `base.pool_outlay['captive_labour']` | Captive (GCC) cost |
| `lv.gcc_cost` |  | $M/FTE | `lv.gcc_total / hc.gcc` | GCC loaded cost per FTE |
| `lv.on0` |  | FTE | `hc.ctr * hc.ctr_on_share` | Onshore contractor FTE |
| `lv.off0` |  | FTE | `hc.ctr * (1 - hc.ctr_on_share)` | Offshore contractor FTE |
| `lv.on_cost` |  | $M/FTE | `rate.ctr_on_hourly * rate.billable_hours / 1000000` | Onshore contractor cost per FTE |
| `lv.off_cost` |  | $M/FTE | `rate.ctr_off_hourly * rate.billable_hours / 1000000` | Offshore contractor cost per FTE |
| `lv.ext` |  | $M | `base.pool_outlay['si_contingent']` | SI & contingent spend |
| `lv.ctr_cost` |  | $M | `lv.on0 * lv.on_cost + lv.off0 * lv.off_cost` | Contingent T&M cost |
| `lv.ms0` |  | $M | `lv.ext - lv.ctr_cost` | Managed / fixed-price SI services |
| `lv.pref` |  | $M | `SUM(v in vendor, vendor.book[v] * v.preferred)` | Preferred SI book |
| `lv.tail` |  | $M | `lv.ext - lv.pref` | Long-tail SI spend |
| `lv.cons` |  | $M | `base.pool_outlay['consulting']` | Consulting |
| `lv.sw` |  | $M | `base.pool_outlay['software']` | Software |
| `lv.sw_ms` |  | $M | `lv.sw * sub.sw_ms_share` | Microsoft software |
| `lv.cloud` |  | $M | `base.pool_outlay['cloud']` | Cloud |
| `lv.dc_capex` |  | $M | `base.pool_capex['dc_hardware']` | Hardware & infrastructure cash capex |
| `lv.dc_opex` |  | $M | `base.pool_outlay['dc_hardware'] - lv.dc_capex` | DC & hardware opex |
| `lv.dc_maint` |  | $M | `lv.dc_opex * sub.dc_maint_share` | Hardware maintenance |
| `lv.dc_colo` |  | $M | `lv.dc_opex - lv.dc_maint` | Colo & facilities |
| `lv.net` |  | $M | `base.pool_outlay['network']` | Network & telecom |
| `lv.euc` |  | $M | `base.pool_outlay['end_user']` | End-user |
| `lv.fees` |  | $M | `base.pool_outlay['airline_platforms']` | Airline platforms |
| `lv.fees_addr` |  | $M | `base.fees_addressable` | Airline platforms not locked |
| `lev.L01.f` |  | % | `lev.on['L01'] * (wf.change_share * lev.L01.cut + (1 - wf.change_share) * lev.L01.rel)` | Share of SI volume removed |
| `lev.L01.rr` |  | $M | `lev.L01.f * (lv.on0 * lv.on_cost + lv.off0 * lv.off_cost + lv.ms0)` |  |
| `lev.L01.ot` |  | $M | `lev.L01.ot_pct * lev.L01.rr` |  |
| `lev.L01.on1` |  | FTE | `lv.on0 * (1 - lev.L01.f)` |  |
| `lev.L01.off1` |  | FTE | `lv.off0 * (1 - lev.L01.f)` |  |
| `lev.L01.ms1` |  | $M | `lv.ms0 * (1 - lev.L01.f)` |  |
| `lev.L02.rr` |  | $M | `lev.on['L02'] * lv.cons * lev.L02.cut` |  |
| `lev.L02.ot` |  | $M | `lev.L02.ot_pct * lev.L02.rr` |  |
| `lev.L03.h` |  | FTE | `lev.on['L03'] * lev.L01.on1 * lev.L03.pct` | Onshore roles relocated |
| `lev.L03.rr` |  | $M | `lev.L03.h * (lv.on_cost - lv.gcc_cost * wf.prod_factor)` |  |
| `lev.L03.ot` |  | $M | `lev.L03.h * lev.L03.tc` |  |
| `lev.L03.on3` |  | FTE | `lev.L01.on1 - lev.L03.h` |  |
| `lev.L03.gcc_add` |  | FTE | `lev.L03.h * wf.prod_factor` |  |
| `lev.L04.h` |  | FTE | `lev.on['L04'] * lev.L01.off1 * lev.L04.pct` |  |
| `lev.L04.rr` |  | $M | `lev.L04.h * (lv.off_cost - lv.gcc_cost * lev.L04.pf)` |  |
| `lev.L04.ot` |  | $M | `lev.L04.h * lev.L04.tc` |  |
| `lev.L04.off4` |  | FTE | `lev.L01.off1 - lev.L04.h` |  |
| `lev.L05.h` |  | FTE | `lev.on['L05'] * hc.us * wf.us_attrition * lev.L05.nb` | US leavers not backfilled onshore |
| `lev.L05.r` |  | FTE | `lev.on['L05'] * hc.us * lev.L05.rel` | US roles relocated beyond attrition |
| `lev.L05.us_saving` |  | $M | `(lev.L05.h + lev.L05.r) * lv.us_cost + lev.on['L05'] * lv.us_total * (lev.L05.sl + lev.L05.vac)` |  |
| `lev.L05.gcc_added` |  | $M | `(lev.L05.h * lev.L05.bf + lev.L05.r) * lv.gcc_cost * wf.prod_factor` |  |
| `lev.L05.rr` |  | $M | `lev.L05.us_saving - lev.L05.gcc_added` |  |
| `lev.L05.ot` |  | $M | `lev.on['L05'] * lv.us_total * lev.L05.sl * lev.L05.sev + lev.L05.r * lv.us_cost * lev.L05.reloc_sev + (lev.L05.h * lev.L05.bf + lev.L05.r) * lev.L05.hire_cost` |  |
| `lev.L06.g` |  | % | `lev.on['L06'] * lev.L06.gain` |  |
| `lev.L06.pool` |  | $M | `lev.L03.on3 * lv.on_cost + lev.L04.off4 * lv.off_cost + lev.L01.ms1` | Remaining SI + managed pool |
| `lev.L06.si_saving` |  | $M | `lev.L06.pool * lev.L06.g * lev.L06.cap` |  |
| `lev.L06.rr` |  | $M | `lev.L06.si_saving - lev.on['L06'] * lev.L06.tool` |  |
| `lev.L06.ot` |  | $M | `IF(lev.L06.g > 0, lev.L06.setup, 0)` |  |
| `lev.L07.ext` |  | $M | `lev.L06.pool * (1 - lev.L06.g * lev.L06.cap)` |  |
| `lev.L07.rr` |  | $M | `lev.on['L07'] * lev.L07.ext * SAFEDIV(lv.tail, lv.ext, 0) * lev.L07.pct * lev.L07.diff` |  |
| `lev.L07.ot` |  | $M | `lev.L07.ot_pct * lev.L07.rr` |  |
| `lev.L08.ext` |  | $M | `lev.L07.ext - lev.L07.rr` |  |
| `lev.L08.rr` |  | $M | `lev.on['L08'] * lev.L08.ext * lev.L08.cov * lev.L08.cut * (1 - lev.L08.leak)` |  |
| `lev.L08.ot` |  | $M | `lev.L08.ot_pct * lev.L08.rr` |  |
| `lev.L09.rr` |  | $M | `lev.on['L09'] * lev.L09.n * portfolio.app_cost * (1 - portfolio.app_lab)` |  |
| `lev.L09.ot` |  | $M | `lev.on['L09'] * lev.L09.n * lev.L09.dc` |  |
| `lev.L09.sw9` |  | $M | `lv.sw - lev.L09.split_sw * lev.L09.rr` |  |
| `lev.L09.cl9` |  | $M | `lv.cloud - lev.L09.split_cloud * lev.L09.rr` |  |
| `lev.L10.msp` |  | $M | `SAFEDIV(lv.sw_ms * lev.L09.sw9, lv.sw, 0)` |  |
| `lev.L10.rr` |  | $M | `lev.on['L10'] * (lev.L09.sw9 * lev.L10.shelf + lev.L10.msp * (1 - lev.L10.shelf) * lev.L10.ms + (lev.L09.sw9 - lev.L10.msp) * (1 - lev.L10.shelf) * lev.L10.ren * lev.L10.rcut)` |  |
| `lev.L10.ot` |  | $M | `lev.L10.ot_pct * lev.L10.rr` |  |
| `lev.L11.rr` |  | $M | `lev.on['L11'] * lev.L09.cl9 * lev.L11.pct` |  |
| `lev.L11.ot` |  | $M | `IF(lev.on['L11'] * lev.L11.pct > 0, lev.L11.setup, 0)` |  |
| `lev.L12.capex_saving` |  | $M | `lev.on['L12'] * lv.dc_capex * lev.L12.life` |  |
| `lev.L12.rr` |  | $M | `lev.on['L12'] * (lv.dc_maint * lev.L12.tpm * lev.L12.tpm_saving + lv.dc_colo * lev.L12.colo) + lev.L12.capex_saving` |  |
| `lev.L12.ot` |  | $M | `lev.L12.ot_pct * lev.L12.rr` |  |
| `lev.L13.rr` |  | $M | `lev.on['L13'] * lv.net * lev.L13.pct` |  |
| `lev.L13.ot` |  | $M | `lev.L13.ot_pct * lev.L13.rr` |  |
| `lev.L14.rr` |  | $M | `lev.on['L14'] * lv.euc * lev.L14.pct` |  |
| `lev.L14.ot` |  | $M | `lev.L14.ot_pct * lev.L14.rr` |  |
| `lev.L15.rr` |  | $M | `lev.on['L15'] * lv.fees_addr * lev.L15.pct` |  |
| `lev.L15.ot` |  | $M | `lev.L15.ot_pct * lev.L15.rr` |  |
| `lev.L16.pool` |  | $M | `lev.L08.ext - lev.L08.rr + lv.cons * (1 - lev.on['L02'] * lev.L02.cut) + lev.L09.sw9 - lev.L10.rr + lev.L09.cl9 - lev.L11.rr + lv.dc_maint + lv.dc_colo + lv.net + lv.euc + lv.fees` | Remaining third-party spend |
| `lev.L16.rr` |  | $M | `lev.on['L16'] * lev.L16.pool * lev.L16.pct` |  |
| `lev.L16.ot` |  | $M | `lev.L16.ot_pct * lev.L16.rr` |  |
| `lev.L17.si_avoid` |  | $M | `lev.on['L17'] * lv.ext * pool.growth['si_contingent'] * lev.L17.cola` |  |
| `lev.L17.sw_avoid` |  | $M | `lev.on['L17'] * lv.sw * pool.growth['software'] * lev.L17.sw` |  |
| `lev.L17.cl_avoid` |  | $M | `lev.on['L17'] * lv.cloud * pool.growth['cloud'] * lev.L17.cl` |  |
| `lev.L17.rr` |  | $M | `lev.L17.si_avoid + lev.L17.sw_avoid + lev.L17.cl_avoid` |  |
| `lev.L17.ot` |  | $M | `0` |  |
| `lev.rr` ★ | lever | $M | `[lever=['L01']] lev.L01.rr ; [lever=['L02']] lev.L02.rr ; [lever=['L03']] lev.L03.rr ; [lever=['L04']] lev.L04.rr ; [lever=['L05']] lev.L05.rr ; [lever=['L06']] lev.L06.rr ; [lever=['L07']] lev.L07.rr ; [lever=['L08']] lev.L08.rr ; [lever=['L09']] lev.L09.rr ; [lever=['L10']] lev.L10.rr ; [lever=['L11']] lev.L11.rr ; [lever=['L12']] lev.L12.rr ; [lever=['L13']] lev.L13.rr ; [lever=['L14']] lev.L14.rr ; [lever=['L15']] lev.L15.rr ; [lever=['L16']] lev.L16.rr ; [lever=['L17']] lev.L17.rr` | Run-rate annual saving |
| `lev.ot` ★ | lever | $M | `[lever=['L01']] lev.L01.ot ; [lever=['L02']] lev.L02.ot ; [lever=['L03']] lev.L03.ot ; [lever=['L04']] lev.L04.ot ; [lever=['L05']] lev.L05.ot ; [lever=['L06']] lev.L06.ot ; [lever=['L07']] lev.L07.ot ; [lever=['L08']] lev.L08.ot ; [lever=['L09']] lev.L09.ot ; [lever=['L10']] lev.L10.ot ; [lever=['L11']] lev.L11.ot ; [lever=['L12']] lev.L12.ot ; [lever=['L13']] lev.L13.ot ; [lever=['L14']] lev.L14.ot ; [lever=['L15']] lev.L15.ot ; [lever=['L16']] lev.L16.ot ; [lever=['L17']] lev.L17.ot` | One-time cost to achieve (before funding split) |
| `lev.eff_start` | lever | month | `MAX(1, lev.start - g.head_start)` |  |
| `lev.ramp_factor` | lever | % | `IF(13 - lev.eff_start <= lev.ramp, (13 - lev.eff_start) * (14 - lev.eff_start) / (2 * lev.ramp), (lev.ramp + 1) / 2 + (13 - lev.eff_start - lev.ramp)) / 12` | Share of run-rate realised in CY27 (linear ramp) |
| `lev.iy` ★ | lever | $M | `lev.rr * lev.ramp_factor * lev.realize` | CY27 in-year saving |
| `lev.iy_risk` | lever | $M | `lev.iy * lev.conf` | Confidence-weighted CY27 saving |
| `lev.eff` | lever,pool | $M | `[lever=['L01']] IF(pool == 'si_contingent', lev.L01.rr, 0) ; [lever=['L02']] IF(pool == 'consulting', lev.L02.rr, 0) ; [lever=['L03']] IF(pool == 'si_contingent', lev.L03.h * lv.on_cost, 0) - IF(pool == 'captive_labour', lev.L03.h * lv.gcc_cost * wf.prod_factor, 0) ; [lever=['L04']] IF(pool == 'si_contingent', lev.L04.h * lv.off_cost, 0) - IF(pool == 'captive_labour', lev.L04.h * lv.gcc_cost * lev.L04.pf, 0) ; [lever=['L05']] IF(pool == 'internal_labour', lev.L05.us_saving, 0) - IF(pool == 'captive_labour', lev.L05.gcc_added, 0) ; [lever=['L06']] IF(pool == 'si_contingent', lev.L06.si_saving, 0) - IF(pool == 'software', lev.on['L06'] * lev.L06.tool, 0) ; [lever=['L07']] IF(pool == 'si_contingent', lev.L07.rr, 0) ; [lever=['L08']] IF(pool == 'si_contingent', lev.L08.rr, 0) ; [lever=['L09']] lev.L09.rr * (IF(pool == 'software', lev.L09.split_sw, 0) + IF(pool == 'cloud', lev.L09.split_cloud, 0) + IF(pool == 'dc_hardware', 1 - lev.L09.split_sw - lev.L09.split_cloud, 0)) ; [lever=['L10']] IF(pool == 'software', lev.L10.rr, 0) ; [lever=['L11']] IF(pool == 'cloud', lev.L11.rr, 0) ; [lever=['L12']] IF(pool == 'dc_hardware', lev.L12.rr, 0) ; [lever=['L13']] IF(pool == 'network', lev.L13.rr, 0) ; [lever=['L14']] IF(pool == 'end_user', lev.L14.rr, 0) ; [lever=['L15']] IF(pool == 'airline_platforms', lev.L15.rr, 0) ; [lever=['L16']] lev.on['L16'] * lev.L16.pct * (IF(pool == 'si_contingent', lev.L08.ext - lev.L08.rr, 0) + IF(pool == 'consulting', lv.cons * (1 - lev.on['L02'] * lev.L02.cut), 0) + IF(pool == 'software', lev.L09.sw9 - lev.L10.rr, 0) + IF(pool == 'cloud', lev.L09.cl9 - lev.L11.rr, 0) + IF(pool == 'dc_hardware', lv.dc_maint + lv.dc_colo, 0) + IF(pool == 'network', lv.net, 0) + IF(pool == 'end_user', lv.euc, 0) + IF(pool == 'airline_platforms', lv.fees, 0)) ; [lever=['L17']] IF(pool == 'si_contingent', lev.L17.si_avoid, 0) + IF(pool == 'software', lev.L17.sw_avoid, 0) + IF(pool == 'cloud', lev.L17.cl_avoid, 0)` | Run-rate saving by pool touched |
| `lev.rr_check` | lever | $M | `lev.rr - SUM(p in pool, lev.eff[lever, p])` | Check: pool effects sum to run-rate (must be 0) |
| `lev.capex_rr` | lever | $M | `[lever=['L12']] lev.L12.capex_saving ; [else] SUM(p in pool, lev.eff[lever, p] * base.pool_capex_share[p])` | Capex part of run-rate saving |
| `lev.cx` | lever | % | `SAFEDIV(lev.capex_rr, lev.rr, 0)` | Capex share of lever saving |
| `lev.swb_rr` | lever | $M | `SUM(p in pool, lev.eff[lever, p] * pool.swb_flag[p] * (1 - base.pool_capex_share[p]))` | Employee-cost (SWB) opex part of run-rate saving |

## Layer: results (22 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `res.tot_rr` ★ |  | $M | `SUM(l in lever, lev.rr[l])` | Run-rate savings (exit CY27) |
| `res.tot_iy` ★ |  | $M | `SUM(l in lever, lev.iy[l])` | CY27 in-year gross savings |
| `res.tot_ot_raw` ★ |  | $M | `SUM(l in lever, lev.ot[l])` | One-time costs, all |
| `res.tot_ot_all` ★ |  | $M | `res.tot_ot_raw * g.ot_in_year` | CY27 one-time costs (AA P&L bears all) |
| `res.tot_ot_it` ★ |  | $M | `res.tot_ot_all * (1 - g.ot_out_share)` | CY27 one-time costs charged to IT |
| `res.tot_ot_out` ★ |  | $M | `res.tot_ot_all - res.tot_ot_it` | CY27 one-time costs funded outside IT |
| `res.net` ★ |  | $M | `res.tot_iy - res.tot_ot_it` | NET CY27 outlay reduction (CIO test) |
| `res.risk_gross` ★ |  | $M | `SUM(l in lever, lev.iy_risk[l])` | Confidence-weighted gross |
| `res.risk` ★ |  | $M | `res.risk_gross - res.tot_ot_it` | Risk-adjusted net |
| `res.target` ★ |  | $M | `IF(g.target_mode == 2, g.target_pct * base.total, g.target_net)` | Net target |
| `res.bar` ★ |  | $M | `res.target + g.absorb_growth * base.headwinds` | Gross bar to clear |
| `res.gap` ★ |  | $M | `res.net - res.bar` | Gap to bar (negative = shortfall) |
| `res.gap_risk` ★ |  | $M | `res.risk - res.bar` | Gap to bar, risk-adjusted |
| `res.coverage` ★ |  | % | `SAFEDIV(res.net, res.bar, 0)` | Coverage of bar |
| `res.rate_share` ★ |  | % | `SAFEDIV(lev.iy['L08'], res.net, 0)` | Rate renegotiation share of net |
| `res.cy27_outlay` ★ |  | $M | `base.total + base.headwinds - res.net` | CY27 IT outlay after program |
| `res.cy27_vs_cy26_pct` ★ |  | % | `SAFEDIV(res.cy27_outlay - base.total, base.total, 0)` | CY27 vs CY26 outlay change |
| `res.fte_us` ★ |  | FTE | `hc.us - lev.L05.h - lev.L05.r - lev.on['L05'] * hc.us * lev.L05.sl` | End-state US employees |
| `res.fte_on` ★ |  | FTE | `lev.L03.on3` | End-state onshore contractors |
| `res.fte_off` ★ |  | FTE | `lev.L04.off4` | End-state SI offshore FTE |
| `res.fte_gcc` ★ |  | FTE | `hc.gcc + lev.L03.gcc_add + lev.L04.h * lev.L04.pf + (lev.L05.h * lev.L05.bf + lev.L05.r) * wf.prod_factor` | End-state GCC |
| `res.offshore_mix` ★ |  | % | `SAFEDIV(res.fte_gcc + res.fte_off, res.fte_gcc + res.fte_off + res.fte_us + res.fte_on, 0)` | Offshore share of delivery FTE |

## Layer: pnl (19 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `pnl.o27` ★ |  | $M | `SUM(l in lever, lev.iy[l] * (1 - lev.cx[l]))` | CY27 opex savings |
| `pnl.c27` ★ |  | $M | `SUM(l in lever, lev.iy[l] * lev.cx[l])` | CY27 capex savings |
| `pnl.ot27` ★ |  | $M | `res.tot_ot_all` | CY27 one-time costs (P&L, all funding) |
| `pnl.ot27_it` ★ |  | $M | `res.tot_ot_it` | of which IT budget |
| `pnl.ot27_out` ★ |  | $M | `res.tot_ot_out` | of which outside IT |
| `pnl.e27` ★ |  | $M | `pnl.o27 - pnl.ot27` | CY27 EBITDA impact |
| `pnl.e27x` ★ |  | $M | `pnl.o27` | CY27 EBITDA if one-time = special items |
| `pnl.d27` ★ |  | $M | `pnl.c27 / g.it_dep_life * g.da_first_year_factor` | CY27 D&A relief |
| `pnl.ebit27` ★ |  | $M | `pnl.e27 + pnl.d27` | CY27 EBIT impact |
| `pnl.cash27` ★ |  | $M | `res.net` | CY27 IT-budget outlay reduction |
| `pnl.cash27_co` ★ |  | $M | `pnl.o27 + pnl.c27 - pnl.ot27` | CY27 company cash impact |
| `pnl.o28` ★ |  | $M | `SUM(l in lever, lev.rr[l] * (1 - lev.cx[l]))` | CY28 opex savings (run-rate) |
| `pnl.c28` ★ |  | $M | `SUM(l in lever, lev.rr[l] * lev.cx[l])` | CY28 capex savings (run-rate) |
| `pnl.e28` ★ |  | $M | `pnl.o28` | CY28 EBITDA impact |
| `pnl.d28` ★ |  | $M | `(pnl.c27 + g.da_first_year_factor * pnl.c28) / g.it_dep_life` | CY28 D&A relief |
| `pnl.ebit28` ★ |  | $M | `pnl.e28 + pnl.d28` | CY28 EBIT impact |
| `pnl.cash28` ★ |  | $M | `res.tot_rr` | CY28 outlay reduction |
| `pnl.swb27` ★ |  | $M | `SUM(l in lever, SAFEDIV(lev.iy[l] * lev.swb_rr[l], lev.rr[l], 0))` | CY27 savings landing in SWB |
| `pnl.swb_share27` ★ |  | % | `SAFEDIV(pnl.swb27, pnl.o27, 0)` | SWB share of CY27 opex savings |

## Layer: vp (25 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `vp.pool_usd` | vp,pool | $M | `SUM(l in line where l.pool == pool, base.line_outlay[l] * org.dom_share[l.domain, vp])` | Outlay owned by VP |
| `vp.alloc` | vp,pool | % | `SAFEDIV(vp.pool_usd, base.pool_outlay[pool], 0)` | Share of pool owned by VP |
| `vp.outlay` ★ | vp | $M | `SUM(p in pool, vp.pool_usd[vp, p])` |  |
| `vp.addressable` ★ | vp | $M | `SUM(l in line, base.line_addressable[l] * org.dom_share[l.domain, vp])` |  |
| `vp.ss_alloc` | pool | % | `SUM(u in vp, vp.alloc[u, pool] * org.ss_flag[u])` | Shared-services VP slice of pool |
| `vp.nonshared` | vp | $M | `SUM(p in pool, vp.alloc[vp, p] * base.pool_outlay[p] * (1 - pool.shared[p]))` | Non-shared spend owned (usage proxy) |
| `vp.usage_default` | vp | % | `SAFEDIV(vp.nonshared, SUM(u in vp, vp.nonshared[u]), 0)` |  |
| `vp.usage` | vp | % | `IF(org.usage_override_on == 1, org.usage_override, vp.usage_default)` | Usage key |
| `vp.eff_alloc` | vp,pool | % | `vp.alloc + g.chargeback_on * pool.shared[pool] * (vp.ss_alloc[pool] * vp.usage - org.ss_flag[vp] * vp.ss_alloc[pool])` | Effective allocation after chargeback |
| `vp.ss_shared_addr` |  | $M | `SUM(u in vp, org.ss_flag[u] * SAFEDIV(vp.addressable[u] * SUM(p in pool, vp.alloc[u, p] * base.pool_outlay[p] * pool.shared[p]), SUM(p in pool, vp.alloc[u, p] * base.pool_outlay[p]), 0))` | Shared-services addressable spend in shared pools |
| `vp.eff_addr` ★ | vp | $M | `vp.addressable + g.chargeback_on * vp.ss_shared_addr * (vp.usage - org.ss_flag[vp])` | Effective addressable (drives targets) |
| `vp.growth` ★ | vp | $M | `SUM(p in pool, base.pool_growth[p] * vp.eff_alloc[vp, p])` | VP's own CY27 cost growth |
| `vp.n_active` |  | # | `SUM(u in vp, IF(vp.eff_addr[u] > 0, 1, 0))` |  |
| `vp.target` ★ | vp | $M | `IF(g.vp_target_method == 1, SAFEDIV((res.target + SUM(u in vp, vp.growth[u])) * vp.eff_addr, SUM(u in vp, vp.eff_addr[u]), 0) - vp.growth, IF(g.vp_target_method == 2, IF(vp.eff_addr > 0, SAFEDIV(res.target, vp.n_active, 0), 0), org.manual_target))` | VP net target |
| `vp.bar` ★ | vp | $M | `vp.target + g.absorb_growth * vp.growth` | VP gross bar |
| `vp.key_share` | vp,akey | % | `[akey=['apps']] vp.eff_alloc[vp, 'si_contingent'] ; [akey=['blend']] SAFEDIV(SUM(p in pool where p.third_party == 1, vp.eff_alloc[vp, p] * base.pool_outlay[p]), SUM(p in pool where p.third_party == 1, base.pool_outlay[p]), 0) ; [else] vp.eff_alloc[vp, akey]` | VP share by allocation key |
| `vp.lever_share` | lever,vp | % | `IF(g.vp_alloc_method == 1, vp.key_share[vp, lever.alloc_key], SAFEDIV(SUM(p in pool, lev.eff[lever, p] * vp.eff_alloc[vp, p]), lev.rr[lever], 0))` | VP share of lever |
| `vp.savings` ★ | vp | $M | `SUM(l in lever, lev.iy[l] * vp.lever_share[l, vp])` |  |
| `vp.savings_risk` | vp | $M | `SUM(l in lever, lev.iy_risk[l] * vp.lever_share[l, vp])` |  |
| `vp.one_time` ★ | vp | $M | `SUM(l in lever, lev.ot[l] * vp.lever_share[l, vp]) * g.ot_in_year * (1 - g.ot_out_share)` | One-time charged to IT |
| `vp.net` ★ | vp | $M | `vp.savings - vp.one_time` |  |
| `vp.gap` ★ | vp | $M | `vp.net - vp.bar` | Gap vs VP bar |
| `vp.gap_risk` ★ | vp | $M | `vp.savings_risk - vp.one_time - vp.bar` |  |
| `vp.coverage` ★ | vp | % | `SAFEDIV(vp.net, vp.bar, 0)` |  |
| `vp.check` |  | $M | `SUM(u in vp, vp.net[u]) - res.net` | Check: VP nets sum to total (0 unless lever shares leak) |

## Layer: it_bridge (18 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `it.opex27_src` |  | $M | `IF(corp.it_override == 1, corp.cust_opex, pnl.o27)` |  |
| `it.capex27_src` |  | $M | `IF(corp.it_override == 1, corp.cust_capex, pnl.c27)` |  |
| `it.ot27_src` |  | $M | `IF(corp.it_override == 1, corp.cust_ot, pnl.ot27)` |  |
| `it.opex28_src` |  | $M | `IF(corp.it_override == 1, corp.cust_opex28, pnl.o28)` |  |
| `it.capex28_src` |  | $M | `IF(corp.it_override == 1, corp.cust_capex28, pnl.c28)` |  |
| `it.risk_factor` |  | x | `IF(AND(corp.it_risk == 1, corp.it_override == 0), SAFEDIV(res.risk_gross, res.tot_iy, 1), 1)` |  |
| `it.opex27` |  | $M | `it.opex27_src * it.risk_factor * corp.it_on` |  |
| `it.capex27` |  | $M | `it.capex27_src * it.risk_factor * corp.it_on` |  |
| `it.opex28` |  | $M | `it.opex28_src * it.risk_factor * corp.it_on` |  |
| `it.capex28` |  | $M | `it.capex28_src * it.risk_factor * corp.it_on` |  |
| `it.ot27` |  | $M | `it.ot27_src * corp.it_on` |  |
| `it.da27` |  | $M | `it.capex27 / g.it_dep_life * g.da_first_year_factor` |  |
| `it.da28` |  | $M | `it.capex27 / g.it_dep_life + it.capex28 / g.it_dep_life * g.da_first_year_factor` |  |
| `it.swb_share` |  | % | `IF(AND(corp.it_swb_mode == 1, corp.it_override == 0), pnl.swb_share27, corp.it_swb / 100)` |  |
| `it.swb27` |  | $M | `it.opex27 * it.swb_share` |  |
| `it.oth27` |  | $M | `it.opex27 - it.swb27` |  |
| `it.ot_adj` |  | $M | `IF(corp.it_ot_si == 1, 0, it.ot27)` |  |
| `it.ot_si` |  | $M | `IF(corp.it_ot_si == 1, it.ot27, 0)` |  |

## Layer: corporate (79 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `pl.asm` | year | m | `[year=['fy25']] corp.asm25 ; [else] pl.asm[year.prev] * (1 + corp.asm_g[year.in] / 100)` | ASMs |
| `pl.gap` | year | pts | `corp.gdp[year.in] - corp.gdp_ref[year.in]` | GDP gap |
| `pl.lf` | year | % | `corp.lf[year.in] + corp.lf_gdp[year.in] * pl.gap` | Load factor |
| `pl.rpm` | year | m | `pl.asm * pl.lf / 100` | RPMs |
| `pl.yield` | year | cents | `[year=['fy25']] corp.yield25 ; [else] pl.yield[year.prev] * (1 + (corp.yield_g[year.in] + corp.yield_gdp[year.in] * pl.gap) / 100)` | Yield |
| `pl.rev_pax` | year | $M | `pl.rpm * pl.yield / 100 * (1 - corp.fx_share[year.in] / 100 * corp.usd[year.in] / 100)` | Passenger revenue |
| `pl.rev_cargo` | year | $M | `[year=['fy25']] corp.cargo25 ; [else] pl.rev_cargo[year.prev] * (1 + corp.cargo_g[year.in] / 100)` | Cargo revenue |
| `pl.rev_other` | year | $M | `[year=['fy25']] corp.other25 ; [else] pl.rev_other[year.prev] * (1 + corp.other_g[year.in] / 100)` | Other revenue |
| `pl.rev` ★ | year | $M | `pl.rev_pax + pl.rev_cargo + pl.rev_other` | Total revenue |
| `pl.gpa` | year | gal/k ASM | `[year=['fy25']] corp.gpa25 ; [else] pl.gpa[year.prev] * (1 - corp.fuel_eff[year.in] / 100)` | Fuel burn |
| `pl.gal` | year | m gal | `pl.asm * pl.gpa / 1000` | Gallons |
| `pl.jet` | year | $/gal | `IF(corp.fuel_mode[year.in] == 1, (corp.brent[year.in] + corp.crack[year.in]) / 42 + corp.fuel_tax[year.in], corp.jet_direct[year.in])` | Jet fuel price |
| `pl.fuel` | year | $M | `pl.gal * pl.jet` | Fuel expense |
| `pl.wages` | year | $M | `SUM(g in lgroup, pl.lab_cost[year, g])` | Total pay |
| `pl.benefits` | year | $M | `pl.wages * corp.ben_load[year.in] / 100` | Benefits |
| `pl.it_swb` | year | $M | `0 - year.it * it.swb27` | IT program: labor savings |
| `pl.swb_xps` | year | $M | `pl.wages + pl.benefits + pl.it_swb` | SWB before profit sharing |
| `pl.ac` | year | # | `[year=['fy25']] corp.ac25 ; [else] pl.ac[year.prev] + corp.ac_add[year.in]` | Mainline aircraft |
| `pl.mxr` | year | $M | `[year=['fy25']] corp.mxr25 ; [else] pl.mxr[year.prev] * (1 + corp.mx_infl[year.in] / 100)` | Maintenance per aircraft |
| `pl.maint` | year | $M | `pl.ac * pl.mxr` | Maintenance |
| `pl.dep` | year | k | `[year=['fy25']] corp.dep25 ; [else] pl.dep[year.prev] * (1 + corp.asm_g[year.in] / 100) / (1 + corp.gauge_g[year.in] / 100)` | Departures |
| `pl.aptr` | year | $ | `[year=['fy25']] corp.aptr25 ; [else] pl.aptr[year.prev] * (1 + corp.apt_infl[year.in] / 100)` | Airport cost per departure |
| `pl.airport` | year | $M | `pl.dep * pl.aptr / 1000` | Rent & landing fees |
| `pl.leaser` | year | $k/mo | `[year=['fy25']] corp.lease_rate25 ; [else] pl.leaser[year.prev] * (1 + corp.lease_g[year.in] / 100)` | Lease rate |
| `pl.rent` | year | $M | `corp.lease_n[year.in] * pl.leaser * 12 / 1000` | Aircraft rent |
| `pl.selling` | year | $M | `pl.rev_pax * corp.sell_pct[year.in] / 100` | Selling |
| `pl.regcap` | year | x | `[year=['fy25']] 1 ; [else] pl.regcap[year.prev] * (1 + corp.reg_cap_g[year.in] / 100)` | Regional capacity index |
| `pl.regional` | year | $M | `[year=['fy25']] corp.reg25 ; [else] pl.regional[year.prev] * (1 + corp.reg_cap_g[year.in] / 100) * (1 + corp.reg_infl[year.in] / 100)` | Regional expenses |
| `pl.oth_base` | year | $M | `[year=['fy25']] corp.oth25 ; [else] pl.oth_base[year.prev] * (1 + corp.oth_vol[year.in] * corp.asm_g[year.in] / 100) * (1 + (corp.cpi[year.in] + corp.oth_prem[year.in]) / 100)` | Other opex before IT |
| `pl.it_oth` | year | $M | `0 - year.it * it.oth27` | IT program: non-labor savings |
| `pl.it_ot` | year | $M | `year.it * it.ot_adj` | IT one-time costs in adjusted results |
| `pl.other` | year | $M | `pl.oth_base + pl.it_oth + pl.it_ot` | Other opex |
| `pl.dpa` | year | $M | `[year=['fy25']] corp.dpa25 ; [else] pl.dpa[year.prev] * (1 + corp.dpa_g[year.in] / 100)` | D&A per owned aircraft |
| `pl.da_ac` | year | $M | `(pl.ac - corp.lease_n[year.in]) * pl.dpa` | Aircraft D&A |
| `pl.da_oth` | year | $M | `[year=['fy25']] corp.oda25 ; [else] pl.da_oth[year.prev] * (1 + corp.oda_g[year.in] / 100) - year.it * it.da27` | Non-aircraft D&A |
| `pl.da` | year | $M | `pl.da_ac + pl.da_oth` | D&A mainline |
| `pl.reg_da` | year | $M | `corp.reg_da25 * pl.regcap` | Regional D&A |
| `pl.opex_xps` | year | $M | `pl.fuel + pl.swb_xps + pl.regional + pl.reg_da + pl.maint + pl.airport + pl.rent + pl.selling + pl.da + pl.other` | Opex before profit sharing |
| `pl.debt_close` | year | $M | `[year=['fy25']] corp.debt_open + corp.debt_chg['fy25'] ; [else] pl.debt_close[year.prev] + corp.debt_chg[year.in]` | Debt year-end |
| `pl.debt_avg` | year | $M | `[year=['fy25']] corp.debt_open + corp.debt_chg['fy25'] / 2 ; [else] pl.debt_close[year.prev] + corp.debt_chg[year.in] / 2` | Average debt |
| `pl.rate` | year | % | `corp.fix_share[year.in] / 100 * corp.fix_rate[year.in] + (1 - corp.fix_share[year.in] / 100) * (corp.sofr[year.in] + corp.flt_spread[year.in])` | Blended rate |
| `pl.int_exp` | year | $M | `pl.debt_avg * pl.rate / 100` | Interest expense |
| `pl.cash_open` | year | $M | `[year=['fy25']] corp.cash_open ; [else] pl.cash_close[year.prev]` | Opening cash |
| `pl.int_inc` | year | $M | `pl.cash_open * (corp.sofr[year.in] + corp.cash_spread[year.in]) / 100` | Interest income |
| `pl.oth_inc` | year | $M | `corp.oth_inc[year.in]` | Other nonoperating |
| `pl.pretax_pps` | year | $M | `pl.rev - pl.opex_xps - pl.int_exp + pl.int_inc + pl.oth_inc` | Pre-tax before profit sharing |
| `pl.ps` | year | $M | `MAX(0, pl.pretax_pps) * corp.ps_rate[year.in] / 100` | Profit sharing |
| `pl.swb` | year | $M | `pl.swb_xps + pl.ps` | SWB |
| `pl.opex` | year | $M | `pl.opex_xps + pl.ps` | Opex ex special items |
| `pl.ebit` ★ | year | $M | `pl.rev - pl.opex` | Adjusted EBIT |
| `pl.op_margin` ★ | year | % | `pl.ebit / pl.rev * 100` | Adjusted operating margin |
| `pl.ebitda` ★ | year | $M | `pl.ebit + pl.da + pl.reg_da` | Adjusted EBITDA |
| `pl.ebitdar` ★ | year | $M | `pl.ebitda + pl.rent` | Adjusted EBITDAR |
| `pl.casm_x` | year | cents | `(pl.opex - pl.fuel) / pl.asm * 100` | CASM ex fuel |
| `pl.pretax` | year | $M | `pl.pretax_pps - pl.ps` | Adjusted pre-tax |
| `pl.taxx` | year | $M | `pl.pretax * corp.tax[year.in] / 100` | Tax |
| `pl.ni` ★ | year | $M | `pl.pretax - pl.taxx` | Adjusted net income |
| `pl.sh` | year | m | `corp.shares[year.in] - corp.buyback[year.in] / corp.price_now` | Diluted shares |
| `pl.eps` ★ | year | $ | `pl.ni / pl.sh` | Adjusted EPS |
| `pl.si` | year | $M | `corp.si[year.in] + year.it * it.ot_si` | Special items |
| `pl.ni_gaap` | year | $M | `pl.ni - pl.si * (1 - corp.tax[year.in] / 100)` | GAAP net income |
| `pl.eps_gaap` ★ | year | $ | `pl.ni_gaap / pl.sh` | GAAP EPS |
| `pl.cf_int` | year | $M | `0 - pl.int_exp + pl.int_inc + pl.oth_inc` | Net interest (cash) |
| `pl.cf_tax` | year | $M | `0 - MAX(0, pl.pretax) * corp.cash_tax[year.in] / 100` | Cash taxes |
| `pl.cf_si` | year | $M | `0 - pl.si` | Special items paid |
| `pl.cf_wc` | year | $M | `[year=['fy25']] corp.cal_ocf25 - (pl.ebitda + pl.cf_int + pl.cf_tax + pl.cf_si) ; [else] corp.wc[year.in]` | Working capital & other |
| `pl.ocf` | year | $M | `pl.ebitda + pl.cf_int + pl.cf_tax + pl.cf_si + pl.cf_wc` | Operating cash flow |
| `pl.cf_capex` | year | $M | `0 - corp.capex[year.in] + year.it * it.capex27` | Capex |
| `pl.cf_slb` | year | $M | `corp.slb[year.in]` | Sale-leaseback |
| `pl.cf_oi` | year | $M | `[year=['fy25']] corp.cal_fcf25 - (pl.ocf + pl.cf_capex + pl.cf_slb) ; [else] corp.oth_inv[year.in]` | Other investing |
| `pl.fcf` ★ | year | $M | `pl.ocf + pl.cf_capex + pl.cf_slb + pl.cf_oi` | Free cash flow |
| `pl.cf_of` | year | $M | `[year=['fy25']] corp.cal_cash25 - (pl.cash_open + pl.fcf + corp.debt_chg['fy25'] - corp.buyback['fy25']) ; [else] corp.oth_fin[year.in]` | Other financing |
| `pl.cash_close` | year | $M | `pl.cash_open + pl.fcf + corp.debt_chg[year.in] - corp.buyback[year.in] + pl.cf_of` | Cash year-end |
| `pl.total_debt` | year | $M | `pl.debt_close + corp.oplease[year.in] + corp.pension[year.in]` | Total debt (AA definition) |
| `pl.net_debt` ★ | year | $M | `pl.total_debt - pl.cash_close` | Net debt |
| `pl.lev` ★ | year | x | `pl.net_debt / pl.ebitdar` | Leverage |
| `pl.lab_hc` | year,lgroup | FTE | `[year=['fy25']] corp.lab_hc25[lgroup] ; [else] pl.lab_hc[year.prev, lgroup] * (1 + corp.lab_hc_g[lgroup, year.in] / 100)` |  |
| `pl.lab_rate` | year,lgroup | $k | `[year=['fy25']] corp.lab_rate25[lgroup] ; [else] pl.lab_rate[year.prev, lgroup] * (1 + corp.lab_wage_g[lgroup, year.in] / 100)` |  |
| `pl.lab_cost` | year,lgroup | $M | `pl.lab_hc * pl.lab_rate / 1000` |  |

## Layer: valuation (8 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `val.pe_valid` |  | 0/1 | `AND(pl.eps['fy27b'] > 0, pl.eps['fy27it'] > 0)` |  |
| `val.ev` | year {"year": ["fy27b", "fy27it"]} | $M | `pl.ebitdar * corp.ev_mult` |  |
| `val.eqv` | year {"year": ["fy27b", "fy27it"]} | $M | `val.ev - pl.net_debt` |  |
| `val.px_ev` | year {"year": ["fy27b", "fy27it"]} | $ | `val.eqv / pl.sh` |  |
| `val.px_pe` | year {"year": ["fy27b", "fy27it"]} | $ | `pl.eps * corp.pe` |  |
| `val.px` ★ | year {"year": ["fy27b", "fy27it"]} | $ | `IF(val.pe_valid, corp.w_pe / 100 * val.px_pe + (1 - corp.w_pe / 100) * val.px_ev, val.px_ev)` | Implied share price |
| `val.px_vs` ★ | year {"year": ["fy27b", "fy27it"]} | % | `(val.px / corp.price_now - 1) * 100` |  |
| `val.mcap` ★ | year {"year": ["fy27b", "fy27it"]} | $M | `val.px * pl.sh` |  |

## Layer: bridge (22 nodes)

| node | dims | unit | expression | label |
|---|---|---|---|---|
| `br.ebitda27` ★ |  | $M | `pl.ebitda['fy27it'] - pl.ebitda['fy27b']` | IT effect on ebitda, CY27 |
| `br.ebit27` ★ |  | $M | `pl.ebit['fy27it'] - pl.ebit['fy27b']` | IT effect on ebit, CY27 |
| `br.pretax27` ★ |  | $M | `pl.pretax['fy27it'] - pl.pretax['fy27b']` | IT effect on pretax, CY27 |
| `br.ni27` ★ |  | $M | `pl.ni['fy27it'] - pl.ni['fy27b']` | IT effect on ni, CY27 |
| `br.eps27` ★ |  | $ | `pl.eps['fy27it'] - pl.eps['fy27b']` | IT effect on eps, CY27 |
| `br.eps_gaap27` ★ |  | $ | `pl.eps_gaap['fy27it'] - pl.eps_gaap['fy27b']` | IT effect on eps_gaap, CY27 |
| `br.fcf27` ★ |  | $M | `pl.fcf['fy27it'] - pl.fcf['fy27b']` | IT effect on fcf, CY27 |
| `br.net_debt27` ★ |  | $M | `pl.net_debt['fy27it'] - pl.net_debt['fy27b']` | IT effect on net_debt, CY27 |
| `br.ps27` ★ |  | $M | `pl.ps['fy27it'] - pl.ps['fy27b']` | IT effect on ps, CY27 |
| `br.px27` ★ |  | $ | `val.px['fy27it'] - val.px['fy27b']` | IT effect on share price, CY27 |
| `br.mcap27` ★ |  | $M | `br.px27 * pl.sh['fy27it']` | IT effect on equity value, CY27 |
| `br.eps_pct27` ★ |  | % | `SAFEDIV(br.eps27, pl.eps['fy27b'], 0) * 100` |  |
| `br.int28` |  | $M | `(br.fcf27 + 0.5 * (it.opex28 + it.capex28)) * (corp.sofr['fy27'] + corp.cash_spread['fy27']) / 100` |  |
| `br.pps28` |  | $M | `it.opex28 + it.da28 + br.int28` |  |
| `br.ps28` |  | $M | `0 - br.pps28 * corp.ps_rate['fy27'] / 100` |  |
| `br.ebitda28` ★ |  | $M | `it.opex28 + br.ps28` | IT effect on EBITDA, CY28 run-rate |
| `br.pretax28` |  | $M | `br.ebitda28 + it.da28 + br.int28` |  |
| `br.ni28` ★ |  | $M | `br.pretax28 * (1 - corp.tax['fy27'] / 100)` |  |
| `br.eps28` ★ |  | $ | `br.ni28 / pl.sh['fy27it']` | IT effect on EPS, CY28 run-rate |
| `br.fcf28` |  | $M | `br.ebitda28 + br.int28 - MAX(0, br.pretax28) * corp.cash_tax['fy27'] / 100 + it.capex28` |  |
| `br.px28` ★ |  | $ | `corp.w_pe / 100 * br.eps28 * corp.pe + (1 - corp.w_pe / 100) * (br.ebitda28 * corp.ev_mult + br.fcf27 + br.fcf28) / pl.sh['fy27it']` | IT effect on share price, CY28 run-rate |
| `br.fuel_equiv_cents` ★ |  | c/gal | `br.ebitda27 / pl.gal['fy27b'] * 100` | Jet fuel change with the same EBITDA effect |

★ = output node (stored in calc_run.outputs and available to the UI).