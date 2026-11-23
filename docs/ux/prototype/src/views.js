/* Glidepath UX prototype · app modules */
const NAV = [
  ['cockpit', 'Cockpit', 'Path to the bar'], ['baseline', 'Baseline', 'Where the money is'], ['levers', 'Levers', 'Lever studio'],
  ['vps', 'VPs', 'VP targets & ownership'], ['solver', 'Path', 'Find a path'], ['market', 'Market', 'Shareholder view'],
  ['data', 'Excel', 'Excel round trip'], ['airlines', 'Airlines', 'Airlines'],
];
const DOCS = [['mood', 'Mood', 'Moodboard'], ['ia', 'Map', 'Information architecture'], ['comps', 'Parts', 'Component inventory'], ['story', 'Demo', 'Dec 4 demo storyline']];
const VIEW_ICON = { cockpit: 'cockpit', baseline: 'baseline', levers: 'levers', vps: 'vps', solver: 'solver', market: 'market', data: 'data', airlines: 'airlines', mood: 'mood', ia: 'ia', comps: 'comps', story: 'story' };
const isDoc = (v) => DOCS.some((d) => d[0] === v);

/* ---------- controls ---------- */
function slider(id, label, v, min, max, step, fmt, o = {}) {
  const p = ((v - min) / (max - min)) * 100;
  const ghosts = (o.ghosts || []).map(([k, g]) => `<span class="ghost" style="left:${((g - min) / (max - min)) * 100}%"><b>${k}</b></span>`).join('');
  return `<div class="ctl">
    <div class="ctl-h"><label class="lab" for="in-${id}">${label}${o.est ? ic('lock') : ''}</label><span class="v" data-out="${id}">${fmt(v)}</span></div>
    <div class="range ${o.est ? 'est' : ''}">${ghosts}<input type="range" id="in-${id}" data-id="${id}" min="${min}" max="${max}" step="${step}" value="${v}" style="--p:${p}%" aria-label="${esc(label)}"></div>
  </div>`;
}
function toggle(id, on, label) {
  return `<span class="tgl"><input type="checkbox" id="tg-${id}" data-tg="${id}" ${on ? 'checked' : ''} aria-label="${esc(label)}"><span></span></span>`;
}
function stepper(id, v, label) {
  return `<div class="ctl"><div class="ctl-h"><label class="lab" for="st-${id}">${label}</label></div>
    <div class="stepper"><button type="button" data-step="${id}" data-d="-50" aria-label="Decrease ${label}">−</button><input id="st-${id}" data-st="${id}" value="${v.toLocaleString('en-US')}" inputmode="numeric"><button type="button" data-step="${id}" data-d="50" aria-label="Increase ${label}">+</button></div></div>`;
}
const seg = (name, opts, cur, cls = '') => `<div class="seg ${cls}" role="group">${opts.map(([k, lab]) => `<button type="button" data-seg="${name}" data-k="${k}" aria-pressed="${k === cur}">${lab}</button>`).join('')}</div>`;

/* ---------- shell ---------- */
function shell() {
  const link = ([k, lab]) => `<a href="#${k}" data-nav="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${ic(VIEW_ICON[k])}<span>${lab}</span></a>`;
  document.getElementById('rail').innerHTML =
    `<button class="tenant-btn" type="button" data-go="airlines" title="American Airlines · switch airline">${D.tenant.code}</button>` +
    NAV.map(link).join('') + `<div class="sep"></div>` + DOCS.map(link).join('') + `<div class="grow"></div>`;
}
function topbar() {
  const [, , title] = NAV.concat(DOCS).find((n) => n[0] === S.view);
  const g = D.scenarios[S.scen];
  const tools = isDoc(S.view) ? `<span class="chip acc">Design pack</span>` :
    `${seg('scen', SCN.map(([k, l, t]) => [k, `<span class="k">${l}</span><span class="t">${t}</span>`]), S.scen)}
     <span class="edits" title="Unsaved changes in this scenario">${S.edits ? '<span class="dot"></span>' : ''}<b data-bind="edits">${S.edits}</b> edits</span>`;
  return `<header class="topbar">
    <div class="title"><span class="eyebrow">${D.tenant.name} · CY27 vs CY26</span><h1>${title}</h1></div>
    <div class="tool-row">${tools}
      <button class="search" type="button" data-palette>${ic('search')}<span>Find any number</span><span class="kbd">⌘K</span></button>
      <button class="iconbtn" type="button" data-theme title="Switch light / dark" aria-label="Switch theme">${ic('sun')}</button>
    </div></header>`;
}
function hud() {
  const el = document.getElementById('hud');
  if (S.view === 'cockpit' || isDoc(S.view)) { el.hidden = true; return; }
  el.hidden = false;
  const x = R();
  el.innerHTML = `
    <div class="cell"><span class="label">Net</span><span class="v" data-bind="net">${m(x.net)}</span>
      <span class="prog" aria-hidden="true"><i data-bind="prog" style="width:${Math.min(100, (x.net / (x.bar * 1.2)) * 100)}%"></i><b style="left:${100 / 1.2}%"></b></span></div>
    <div class="cell"><span class="label">Bar</span><span class="v" data-bind="bar">${m(x.bar)}</span></div>
    <div class="cell"><span class="label">Gap</span><span data-bind="gapchip">${gapChip(x.gap)}</span></div>
    <div class="cell hide-sm"><span class="label">Risk-adj.</span><span class="v" data-bind="risk">${m(x.risk)}</span></div>
    <div class="cell hide-sm"><span class="label">EPS 27</span><span class="v" data-bind="eps">${eps(x.eps)}</span></div>`;
}

/* ---------- Cockpit ---------- */
function vCockpit() {
  const x = R(), g = x.g, mc = { C: D.solver.monte_carlo_C, D: D.solver.monte_carlo_D }[S.scen];
  const vpTiles = VPK.map((v, i) => {
    const d = g.vp[v];
    return `<section class="glass tight c3 vp-tile" data-go="vps" style="cursor:pointer">
      <div class="spread"><span class="vp-name"><span class="sw" style="background:var(--vp${i + 1})"></span>${VPS[v]}</span><span class="faint xs num">${m(d.outlay)}</span></div>
      <div class="ring-row">${ring(d.net, d.bar, `var(--vp${i + 1})`)}
        <div class="stack" style="gap:6px"><span class="mid-num">${m(d.net)}</span><span class="faint small">of ${m(d.bar)} bar</span></div></div>
      <div>${gapChip(d.gap)}</div></section>`;
  }).join('');
  const odds = mc ? `<div class="spread"><div class="stack" style="gap:4px"><span class="big-num">${pct(mc.prob_clear_bar, 1).replace('.0%', '%')}</span><span class="faint small">chance of clearing the bar</span></div>
      <span class="chip">2,000 runs</span></div><div style="margin-top:14px">${hist(...mc.net_p10_p50_p90, mc.bar_p10_p50_p90[1])}</div>`
    : `<div class="stack" style="gap:12px"><span class="big-num faint">—</span><span class="faint small">This scenario has not been simulated.</span><button class="btn" type="button" data-toast="Simulation queued · 2,000 runs">${ic('play')}Run 2,000 trials</button></div>`;
  return `<div class="grid">
    <section class="glass pad c5">
      <div class="panel-h"><span class="label">Net savings · CY27</span><span class="chip acc">${SCN.find((s) => s[0] === S.scen)[2]}${x.edited ? ' · edited' : ''}</span></div>
      <div class="gauge-wrap"><div data-chart="gauge">${gauge(x.net, x.bar, x.target)}</div>
        <div class="gauge-center"><span class="hero-num"><span data-bind="netHero">${'$' + x.net.toFixed(1)}</span><span class="u">M</span></span>
          <span class="faint small">of <span class="ed num" data-ed="target" data-bind="bar">${m(x.bar)}</span> bar</span><span data-bind="gapchip">${gapChip(x.gap)}</span></div></div>
      <div class="stats">
        <div><span class="label">Risk-adjusted</span><span class="mid-num" data-bind="risk">${m(x.risk)}</span></div>
        <div><span class="label">2028 run-rate</span><span class="mid-num" data-bind="rr">${m(x.rr)}</span></div>
        <div><span class="label">One-time in IT</span><span class="mid-num" data-bind="otit">${m(x.otIt)}</span></div>
      </div>
    </section>
    <div class="c7 stack">
      <section class="glass pad">
        <div class="panel-h"><span class="label">CY26 → CY27 outlay</span><span class="faint xs">axis starts at $840M</span></div>
        <div data-chart="waterfall">${waterfall(x)}</div>
      </section>
      <section class="glass pad">
        <div class="panel-h"><span class="label">Your inputs</span><button class="btn ghost" type="button" data-palette style="height:30px">${ic('search')}All 194</button></div>
        <div class="hero-inputs">
          ${slider('target', 'Net target', S.target, 50, 150, 1, (v) => '$' + v + 'M')}
          ${slider('otout', 'One-time funded outside IT', S.otOut, 0, 1, 0.05, (v) => pct(v))}
          ${stepper('us', S.hc.us, 'US FTE')}${stepper('gcc', S.hc.gcc, 'GCC FTE')}${stepper('ctr', S.hc.ctr, 'Contractors')}
        </div>
      </section>
    </div>
    ${vpTiles}
    <section class="glass pad c4" data-go="market" style="cursor:pointer">
      <div class="panel-h"><span class="label">Shareholder view · 2027</span>${ic('chev', 'faint')}</div>
      <div class="row" style="gap:28px;align-items:flex-end">
        <div class="stack" style="gap:6px"><span class="faint small">EPS</span><span class="big-num" data-bind="eps">${eps(x.eps)}</span></div>
        <div class="stack" style="gap:6px"><span class="faint small">Share price</span><span class="big-num" data-bind="px">+${usd(x.px)}</span></div>
      </div>
      <div class="stats" style="grid-template-columns:1fr 1fr"><div><span class="label">EPS 2027</span><span class="num small muted">$0.465 → <span data-bind="epsTo" style="color:var(--ink)">${usd(0.465 + x.eps, 3)}</span></span></div><div><span class="label">Price</span><span class="num small muted">$11.90 → <span data-bind="pxTo" style="color:var(--ink)">${usd(11.90 + x.px)}</span></span></div></div>
      <p class="faint small" style="margin-top:14px">Same as <b class="muted">${g['br.fuel_equiv_cents'].toFixed(1)}¢</b> off every gallon of jet fuel</p>
    </section>
    <section class="glass pad c4"><div class="panel-h"><span class="label">Odds</span>${mc ? `<span class="faint xs">P50 ${m(mc.net_p10_p50_p90[1])}</span>` : ''}</div>${odds}</section>
    <section class="glass pad c4">
      <div class="panel-h"><span class="label">Fastest path to the bar</span></div>
      <div class="stack" style="gap:14px"><span class="big-num">$143.0M</span>
        <span class="faint small">15 moves · risk exposure $42.0M · no people levers</span>
        <div class="list">${[['Vendor COLA refused', '70% → 100%'], ['Software uplifts avoided', '50% → 80%'], ['Cloud growth contained', '50% → 70%']].map(([a, b], i) => `<div class="li" style="grid-template-columns:22px minmax(0,1fr) auto;padding:7px 4px"><span class="rank">0${i + 1}</span><span class="small">${a}</span><span class="num small muted">${b}</span></div>`).join('')}</div>
        <div><button class="btn primary" type="button" data-go="solver">${ic('solver')}Show me a path</button></div></div>
    </section>
  </div>`;
}

/* ---------- Baseline ---------- */
const ADDR = { locked: ['Locked', 'var(--seq-1)'], partly: ['Partly addressable', 'var(--seq-2)'], addressable: ['Addressable', 'var(--seq-3)'] };
function groupsFor(by) {
  const G = {};
  const add = (k, lab, l, amt) => { (G[k] = G[k] || { k, lab, v: 0, items: [] }); G[k].v += amt; G[k].items.push({ l, v: amt }); };
  D.lines.forEach((l) => {
    if (by === 'pool') add(l[2], D.pools.find((p) => p.id === l[2]).label, l, l[5]);
    else if (by === 'domain') add(l[3], (D.domains.find((d) => d.id === l[3]) || { label: l[3] }).label, l, l[5]);
    else VPK.forEach((v) => { const s = S.domShare[l[3] + ',' + v] || 0; if (s > 0) add(v, VPS[v], l, l[5] * s); });
  });
  return Object.values(G).sort((a, b) => b.v - a.v);
}
function treemap(by) {
  const W = 800, H = 500, groups = groupsFor(by);
  const rects = squarify(groups.map((g) => ({ v: g.v, g })), 0, 0, W, H);
  let s = '';
  rects.forEach((r) => {
    const g = r.g, pad = 2, ix = r.x + pad, iy = r.y + pad, iw = Math.max(0, r.w - 2 * pad), ih = Math.max(0, r.h - 2 * pad);
    const cells = squarify(g.items.map((it) => ({ v: it.v, it })), ix, iy, iw, ih);
    const sel = S.sel.key === g.k;
    s += `<g data-pick="${g.k}" style="cursor:pointer">`;
    cells.forEach((c) => {
      const l = c.it.l;
      s += `<rect x="${(c.x + .5).toFixed(1)}" y="${(c.y + .5).toFixed(1)}" width="${Math.max(0, c.w - 1).toFixed(1)}" height="${Math.max(0, c.h - 1).toFixed(1)}" rx="2" fill="${ADDR[l[7]][1]}" opacity="${sel || !S.sel.key ? 1 : .55}"
        ${tipAttr(`<b>${esc(l[1])}</b><br>${esc(l[4])}<br>${m(c.it.v, c.it.v < 1 ? 2 : 1)} · ${ADDR[l[7]][0]}`)}/>`;
    });
    s += `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="6" fill="none" stroke="${sel ? 'var(--ink)' : 'var(--ground)'}" stroke-width="${sel ? 2 : 1.5}" pointer-events="none"/>`;
    if (iw > 80 && ih > 40) {
      const lab = g.lab.length > iw / 7.5 ? g.lab.slice(0, Math.floor(iw / 7.5) - 1) + '…' : g.lab;
      s += `<rect x="${ix + 6}" y="${iy + 6}" width="${Math.min(iw - 12, Math.max(lab.length * 7.1, 56) + 14)}" height="${ih > 64 ? 40 : 22}" rx="8" fill="var(--ground)" opacity=".72" pointer-events="none"/>`;
      s += `<text x="${ix + 13}" y="${iy + 21}" class="t-ink" style="font:500 12px var(--f-ui)" pointer-events="none">${esc(lab)}</text>`;
      if (ih > 64) s += `<text x="${ix + 13}" y="${iy + 37}" class="t-ink2" style="font:500 11px var(--f-num)" pointer-events="none">${m(g.v)}</text>`;
    }
    s += `</g>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Treemap of CY26 IT outlay by ${by}">${s}</svg>`;
}
function vBaseline() {
  const by = S.sel.group, groups = groupsFor(by);
  if (!groups.find((g) => g.k === S.sel.key)) S.sel.key = groups[0].k;
  const g = groups.find((x) => x.k === S.sel.key);
  const tot = D.scenarios.C['base.total'], cap = D.scenarios.C['base.capex_total'];
  const byAddr = { locked: 0, partly: 0, addressable: 0 }; g.items.forEach((it) => { byAddr[it.l[7]] += it.v; });
  const top = g.items.slice().sort((a, b) => b.v - a.v);
  const growth = by === 'pool' ? D.pool_growth[g.k] : null;
  return `<div class="grid">
    <div class="c12 row wrap" style="gap:28px;padding:0 4px 4px">
      <div class="stack" style="gap:4px"><span class="label">CY26 normalized</span><span class="big-num">${m(tot)}</span></div>
      <div class="stack" style="gap:4px"><span class="label">Opex</span><span class="mid-num">${m(tot - cap)}</span></div>
      <div class="stack" style="gap:4px"><span class="label">Capex</span><span class="mid-num">${m(cap)}</span></div>
      <div class="stack" style="gap:4px"><span class="label">Locked for 2027</span><span class="mid-num">${pct(D.scenarios.C['base.locked_share'], 1)}</span></div>
      <div class="stack" style="gap:4px"><span class="label">Lines</span><span class="mid-num">${D.line_total_count} <span class="faint small">· ${D.lines.length} in scope</span></span></div>
      <div style="margin-left:auto" class="row wrap">${seg('group', [['pool', 'Cost pool'], ['domain', 'Domain'], ['vp', 'VP']], by)}</div>
    </div>
    <section class="glass pad c8">
      <div class="panel-h"><span class="label">CY26 outlay · ${by === 'vp' ? 'VP' : by === 'pool' ? 'cost pool' : 'domain'}</span>
        <div class="legend">${Object.values(ADDR).map(([l, c]) => `<span><i class="sw" style="background:${c}"></i>${l}</span>`).join('')}</div></div>
      ${treemap(by)}
    </section>
    <section class="glass pad c4">
      <div class="panel-h"><span class="label">${by === 'vp' ? 'VP' : by === 'pool' ? 'Pool' : 'Domain'}</span><span class="chip">${g.items.length} lines</span></div>
      <h2 style="font-size:22px">${esc(g.lab)}</h2>
      <div class="row" style="gap:22px;margin-top:10px;align-items:flex-end"><span class="big-num">${m(g.v)}</span>
        ${growth != null ? `<span class="faint small">growth <span class="ed num" data-ed="growth">${pct(growth, 1)}</span>/yr</span>` : ''}</div>
      <div style="margin-top:18px"><div style="display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px">
        ${Object.keys(ADDR).map((k) => `<i style="flex:${byAddr[k]};background:${ADDR[k][1]}" ${tipAttr(`${ADDR[k][0]} · ${m(byAddr[k])}`)}></i>`).join('')}</div>
        <div class="legend" style="margin-top:10px">${Object.keys(ADDR).map((k) => `<span class="num">${ADDR[k][0].split(' ')[0]} ${pct(byAddr[k] / g.v)}</span>`).join('')}</div></div>
      <div class="list" style="margin-top:16px">${top.slice(0, 7).map((it) => `<div class="li" style="grid-template-columns:minmax(0,1fr) auto"><div style="min-width:0"><div class="nm">${esc(it.l[1])}</div><div class="faint xs">${esc(it.l[4])}</div></div><span class="ed num small" data-ed="line">${m(it.v, it.v < 1 ? 2 : 1)}</span></div>`).join('')}</div>
    </section>
    <section class="glass pad c12">
      <div class="panel-h"><span class="label">Line items · ${esc(g.lab)}</span><div class="row"><span class="faint xs">Click any amount to edit</span><button class="btn" type="button" data-go="data">${ic('export')}Edit in Excel</button></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Line</th><th>Vendor</th><th>Domain</th><th>Addressability</th><th>Conf.</th><th class="r">Capex</th><th class="r">CY26 $M</th></tr></thead><tbody>
      ${top.slice(0, 9).map((it) => { const l = it.l; return `<tr><td class="ell">${esc(l[1])}</td><td class="muted ell" style="max-width:180px">${esc(l[4])}</td><td class="muted">${esc((D.domains.find((d) => d.id === l[3]) || {}).label || '')}</td>
        <td><span class="row" style="gap:8px"><i class="sw" style="background:${ADDR[l[7]][1]}"></i>${ADDR[l[7]][0]}</span></td><td class="muted">${l[8] || '–'}</td><td class="r muted">${pct(l[6])}</td><td class="r"><span class="ed num" data-ed="line">${it.v.toFixed(2)}</span></td></tr>`; }).join('')}
      </tbody></table></div>
    </section>
  </div>`;
}

/* ---------- Levers ---------- */
function monthly(x) {
  // per-family monthly savings, each lever shaped by start + ramp and scaled to its in-year value
  const fam = FAM.map(() => new Array(12).fill(0)), selArr = new Array(12).fill(0);
  FAM.forEach(([, Ls], fi) => Ls.forEach((L) => {
    const st = startOf(L), rp = Math.max(1, P0()['lev.ramp'][L]), sh = [];
    for (let mo = 1; mo <= 12; mo++) sh.push(Math.max(0, Math.min(1, (mo - st + 1) / rp)));
    const tot = sh.reduce((a, b) => a + b, 0) || 1, iy = x.lev[L].iy;
    sh.forEach((v, i) => { fam[fi][i] += iy * v / tot; if (L === S.sel.lever) selArr[i] += iy * v / tot; });
  }));
  return { fam, selArr };
}
function areaChart(x) {
  const { fam, selArr } = monthly(x), W = 300, H = 200, L = 28, T = 10, B = 22, Rr = 6;
  const totals = new Array(12).fill(0).map((_, i) => fam.reduce((a, f) => a + f[i], 0));
  const mx = Math.ceil(Math.max(...totals) / 5) * 5 || 5;
  const xs = (i) => L + (W - L - Rr) * i / 11, ys = (v) => T + (H - T - B) * (1 - v / mx);
  const cols = ['var(--seq-3)', 'var(--seq-2)', 'var(--accent)'];
  let s = '', acc = new Array(12).fill(0);
  for (let v = 0; v <= mx; v += mx / 4) s += `<line class="grid-l" x1="${L}" x2="${W - Rr}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${v.toFixed(0)}</text>`;
  fam.forEach((f, fi) => {
    const top = f.map((v, i) => acc[i] + v);
    const d = top.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join('') + acc.slice().reverse().map((v, j) => `L${xs(11 - j).toFixed(1)} ${ys(v).toFixed(1)}`).join('') + 'Z';
    s += `<path d="${d}" fill="${cols[fi]}" opacity="${fi === 2 ? .55 : .8}" stroke="var(--ground)" stroke-width="1.5" ${tipAttr(`<b>${FAM[fi][0]}</b><br>Dec ${m(f[11])}/mo`)}/>`;
    s += `<text x="${xs(11) - 4}" y="${ys(acc[11] + f[11] / 2) + 4}" text-anchor="end" class="t-ink" style="font:500 10.5px var(--f-ui)">${FAM[fi][0]}</text>`;
    acc = top;
  });
  const sd = selArr.map((v, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)}`).join('');
  s += `<path d="${sd}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="1 0"/>`;
  s += `<circle cx="${xs(11)}" cy="${ys(selArr[11])}" r="4" fill="var(--ink)" stroke="var(--ground)" stroke-width="2"/>`;
  'JFMAMJJASOND'.split('').forEach((c, i) => { s += `<text x="${xs(i)}" y="${H - 8}" text-anchor="middle">${c}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly savings in 2027 by lever family">${s}</svg>`;
}
function vLevers() {
  const x = R(), L = S.sel.lever, lib = D.levers.find((l) => l.id === L), lv = x.lev[L];
  const maxIY = Math.max(...Object.values(D.scenarios.D.levers).map((l) => l.iy));
  const list = FAM.map(([fam, Ls]) => `<div class="grp-h spread"><span class="label">${fam}</span><span class="faint xs num" data-bind="fam:${fam}">${m(Ls.reduce((a, k) => a + x.lev[k].iy, 0))}</span></div>` +
    Ls.map((k) => { const l = D.levers.find((z) => z.id === k); return `<div class="li" role="option" aria-selected="${k === L}" data-lever="${k}" style="cursor:pointer">
      ${toggle('on-' + k, isOn(k), 'Lever ' + l.label)}
      <div style="min-width:0"><div class="nm">${esc(l.label)}</div><div class="minibar"><i data-bind="bar:${k}" style="width:${(x.lev[k].iy / maxIY) * 100}%"></i></div></div>
      <span class="num small" data-bind="lev:${k}">${m(x.lev[k].iy)}</span></div>`; }).join('')).join('');
  const params = LP[L].filter((id) => D.vmeta[id]).map((id) => {
    const vm = D.vmeta[id], c = D.presets.C.values[id], d = D.presets.D.values[id];
    const ghosts = []; if (c != null) ghosts.push(['C', c]); if (d != null && d !== c) ghosts.push(['D', d]);
    return slider(id, SHORT[id] || vm.label, pv(id), vm.min, vm.max, vm.step || 0.01, (v) => fmtVal(id, v), { ghosts, est: vm.kind === 'estimate' });
  }).join('');
  const st = startOf(L), rp = P0()['lev.ramp'][L];
  const ramp = new Array(12).fill(0).map((_, i) => { const f = Math.max(0, Math.min(1, (i + 1 - st + 1) / Math.max(1, rp))); return `<i><b style="height:${f * 100}%"></b></i>`; }).join('');
  return `<div class="grid">
    <section class="glass tight c4" style="padding:10px"><div class="list" role="listbox" aria-label="Levers">${list}</div></section>
    <section class="glass pad c5">
      <div class="lever-head"><div class="row wrap"><span class="chip">${L}</span><span class="chip">${esc(lib.category)}</span><span class="chip acc">Confidence ${pct(confOf(L))}</span></div>
        <h2 style="font-size:24px;font-weight:400">${esc(lib.label)}</h2></div>
      <div class="kpis3" style="margin-top:18px">
        <div class="well"><span class="label">In-year</span><span class="big-num" data-bind="lev:${L}">${m(lv.iy)}</span></div>
        <div class="well"><span class="label">Run-rate</span><span class="mid-num" data-bind="levrr:${L}">${m(lv.rr)}</span></div>
        <div class="well"><span class="label">One-time</span><span class="mid-num" data-bind="levot:${L}">${m(lv.ot)}</span></div>
      </div>
      <div class="stack" style="gap:22px;margin-top:26px">${params}</div>
      <div style="margin-top:28px"><div class="spread" style="margin-bottom:10px"><span class="label">Timing · 2027</span>
        <span class="row small"><span class="faint">Start</span><select id="start-${L}" data-start="${L}" class="seg" style="padding:4px 8px;border-radius:10px">${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((mo, i) => `<option value="${i + 1}" ${i + 1 === st ? 'selected' : ''}>${mo}</option>`).join('')}</select><span class="faint">ramp ${rp} mo</span></span></div>
        <div class="ramp" data-chart="ramp">${ramp}</div><div class="ramp-labels">${'JFMAMJJASOND'.split('').map((c) => `<span>${c}</span>`).join('')}</div></div>
      <p class="faint small" style="margin-top:22px;max-width:60ch">${esc(lib.hypothesis.split('. ')[0])}.</p>
    </section>
    <div class="c3 stack">
      <section class="glass pad"><div class="panel-h"><span class="label">All levers · in-year</span></div>
        <div class="stack" style="gap:4px"><span class="big-num" data-bind="iy">${m(x.iy)}</span><span class="faint small">− one-time in IT <span data-bind="otit">${m(x.otIt)}</span></span></div>
        <div class="stats" style="grid-template-columns:1fr 1fr"><div><span class="label">Net</span><span class="mid-num" data-bind="net">${m(x.net)}</span></div><div><span class="label">Bar</span><span class="mid-num" data-bind="bar">${m(x.bar)}</span></div></div>
      </section>
      <section class="glass pad"><div class="panel-h"><span class="label">2027 by month</span><span class="faint xs">$M / mo</span></div><div data-chart="area">${areaChart(x)}</div>
        <p class="faint xs" style="margin-top:8px">Line: ${L}</p></section>
    </div>
  </div>`;
}

/* ---------- VPs ---------- */
function vVps() {
  const x = R(), g = x.g, out = vpOutlay();
  const cards = VPK.map((v, i) => {
    const d = g.vp[v], mx = Math.max(d.bar, d.net) * 1.15;
    return `<section class="glass pad c3">
      <div class="spread" style="min-height:26px"><span class="vp-name"><span class="sw" style="background:var(--vp${i + 1})"></span>${VPS[v]}</span>${v === 'vp_infra' ? '<span class="chip">Shared owner</span>' : ''}</div>
      <div class="stack" style="gap:4px;margin-top:16px"><span class="label">CY26 outlay</span><span class="big-num" data-bind="vpout:${v}">${m(out[v])}</span></div>
      <div style="margin:18px 0 10px;position:relative;height:12px;border-radius:6px;background:var(--track)" ${tipAttr(`Net ${m(d.net)} · bar ${m(d.bar)} · risk-adj. ${m(d.net + d.gap_risk - d.gap)}`)}>
        <i style="position:absolute;inset:0 auto 0 0;width:${(d.net / mx) * 100}%;background:var(--vp${i + 1});border-radius:6px"></i>
        <i style="position:absolute;top:-4px;bottom:-4px;left:${(d.bar / mx) * 100}%;width:2px;background:var(--ink);border-radius:2px"></i></div>
      <div class="spread small"><span class="faint">Net <b class="num" style="color:var(--ink);font-weight:500">${m(d.net)}</b></span><span class="faint">Bar <b class="num" style="color:var(--ink);font-weight:500">${m(d.bar)}</b></span></div>
      <div class="stats" style="grid-template-columns:1fr 1fr;margin-top:14px">
        <div><span class="label">Target</span><span class="num">${m(d.target)}</span><span class="faint xs">+ growth ${m(d.growth)}</span></div>
        <div><span class="label">Gap</span>${gapChip(d.gap)}</div></div>
    </section>`;
  }).join('');
  const rows = D.domains.map((dm) => {
    const amt = D.lines.filter((l) => l[3] === dm.id).reduce((a, l) => a + l[5], 0);
    const sh = VPK.map((v) => S.domShare[dm.id + ',' + v] || 0);
    let acc = 0; const hdl = [];
    for (let i = 0; i < 3; i++) { acc += sh[i]; hdl.push(`<span class="hdl" data-hdl="${dm.id}" data-i="${i}" style="left:${acc * 100}%"></span>`); }
    return `<div class="own-row"><span class="small" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(dm.label)}</span><span class="faint xs num" style="text-align:right">${m(amt)}</span>
      <div class="ownbar" data-own="${dm.id}">${sh.map((s, i) => `<i style="width:${s * 100}%;background:var(--vp${i + 1})" ${tipAttr(`${VPS[VPK[i]]} · ${pct(s)}`)}>${s >= 0.12 ? pct(s) : ''}</i>`).join('')}${hdl.join('')}</div></div>`;
  }).join('');
  const key = [0.27, 0.27, 0.14, 0.32];
  const shared = D.pools.filter((p) => D.pool_shared[p.id]);
  return `<div class="grid">
    <div class="c12 row wrap" style="gap:14px">
      <span class="label">Targets</span>${seg('tmethod', [['1', 'Proportional'], ['2', 'Equal'], ['3', 'Manual']], '1', 'sm')}
      <span class="label" style="margin-left:14px">Chargeback</span>${toggle('chargeback', true, 'Chargeback')}
      <span class="faint small" style="margin-left:auto">Bars = VP target + own cost growth</span>
    </div>
    ${cards}
    <section class="glass pad c7">
      <div class="panel-h"><span class="label">Who owns what · drag to reassign</span><div class="legend">${VPK.map((v, i) => `<span><i class="sw" style="background:var(--vp${i + 1})"></i>${VPS[v]}</span>`).join('')}</div></div>
      ${rows}
    </section>
    <div class="c5 stack">
      <section class="glass pad">
        <div class="panel-h"><span class="label">Chargeback · shared infrastructure</span><span class="chip">usage key</span></div>
        <p class="faint small" style="margin-bottom:14px">Infra's slice of shared pools is credited back to the VPs that consume it.</p>
        <div style="display:flex;height:30px;border-radius:8px;overflow:hidden;gap:2px">${key.map((k, i) => `<i style="flex:${k};background:var(--vp${i + 1});display:grid;place-items:center;font:600 11px var(--f-mono);color:#fff">${pct(k)}</i>`).join('')}</div>
        <div class="list" style="margin-top:16px">${shared.map((p) => `<div class="li" style="grid-template-columns:minmax(0,1fr) auto auto"><span class="small">${p.label}</span><span class="faint xs num">${m(D.lines.filter((l) => l[2] === p.id).reduce((a, l) => a + l[5], 0))}</span>${toggle('sh-' + p.id, true, 'Shared ' + p.label)}</div>`).join('')}</div>
      </section>
      <section class="glass pad"><div class="panel-h"><span class="label">Every VP clears?</span></div>
        <div class="stack" style="gap:10px"><span class="small muted">Optimizer with all four VP bars: <b style="color:var(--ink)">$148.1M</b>, Operations binding by $0.01M.</span>
        <div><button class="btn" type="button" data-go="solver">${ic('solver')}Open in Path</button></div></div></section>
    </div>
  </div>`;
}

/* ---------- Solver ---------- */
const MOVE_ORDER = ['lev.L17.cola', 'lev.L17.sw', 'lev.L17.cl', 'lev.L01.cut', 'lev.L01.rel', 'lev.L02.cut', 'lev.L08.cov', 'lev.L14.pct', 'lev.L11.pct', 'lev.L10.shelf', 'lev.L10.ms', 'lev.L10.rcut', 'lev.L12.tpm', 'lev.L07.pct', 'lev.L16.pct'];
function pareto() {
  const W = 360, H = 230, L = 40, B = 30, T = 12, Rr = 10, xlo = 30, xhi = 60, ylo = 100, yhi = 180;
  const xs = (v) => L + (W - L - Rr) * (v - xlo) / (xhi - xlo), ys = (v) => T + (H - T - B) * (1 - (v - ylo) / (yhi - ylo));
  const pts = [['C', 37.32, 119.3, 'var(--ink-3)'], ['Path', 42.01, 143.0, 'var(--accent)'], ['All VPs', 43.63, 148.1, 'var(--accent)'], ['D', 54.79, 166.9, 'var(--ink-3)']];
  let s = '';
  for (let v = 100; v <= 180; v += 20) s += `<line class="grid-l" x1="${L}" x2="${W - Rr}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${v}</text>`;
  for (let v = 30; v <= 60; v += 10) s += `<text x="${xs(v)}" y="${H - 10}" text-anchor="middle">${v}</text>`;
  s += `<line class="ref" x1="${L}" x2="${W - Rr}" y1="${ys(142.98)}" y2="${ys(142.98)}"/><text x="${W - Rr}" y="${ys(142.98) - 6}" text-anchor="end" class="t-ink2">Bar 143</text>`;
  s += `<path d="M${xs(33)} ${ys(106)} C ${xs(37)} ${ys(128)}, ${xs(41)} ${ys(140)}, ${xs(44)} ${ys(150)} S ${xs(52)} ${ys(166)}, ${xs(58)} ${ys(174)}" fill="none" stroke="var(--accent)" stroke-width="2" opacity=".5" stroke-dasharray="5 4"/>`;
  pts.forEach(([k, x, y, c]) => { const left = k === 'Path'; s += `<circle cx="${xs(x)}" cy="${ys(y)}" r="6" fill="${c}" stroke="var(--ground)" stroke-width="2" ${tipAttr(`<b>${k}</b><br>Net ${m(y)} · risk ${m(x)}`)}/><text x="${xs(x) + (left ? -10 : 10)}" y="${ys(y) + (left ? 16 : 4)}" text-anchor="${left ? 'end' : 'start'}" class="t-ink">${k}</text>`; });
  s += `<text x="${L}" y="${H - 10}" text-anchor="start" style="display:none"></text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net savings versus risk exposure">${s}</svg>`;
}
function tornado() {
  const W = 360, rowH = 22, L = 150, H = D.tornado.length * rowH + 6, mx = 40;
  let s = '';
  D.tornado.forEach(([id, sw], i) => {
    const y = i * rowH + 3, w = (W - L - 40) * sw / mx;
    s += `<text x="${L - 10}" y="${y + 14}" text-anchor="end" class="t-ink2" style="font:500 11.5px var(--f-ui)">${esc(SHORT[id] || id)}</text>`;
    s += `<rect x="${L}" y="${y + 3}" width="${w}" height="14" rx="4" fill="${i < 3 ? 'var(--warn)' : 'var(--seq-3)'}" opacity=".9" ${tipAttr(`${esc(SHORT[id] || id)}<br>swing <b>${m(sw)}</b>`)}/>`;
    s += `<text x="${L + w + 6}" y="${y + 14}">${sw.toFixed(1)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tornado of net savings swing by input">${s}</svg>`;
}
function vSolver() {
  const r = D.solver.min_risk_total_bar, mv = r.inputs_moved_from_C;
  const moves = MOVE_ORDER.filter((k) => mv[k]).map((k, i) => {
    const vm = D.vmeta[k], a = mv[k].from, b = mv[k].to, lo = vm.min, hi = vm.max, p = (v) => ((v - lo) / (hi - lo)) * 100;
    return `<div class="move"><span class="rank">${String(i + 1).padStart(2, '0')}</span><span class="small" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(SHORT[k] || vm.label)}</span>
      <span class="mv-track"><s style="left:${p(a)}%"></s><i style="left:${p(a)}%;width:${p(b) - p(a)}%"></i><b style="left:${p(b)}%"></b></span>
      <span class="num small" style="text-align:right"><span class="faint">${fmtVal(k, a)}</span> → ${fmtVal(k, b)}</span></div>`;
  }).join('');
  const C = D.solver.monte_carlo_C, Dd = D.solver.monte_carlo_D;
  return `<div class="grid">
    <section class="glass pad c4">
      <div class="panel-h"><span class="label">Goal</span></div>
      <div class="row" style="align-items:flex-end;gap:10px"><span class="big-num ed" data-ed="target">$143.0M</span><span class="faint small" style="padding-bottom:4px">net, CY27</span></div>
      <div class="label" style="margin:22px 0 8px">Optimise for</div>
      <div class="stack" style="gap:2px">${[['risk', 'Lowest delivery risk', true], ['radj', 'Most risk-adjusted savings'], ['ot', 'Least one-time cost'], ['ppl', 'Fewest people moves'], ['chg', 'Smallest change from plan']]
        .map(([k, l, c]) => `<label class="radio-card"><input type="radio" name="obj" value="${k}" ${c ? 'checked' : ''}>${l}</label>`).join('')}</div>
      <div class="label" style="margin:22px 0 8px">Hold to</div>
      <div class="list">${[['Every VP clears its own bar', false], ['US headcount ≥ 2,692', true], ['One-time in IT ≤ $20M', true], ['No lever past full stretch', true], ['Estimates stay fixed', true, true]]
        .map(([l, on, lock], i) => `<div class="li" style="grid-template-columns:minmax(0,1fr) auto"><span class="small">${l}${lock ? ' ' + ic('lock', 'faint') : ''}</span>${toggle('cons' + i, on, l)}</div>`).join('')}</div>
      <div class="row wrap" style="margin-top:20px"><button class="btn primary" type="button" data-solve>${ic('spark')}Find a path</button><button class="btn" type="button" data-toast="Blend C → D: bar cleared at 49% of the way">Blend C → D</button></div>
    </section>
    <section class="glass pad c8">
      <div class="panel-h"><span class="label">Path found · lowest risk</span><span class="faint xs">${r.evaluations.toLocaleString('en-US')} evaluations · ${r.steps} steps</span></div>
      <div class="row wrap" style="gap:34px;align-items:flex-end">
        <div class="stack" style="gap:6px"><span class="hero-num" style="font-size:56px">$143.0<span class="u">M</span></span><span class="chip pos" style="align-self:flex-start">${ic('check')}Bar cleared</span></div>
        <div class="stack" style="gap:4px"><span class="label">Risk exposure</span><span class="mid-num">${m(r.risk_exposure)}</span><span class="faint xs">C: $37.3M · D: $54.8M</span></div>
        <div class="stack" style="gap:4px"><span class="label">One-time in IT</span><span class="mid-num">${m(r.one_time_it)}</span></div>
        <div class="stack" style="gap:4px"><span class="label">US headcount</span><span class="mid-num">${r.fte_us.toLocaleString('en-US')}</span><span class="faint xs">unchanged</span></div>
        <div class="stack" style="gap:4px"><span class="label">EPS 27</span><span class="mid-num">${eps(r.eps27)}</span></div>
      </div>
      <div class="spread" style="margin:24px 0 6px"><span class="label">Moves from C, most valuable first</span><span class="faint xs">grey tick = C</span></div>
      <div>${moves}</div>
      <div class="row wrap" style="margin-top:18px"><button class="btn primary" type="button" data-toast="Saved as scenario · Path to 143">${ic('check')}Save as scenario</button><button class="btn" type="button" data-toast="Comparing Path vs C">Compare with C</button></div>
    </section>
    <section class="glass pad c4"><div class="panel-h"><span class="label">Savings vs risk</span><span class="faint xs">$M</span></div>${pareto()}<p class="faint xs" style="margin-top:6px">Dashed line: frontier sketch between solved points</p></section>
    <section class="glass pad c4"><div class="panel-h"><span class="label">Odds of clearing</span><span class="faint xs">2,000 runs each</span></div>
      <div class="row" style="gap:28px"><div class="stack" style="gap:2px"><span class="faint small">Balanced</span><span class="big-num">${pct(C.prob_clear_bar)}</span></div><div class="stack" style="gap:2px"><span class="faint small">Full stretch</span><span class="big-num">${pct(Dd.prob_clear_bar, 1)}</span></div></div>
      <div style="margin-top:10px">${hist(...Dd.net_p10_p50_p90, Dd.bar_p10_p50_p90[1], { h: 110 })}</div><p class="faint xs">Full stretch shown. Delivery weighted by lever confidence.</p></section>
    <section class="glass pad c4"><div class="panel-h"><span class="label">What moves net most</span><span class="faint xs">swing $M</span></div>${tornado()}<p class="faint xs" style="margin-top:8px">Amber: policy and timing, not levers</p></section>
  </div>`;
}

/* ---------- Market (corporate) ---------- */
const KN = {
  brent: { lab: 'Brent', unit: '$/bbl', v: 85.78, min: 50, max: 130, step: 1, f: (v) => '$' + v.toFixed(0), eps: -0.1242 },
  crack: { lab: 'Jet crack', unit: '$/bbl', v: 59.12, min: 20, max: 90, step: 1, f: (v) => '$' + v.toFixed(0), eps: -0.1242 },
  gdp: { lab: 'US GDP', unit: '%', v: 2.0, min: -3, max: 5, step: 0.1, f: (v) => v.toFixed(1) + '%', eps: 0.62 },
  wage: { lab: 'Labor pay', unit: '% raise', v: 3.6, min: 0, max: 10, step: 0.1, f: (v) => v.toFixed(1) + '%', eps: -0.23 },
  fleet: { lab: 'Aircraft added', unit: '#', v: 25, min: 0, max: 60, step: 1, f: (v) => v.toFixed(0), eps: 0.004 },
  sofr: { lab: 'SOFR', unit: '%', v: 3.4, min: 0, max: 7, step: 0.1, f: (v) => v.toFixed(1) + '%', eps: -0.015 },
};
const KS = {}; Object.keys(KN).forEach((k) => { KS[k] = KN[k].v; });
let MULT = 7.393;
function corp() {
  const x = R();
  let dE = 0; Object.keys(KN).forEach((k) => { dE += (KS[k] - KN[k].v) * KN[k].eps; });
  const base = 0.465 + dE, withIT = base + x.eps;
  const dEbitdar = dE * 665 / 0.75;
  const pxBase = 11.90 + (dEbitdar * MULT) / 665 + (MULT - 7.393) * 5457 / 665;
  return { x, base, withIT, pxBase, pxIT: pxBase + x.px * MULT / 7.393 };
}
function knob(k) {
  const d = KN[k], p = (KS[k] - d.min) / (d.max - d.min), A0 = Math.PI * 0.75, SW = Math.PI * 1.5, a = A0 + SW * p;
  const [hx, hy] = polar(48, 48, 30, a), pd = (KN[k].v - d.min) / (d.max - d.min), [gx, gy] = polar(48, 48, 40, A0 + SW * pd), [gx2, gy2] = polar(48, 48, 34, A0 + SW * pd);
  return `<div class="knob" data-knob="${k}"><svg viewBox="0 0 96 96" role="slider" tabindex="0" aria-label="${d.lab}" aria-valuenow="${KS[k]}" aria-valuemin="${d.min}" aria-valuemax="${d.max}">
    <path d="${arc(48, 48, 37, A0, A0 + SW)}" stroke="var(--track)" stroke-width="5" fill="none" stroke-linecap="round"/>
    <path d="${arc(48, 48, 37, A0, Math.max(A0 + 0.001, a))}" stroke="var(--accent)" stroke-width="5" fill="none" stroke-linecap="round"/>
    <line x1="${gx}" y1="${gy}" x2="${gx2}" y2="${gy2}" stroke="var(--ink-3)" stroke-width="2"/>
    <circle cx="48" cy="48" r="24" fill="var(--glass-2)" stroke="var(--glass-line)"/>
    <circle cx="${hx}" cy="${hy}" r="4.5" fill="#fff" style="filter:drop-shadow(0 0 4px var(--accent-glow))"/></svg>
    <span class="kv" data-kv="${k}">${d.f(KS[k])}</span><span class="faint xs">${d.lab}</span></div>`;
}
function epsBars(c) {
  const vals = [['FY25A', 0.36], ['FY26E', -0.75], ['FY27E base', c.base], ['FY27E + IT', c.withIT]];
  const W = 420, H = 270, L = 40, T = 20, B = 30, lo = -1, hi = 1;
  const ys = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo)), bw = 56, gp = (W - L - 4 * bw) / 4.5;
  let s = '';
  [-1, -0.5, 0, 0.5, 1].forEach((v) => { s += `<line class="grid-l" x1="${L}" x2="${W}" y1="${ys(v)}" y2="${ys(v)}" ${v === 0 ? 'style="stroke:var(--ink-3);opacity:.5"' : ''}/><text x="${L - 6}" y="${ys(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`; });
  vals.forEach(([k, v], i) => {
    const x0 = L + gp * .6 + i * (bw + gp), y0 = ys(Math.max(0, v)), h = Math.abs(ys(v) - ys(0));
    const col = i === 3 ? 'var(--accent)' : 'var(--seq-2)';
    s += `<rect x="${x0}" y="${y0}" width="${bw}" height="${Math.max(2, h)}" rx="4" fill="${col}" ${tipAttr(`${k}<br><b>${usd(v)}</b>`)}/>`;
    s += `<text x="${x0 + bw / 2}" y="${v >= 0 ? y0 - 7 : y0 + h + 14}" text-anchor="middle" class="t-ink" style="font:500 12px var(--f-num)">${usd(v)}</text>`;
    s += `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle">${k}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Adjusted EPS by year">${s}</svg>`;
}
function traceNodes(x) {
  const g = x.g;
  return [
    ['net', 'IT net savings', m(x.net), 'Cash test vs CY26'],
    ['opex', 'P&L opex saved', m(g['pnl.o27']), 'opex lines only'],
    ['ot', 'One-time', sm(-g['res.tot_ot_all']), 'P&L bears all of it'],
    ['ebitda', 'EBITDA', sm(g['br.ebitda27']), 'after profit sharing'],
    ['eps', 'EPS', eps(x.eps), '+' + g['br.eps_pct27'].toFixed(1) + '% vs base'],
    ['px', 'Share price', '+' + usd(x.px), 'EV / EBITDAR ' + MULT.toFixed(2) + '×'],
    ['mcap', 'Market cap', sm(x.mcap, 0), '665m shares'],
  ];
}
function vMarket() {
  const c = corp(), x = c.x;
  const nodes = traceNodes(x).map(([k, l, v, n], i) => `${i ? `<span class="tlink">${ic('arrow')}</span>` : ''}<button type="button" class="tnode ${S.sel.node === k ? 'hl' : ''}" data-node="${k}"><span class="label">${l}</span><span class="mid-num">${v}</span><span class="faint xs">${n}</span></button>`).join('');
  return `<div class="grid">
    <section class="glass pad c12">
      <div class="panel-h"><span class="label">From IT savings to share price · 2027</span><button class="btn ghost" type="button" data-trace style="height:30px">${ic('trace')}Show formulas</button></div>
      <div class="trace">${nodes}</div>
    </section>
    <section class="glass pad c5">
      <div class="panel-h"><span class="label">Drivers · FY27</span><button class="btn ghost" type="button" data-knobreset style="height:30px">${ic('undo')}Reset</button></div>
      <div class="knobs">${Object.keys(KN).map(knob).join('')}</div>
      <div class="spread" style="margin-top:18px;border-top:1px solid var(--hair);padding-top:16px"><span class="small muted">Valuation multiple</span>
        <div class="row">${seg('val', [['ev', 'EV / EBITDAR'], ['pe', 'P / E']], 'ev', 'sm')}<span class="num ed" data-ed="mult">${MULT.toFixed(2)}×</span></div></div>
    </section>
    <section class="glass pad c4">
      <div class="panel-h"><span class="label">Adjusted EPS</span><span class="faint xs">$ / share</span></div>
      <div data-chart="eps">${epsBars(c)}</div>
    </section>
    <section class="glass pad c3">
      <div class="panel-h"><span class="label">Share price</span></div>
      <div class="stack" style="gap:16px">
        <div class="stack" style="gap:4px"><span class="faint small">Without IT program</span><span class="big-num" data-bind="pxbase">${usd(c.pxBase)}</span></div>
        <div class="stack" style="gap:4px"><span class="faint small">With IT program</span><span class="big-num" style="color:var(--accent)" data-bind="pxit">${usd(c.pxIT)}</span></div>
        <p class="faint small" style="border-top:1px solid var(--hair);padding-top:14px">The program is worth <b class="muted">${x.g['br.fuel_equiv_cents'].toFixed(1)}¢</b> a gallon of jet fuel.</p>
      </div>
    </section>
  </div>`;
}

/* ---------- Data (Excel round trip) ---------- */
const DIFFS = [
  ['Levers', 'L08 · Headline rate cut', '5%', '7%', '5%', 'ok'],
  ['Levers', 'L17 · Vendor COLA refused', '70%', '90%', '70%', 'ok'],
  ['Levers', 'L09 · Apps retired', '170', '200', '170', 'ok'],
  ['Lever_Timing', 'L05 · Start month', 'Jan', 'Mar', 'Jan', 'ok'],
  ['Workforce', 'Contractors onshore', '35%', '30%', '35%', 'ok'],
  ['Org_Map', 'Data & analytics · Commercial', '35%', '40%', '35%', 'ok'],
  ['Org_Map', 'Data & analytics · Corporate', '30%', '25%', '30%', 'ok'],
  ['Targets', 'One-time funded outside IT', '50%', '60%', '40%', 'conflict'],
  ['Line_Items', 'New · Observability tooling (example)', '—', '$1.20M', '—', 'new'],
];
function vData() {
  const sheets = ['README', 'Targets', 'Workforce', 'Pools', 'Levers', 'Lever_Timing', 'Org_Map', 'Line_Items', 'Corporate', 'Overrides', 'Outputs'];
  return `<div class="grid">
    <section class="glass pad c4">
      <div class="panel-h"><span class="label">Export</span><span class="chip">template v1.0</span></div>
      <div class="stack" style="gap:16px">
        <div><div class="label" style="margin-bottom:8px">Scenarios</div>${seg('xs', [['C', 'C'], ['D', 'D'], ['CD', 'C + D'], ['all', 'All five']], 'CD', 'sm')}</div>
        <div><div class="label" style="margin-bottom:8px">Sheets</div><div class="sheet-chips">${sheets.map((s) => `<span class="chip">${s}</span>`).join('')}</div></div>
        <div class="drop" style="border-style:solid"><span class="file-ic">${ic('file')}</span><div style="min-width:0"><div class="small ell" style="max-width:100%">aa_it_savings_C-D_20261204-0930.xlsx</div><div class="faint xs">Yellow cells are editable · rows keyed, not positional</div></div></div>
        <button class="btn primary" type="button" data-toast="Workbook exported · snapshot saved for diff">${ic('export')}Export workbook</button>
      </div>
    </section>
    <section class="glass pad c8">
      <div class="panel-h"><span class="label">Import review · example file</span><div class="row wrap"><span class="chip">${DIFFS.length} changes</span><span class="chip warn">1 conflict</span><span class="chip pos">0 errors</span></div></div>
      <div class="drop"><span class="file-ic">${ic('import')}</span><div style="min-width:0;flex:1"><div class="small">aa_it_savings_C-D_20261204-0930 · MD edits.xlsx</div><div class="faint xs">Exported 4 Dec 09:30 · compared three ways: export, file, app now</div></div><button class="btn ghost" type="button">Replace</button></div>
      <div class="tbl-wrap" style="margin-top:16px"><table class="tbl"><thead><tr><th>Sheet</th><th>Item</th><th class="r">Exported</th><th class="r">In file</th><th class="r">App now</th><th>Take</th></tr></thead><tbody>
      ${DIFFS.map(([sh, it, a, b, c, st], i) => `<tr><td class="muted">${sh}</td><td>${esc(it)}</td><td class="r faint">${a}</td><td class="r" style="color:var(--accent)">${b}</td><td class="r ${st === 'conflict' ? '' : 'faint'}" ${st === 'conflict' ? 'style="color:var(--warn)"' : ''}>${c}</td>
        <td>${st === 'conflict' ? seg('cf' + i, [['f', 'File'], ['a', 'App']], 'f', 'sm') : `<span class="row" style="gap:8px">${toggle('acc' + i, true, 'Accept ' + it)}${st === 'new' ? '<span class="chip acc">new line</span>' : ''}</span>`}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="spread" style="margin-top:18px;flex-wrap:wrap"><span class="faint small">Org_Map rows still sum to 100% · validation VR01–VR10 passed</span>
        <div class="row"><button class="btn" type="button">Preview impact</button><button class="btn primary" type="button" data-toast="9 changes applied as one changeset · undo any time">${ic('check')}Apply as changeset</button></div></div>
    </section>
  </div>`;
}

/* ---------- Airlines (multi-tenant) ---------- */
function vAirlines() {
  const steps = [['Tenant record', 'done'], ['Baseline lines (outside-in)', 'done'], ['Org & domain ownership', 'done'], ['Workforce & rates', 'done'], ['Vendors', 'now'], ['Corporate drivers · calibrate to 10-K', ''], ['Target & funding', ''], ['Scenarios from presets', ''], ['Sources & confidence', '']];
  const tile = (code, name, status, chip, body, active) => `<section class="glass pad c3 tenant" ${active ? 'style="box-shadow:inset 0 1px 0 var(--glass-hi),0 0 0 1px var(--accent),var(--shadow)"' : ''}>
    <div class="spread"><span class="monogram">${code}</span>${chip}</div>
    <div><h3 style="font-size:18px">${name}</h3><p class="faint small" style="margin-top:4px">${status}</p></div><div class="stack" style="gap:8px;margin-top:auto">${body}</div></section>`;
  return `<div class="grid">
    ${tile('AA', 'American Airlines', 'Live · model v1.0', '<span class="chip pos">' + ic('check') + 'Live</span>', `<span class="small muted">415 lines · 4 VPs · 5 scenarios</span><span class="small muted">Parity 245 / 245</span>`, true)}
    ${tile('UA', 'United Airlines', 'Draft · example onboarding', '<span class="chip warn">4 of 9</span>', `<div class="minibar" style="height:5px"><i style="width:44%"></i></div><button class="btn" type="button">Continue setup</button>`)}
    ${tile('AS', 'Alaska Airlines', 'Not started', '<span class="chip">New</span>', `<button class="btn" type="button" data-toast="AI plan drafted · review the changeset before anything is written">${ic('spark')}Set up with AI</button>`)}
    <section class="glass pad c3 tenant" style="border-style:dashed;align-items:flex-start;justify-content:center"><span class="monogram">${ic('plus').replace('<svg', '<svg style="width:22px;height:22px;stroke:var(--ink);fill:none;stroke-width:1.6"')}</span><h3 style="font-size:18px">Add an airline</h3><p class="faint small">Describe it. The AI drafts every input with a source, then waits for your review.</p></section>
    <section class="glass pad c7">
      <div class="panel-h"><span class="label">Reconfigure with AI</span><span class="chip">nothing is written until you accept</span></div>
      <div class="prompt"><input id="ai-prompt" value="Set up Alaska Airlines for CY27, target 10% of base" aria-label="Describe the airline to set up"><button class="btn primary" type="button" data-toast="Plan → validate → changeset">${ic('spark')}Draft</button></div>
      <div class="row wrap" style="margin-top:22px;gap:10px">${['Plan members & values', 'Validate · ties to 10-K within 1%', 'Review one changeset', 'Apply · revert any time'].map((s, i) => `<span class="chip ${i === 0 ? 'acc' : ''}">${String(i + 1)} · ${s}</span>`).join('')}</div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><span class="label">Global</span><span class="small muted">Formulas, 17 levers, 11 pools, solvers, Excel template</span></div><div><span class="label">Per airline</span><span class="small muted">Lines, org, vendors, headcount, corporate drivers</span></div><div><span class="label">Upgrades</span><span class="small muted">Pinned per airline; golden tests before and after</span></div></div>
    </section>
    <section class="glass pad c5">
      <div class="panel-h"><span class="label">United · onboarding · example</span><span class="faint xs">4 of 9</span></div>
      <div class="steps">${steps.map(([s, st]) => `<div class="step"><span class="st-ic ${st}">${st === 'done' ? ic('check') : ''}</span><span>${s}</span><span class="faint xs">${st === 'done' ? 'Done' : st === 'now' ? 'In review' : ''}</span></div>`).join('')}</div>
    </section>
  </div>`;
}
