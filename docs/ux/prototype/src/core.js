/* Glidepath UX prototype · core: state, derived numbers, formatting, chart primitives.
   Scenario values are the engine's golden results (exact). Live edits use the exact
   identities where the spec gives them (net = in-year − one-time × (1 − outside share);
   gap = net − bar; VP outlay = Σ line × domain share) and simple proportional estimates
   for lever sliders until the real engine is wired in. */
const D = window.__DATA__;
const VPK = ['vp_commercial', 'vp_operations', 'vp_corporate', 'vp_infra'];
const VPS = { vp_commercial: 'Commercial', vp_operations: 'Operations', vp_corporate: 'Corporate', vp_infra: 'Infra & Other' };
const SCN = [['rates', 'R', 'Rates only'], ['A', 'A', 'Commercial'], ['B', 'B', 'Op-model reset'], ['C', 'C', 'Balanced'], ['D', 'D', 'Full stretch']];
const FAM = [
  ['Labour', ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08']],
  ['Technology', ['L09', 'L10', 'L11', 'L12', 'L13', 'L14']],
  ['Platforms & avoidance', ['L15', 'L16', 'L17']],
];
const LP = {
  L01: ['lev.L01.cut', 'lev.L01.rel', 'lev.L01.ot_pct'], L02: ['lev.L02.cut'], L03: ['lev.L03.pct', 'lev.L03.tc'],
  L04: ['lev.L04.pct', 'lev.L04.tc', 'lev.L04.pf'], L05: ['lev.L05.nb', 'lev.L05.bf', 'lev.L05.sl', 'lev.L05.rel', 'lev.L05.vac', 'lev.L05.sev'],
  L06: ['lev.L06.gain', 'lev.L06.cap', 'lev.L06.tool'], L07: ['lev.L07.pct', 'lev.L07.diff', 'lev.L07.ot_pct'],
  L08: ['lev.L08.cov', 'lev.L08.cut', 'lev.L08.leak'], L09: ['lev.L09.n', 'lev.L09.dc'],
  L10: ['lev.L10.shelf', 'lev.L10.ms', 'lev.L10.rcut', 'lev.L10.ren'], L11: ['lev.L11.pct', 'lev.L11.setup'],
  L12: ['lev.L12.tpm', 'lev.L12.life', 'lev.L12.colo', 'lev.L12.tpm_saving'], L13: ['lev.L13.pct', 'lev.L13.ot_pct'],
  L14: ['lev.L14.pct'], L15: ['lev.L15.pct'], L16: ['lev.L16.pct'], L17: ['lev.L17.cola', 'lev.L17.sw', 'lev.L17.cl'],
};
const SHORT = {
  'lev.L01.cut': 'SI change portfolio cut', 'lev.L01.rel': 'Run-side capacity released', 'lev.L01.ot_pct': 'One-time (PMO)',
  'lev.L02.cut': 'Consulting spend cut', 'lev.L03.pct': 'Onshore roles relocated', 'lev.L03.tc': 'Transition cost / role',
  'lev.L04.pct': 'SI offshore → GCC', 'lev.L04.tc': 'Conversion cost / head', 'lev.L04.pf': 'GCC productivity',
  'lev.L05.nb': 'US leavers not backfilled', 'lev.L05.bf': '…backfilled in GCC', 'lev.L05.sl': 'Spans & layers', 'lev.L05.rel': 'Targeted relocation',
  'lev.L05.vac': 'Vacancy harvest', 'lev.L05.sev': 'Severance multiple', 'lev.L06.gain': 'AI productivity gain', 'lev.L06.cap': 'Captured in price',
  'lev.L06.tool': 'AI tooling run cost', 'lev.L07.pct': 'Tail SI → panel', 'lev.L07.diff': 'Panel rate advantage', 'lev.L07.ot_pct': 'Transition one-time',
  'lev.L08.cov': 'SI spend reopened', 'lev.L08.cut': 'Headline rate cut', 'lev.L08.leak': 'Vendor leakage', 'lev.L09.n': 'Apps retired',
  'lev.L09.dc': 'Decommission cost / app', 'lev.L10.shelf': 'Shelfware harvested', 'lev.L10.ms': 'Microsoft optimisation', 'lev.L10.rcut': 'Renewal saving',
  'lev.L10.ren': 'Share renewing in 2027', 'lev.L11.pct': 'Cloud cost reduction', 'lev.L11.setup': 'FinOps one-time', 'lev.L12.tpm': 'Maintenance → TPM',
  'lev.L12.life': 'Refresh deferred', 'lev.L12.colo': 'Colo consolidation', 'lev.L12.tpm_saving': 'TPM saving rate', 'lev.L13.pct': 'Network reduction',
  'lev.L13.ot_pct': 'SD-WAN one-time', 'lev.L14.pct': 'End-user reduction', 'lev.L15.pct': 'Platform volume & tiers', 'lev.L16.pct': 'Invoice & rebate recovery',
  'lev.L17.cola': 'Vendor COLA refused', 'lev.L17.sw': 'Software uplifts avoided', 'lev.L17.cl': 'Cloud growth contained',
  'g.ot_out_share': 'One-time funded outside IT', 'g.ot_in_year': 'One-time incurred in CY27', 'g.head_start': 'Head start (months)',
  'portfolio.app_cost': 'App run cost', 'hc.ctr': 'Contractor headcount', 'hc.us': 'US headcount', 'g.target_net': 'Net target',
};

const S = {
  scen: 'C', view: 'cockpit', edits: 0,
  target: 100, otOut: 0.5, hc: { us: 3000, gcc: 900, ctr: 800 },
  lev: {},            // per-scenario param overrides: {id: value}
  on: {}, start: {},  // lever on/off + start overrides
  domShare: Object.assign({}, D.dom_share),
  sel: { group: 'pool', key: 'internal_labour', lever: 'L10', node: 'eps' },
};
const P0 = () => D.presets[S.scen].values;
const pv = (id) => (id in S.lev ? S.lev[id] : (id in P0() ? P0()[id] : D.vmeta[id] && D.vmeta[id].def));
const pv0 = (id) => (id in P0() ? P0()[id] : D.vmeta[id] && D.vmeta[id].def);
const isOn = (L) => (L in S.on ? S.on[L] : (P0()['lev.on'] ? P0()['lev.on'][L] !== 0 : true));
const startOf = (L) => (L in S.start ? S.start[L] : P0()['lev.start'][L]);
const confOf = (L) => P0()['lev.conf'][L];

/* lever in-year estimate under edits (exact when nothing is edited) */
function leverIY(L) {
  const g = D.scenarios[S.scen].levers[L];
  if (!isOn(L)) return { iy: 0, ot: 0, rr: 0 };
  let k = 1;
  const decs = LP[L].filter((id) => D.vmeta[id] && D.vmeta[id].kind === 'decision');
  if (decs.length) {
    let s = 0;
    decs.forEach((id) => { const a = pv0(id), b = pv(id); s += a > 0 ? b / a : (b > 0 ? 1.4 : 1); });
    k = s / decs.length;
  }
  const r0 = P0()['lev.ramp'][L], s0 = P0()['lev.start'][L], s1 = startOf(L);
  const act = (s) => Math.max(0.0001, 12 - s + 1 - r0 / 2);
  const t = s1 === s0 ? 1 : act(s1) / act(s0);
  return { iy: g.iy * k * t, ot: g.ot * (k > 0 ? Math.sqrt(k) : 0), rr: g.rr * k };
}
function R() {
  const g = D.scenarios[S.scen];
  let iy = 0, ot = 0, rr = 0, risk = 0;
  const lev = {};
  Object.keys(g.levers).forEach((L) => { const x = leverIY(L); lev[L] = x; iy += x.iy; ot += x.ot; rr += x.rr; risk += x.iy * confOf(L); });
  const otIt = ot * (1 - S.otOut);
  const net = iy - otIt;
  const bar = S.target + g['base.headwinds'];
  const dIY = iy - g['res.tot_iy'];
  const perE = g['pnl.e27'] ? g['br.eps27'] / g['pnl.e27'] : 0.0011;
  const perP = g['pnl.e27'] ? g['br.px27'] / g['pnl.e27'] : 0.012;
  return {
    g, lev, iy, rr, ot, otIt, net, bar, gap: net - bar, risk: risk - otIt, target: S.target,
    base: g['base.total'], growth: g['base.headwinds'], outlay: g['base.total'] + g['base.headwinds'] - net,
    eps: g['br.eps27'] + dIY * perE, px: g['br.px27'] + dIY * perP, mcap: g['br.mcap27'] + dIY * perP * 665,
    edited: S.edits > 0,
  };
}
function vpOutlay() {
  const out = { vp_commercial: 0, vp_operations: 0, vp_corporate: 0, vp_infra: 0 };
  D.lines.forEach((l) => VPK.forEach((v) => { out[v] += l[5] * (S.domShare[l[3] + ',' + v] || 0); }));
  return out;
}

/* ---------- formatting ---------- */
const MINUS = '−';
const f1 = (x) => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toFixed(1));
const m = (x, d = 1) => (x < 0 ? MINUS : '') + '$' + (d === 1 ? f1(Math.abs(x)) : Math.abs(x).toFixed(d)) + 'M';
const sm = (x, d = 1) => (x < 0 ? MINUS : '+') + '$' + Math.abs(x).toFixed(d) + 'M';
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const eps = (x) => (x < 0 ? MINUS : '+') + '$' + Math.abs(x).toFixed(3);
const usd = (x, d = 2) => (x < 0 ? MINUS : '') + '$' + Math.abs(x).toFixed(d);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtVal(id, v) {
  const u = (D.vmeta[id] || {}).unit || '';
  if (u === '%' || u === '% of US FTE' || u === '% of US cost' || u === '%/yr') return (v * 100).toFixed(v * 100 % 1 ? 1 : 0) + '%';
  if (u === '$M') return '$' + v.toFixed(v < 1 ? 3 : 1) + 'M';
  if (u === 'x') return v.toFixed(2) + '×';
  if (u === 'month') return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.round(v) - 1];
  if (u === 'months') return v + ' mo';
  if (u === 'FTE' || u === '#') return Math.round(v).toLocaleString('en-US');
  return String(v);
}
const gapChip = (gap) => gap >= 0
  ? `<span class="chip pos">${ic('up')}${m(gap)} clear</span>`
  : `<span class="chip neg">${ic('down')}${m(-gap)} short</span>`;

/* ---------- icons (24px stroke) ---------- */
const ICONS = {
  cockpit: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.5-5"/><circle cx="12" cy="16" r="1.2"/>',
  baseline: '<path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z"/>',
  levers: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  vps: '<path d="M9 3h6v4H9zM3 16h6v4H3zM15 16h6v4h-6zM12 7v4M6 16v-5h12v5"/>',
  solver: '<path d="M5 19c3 0 3-7 7-7s4-7 7-7"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
  market: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  data: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
  airlines: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.2 3 3.2 15 0 18M12 3c-3.2 3-3.2 15 0 18"/>',
  mood: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.2.9-1.9 2-1.9H18a3 3 0 0 0 3-3C21 9.3 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  ia: '<path d="M4 4h6v6H4zM14 14h6v6h-6zM7 10v7h7"/>',
  comps: '<path d="M12 3l3 3-3 3-3-3zM6 9l3 3-3 3-3-3zM18 9l3 3-3 3-3-3zM12 15l3 3-3 3-3-3z"/>',
  story: '<path d="M4 4h16v11H4zM12 15v5M8 20h8"/><path d="M10.5 7.5l3.5 2-3.5 2z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  up: '<path d="M6 15l6-6 6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', chev: '<path d="M9 6l6 6-6 6"/>',
  trace: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  export: '<path d="M12 3v12M7 8l5-5 5 5M5 21h14"/>', import: '<path d="M12 15V3M7 10l5 5 5-5M5 21h14"/>',
  check: '<path d="M5 12l5 5 9-10"/>', plus: '<path d="M12 5v14M5 12h14"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  file: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>', play: '<path d="M8 5l11 7-11 7z"/>',
};
const ic = (n, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

/* ---------- svg helpers ---------- */
const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
function arc(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
const tipAttr = (html) => `data-tip="${esc(html)}"`;

/* Gauge: 270° sweep, net vs bar with target + bar notches */
function gauge(net, bar, target, opts = {}) {
  const max = Math.max(180, Math.ceil(Math.max(bar, net) * 1.18 / 20) * 20);
  const A0 = Math.PI * 0.75, SW = Math.PI * 1.5, cx = 160, cy = 160, r = 128;
  const ang = (v) => A0 + SW * Math.max(0, Math.min(1, v / max));
  const ticks = [];
  for (let v = 0; v <= max; v += 20) {
    const a = ang(v), [x0, y0] = polar(cx, cy, r + 16, a), [x1, y1] = polar(cx, cy, r + (v % 60 ? 19 : 23), a);
    ticks.push(`<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="var(--ink-3)" stroke-width="${v % 60 ? 1 : 1.4}" opacity=".6"/>`);
  }
  const notch = (v, lab, strong) => {
    const a = ang(v), [x0, y0] = polar(cx, cy, r - 13, a), [x1, y1] = polar(cx, cy, r + 13, a), [tx, ty] = polar(cx, cy, r + 38, a);
    return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="var(--ink)" stroke-width="${strong ? 2.4 : 1.4}" stroke-linecap="round" ${strong ? '' : 'stroke-dasharray="2 3"'}/>
      <text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" class="${strong ? 't-ink' : ''}">${lab}</text>`;
  };
  const fill = net > 0 ? `<path d="${arc(cx, cy, r, A0, ang(net))}" stroke="url(#gfill)" stroke-width="14" stroke-linecap="round" fill="none" class="g-fill" style="filter:drop-shadow(0 0 10px var(--accent-glow))"/>` : '';
  return `<svg class="chart" viewBox="-10 -6 340 300" role="img" aria-label="Net savings ${m(net)} against a bar of ${m(bar)}">
    <defs><linearGradient id="gfill" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="var(--accent-2)"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>
    ${ticks.join('')}
    <path d="${arc(cx, cy, r, A0, A0 + SW)}" stroke="var(--track)" stroke-width="14" stroke-linecap="round" fill="none"/>
    ${fill}
    ${notch(target, 'Target ' + Math.round(target), false)}
    ${notch(bar, 'Bar ' + bar.toFixed(0), true)}
    <text x="${polar(cx, cy, r, A0)[0] - 4}" y="${polar(cx, cy, r, A0)[1] + 26}" text-anchor="middle">0</text>
    <text x="${polar(cx, cy, r, A0 + SW)[0] + 4}" y="${polar(cx, cy, r, A0 + SW)[1] + 26}" text-anchor="middle">${max}</text>
  </svg>`;
}

/* Ring for VP tiles */
function ring(v, max, color, size = 64) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, v / max));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="5"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
      stroke-dasharray="${(c * p).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition:stroke-dasharray .5s var(--ease)"/>
    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" style="fill:var(--ink);font:500 12px var(--f-num)">${Math.round(p * 100)}%</text></svg>`;
}

/* Waterfall CY26 -> CY27 with a marked axis break */
function waterfall(x) {
  const W = 640, H = 300, L = 46, Rt = 12, T = 26, B = 40, lo = 840, hi = Math.max(1080, x.base + x.growth + 20);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const steps = [
    { k: 'CY26 base', a: lo, b: x.base, c: 'var(--total)', lab: m(x.base), tip: 'Normalized CY26 IT outlay' },
    { k: 'Cost growth', a: x.base, b: x.base + x.growth, c: 'var(--neg)', lab: sm(x.growth), tip: 'Status-quo CY27 growth to absorb' },
    { k: 'Savings', a: x.base + x.growth, b: x.base + x.growth - x.iy, c: 'var(--accent)', lab: sm(-x.iy), tip: 'In-year lever savings' },
    { k: 'One-time in IT', a: x.base + x.growth - x.iy, b: x.outlay, c: 'var(--warn)', lab: sm(x.otIt), tip: 'Transition cost borne by the IT budget' },
    { k: 'CY27 outlay', a: lo, b: x.outlay, c: 'var(--total)', lab: m(x.outlay), tip: 'Projected CY27 IT outlay' },
  ];
  const n = steps.length, bw = 64, gapw = (W - L - Rt - n * bw) / (n - 1 + 0.6);
  let s = '';
  for (let v = 850; v <= hi; v += 50) s += `<line class="grid-l" x1="${L}" x2="${W - Rt}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('en-US')}</text>`;
  steps.forEach((st, i) => {
    const x0 = L + gapw * 0.3 + i * (bw + gapw), top = Math.min(y(st.a), y(st.b)), h = Math.max(2, Math.abs(y(st.a) - y(st.b)));
    s += `<rect x="${x0}" y="${top}" width="${bw}" height="${h}" rx="5" fill="${st.c}" ${st.c.includes('total') ? 'stroke="var(--glass-line)"' : 'opacity=".92"'} ${tipAttr(`<b>${st.k}</b><br>${st.lab}<br><span class=faint>${st.tip}</span>`)}/>`;
    s += `<text x="${x0 + bw / 2}" y="${top - 8}" text-anchor="middle" class="t-ink" style="font:500 12px var(--f-num)">${st.lab}</text>`;
    s += `<text x="${x0 + bw / 2}" y="${H - B + 18}" text-anchor="middle">${st.k}</text>`;
    if (i < n - 1) {
      const nx = L + gapw * 0.3 + (i + 1) * (bw + gapw), yy = y(st.b);
      s += `<line x1="${x0 + bw}" x2="${nx}" y1="${yy}" y2="${yy}" stroke="var(--ink-3)" stroke-dasharray="2 3" opacity=".6"/>`;
    }
  });
  const ty = y(x.base - x.target), lastX = L + gapw * 0.3 + (n - 1) * (bw + gapw);
  s += `<line class="ref" x1="${L}" x2="${W - Rt}" y1="${ty}" y2="${ty}"/>`;
  const midX = L + gapw * 0.3 + 2.5 * (bw + gapw) + bw / 2 - gapw / 2;
  s += `<text x="${midX}" y="${ty + 17}" text-anchor="middle" class="t-ink2">Target outlay ${m(x.base - x.target)}</text>`;
  const gy = y(x.outlay);
  if (x.outlay > x.base - x.target) {
    s += `<path d="M${lastX + bw + 6} ${gy}h5v${ty - gy}h-5" stroke="var(--neg)" fill="none" stroke-width="1.4"/>`;
  }
  // axis break glyph
  s += `<path d="M${L - 6} ${H - B - 4}l6 -5 6 5 6 -5" stroke="var(--ink-3)" fill="none"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Bridge from CY26 base to CY27 outlay">${s}</svg>`;
}

/* split-normal histogram from P10/P50/P90 */
function hist(p10, p50, p90, bar, opts = {}) {
  const W = opts.w || 320, H = opts.h || 120, lo = opts.lo ?? 20, hi = opts.hi ?? 170, nb = 30;
  const sl = (p50 - p10) / 1.2816, sr = (p90 - p50) / 1.2816;
  const pdf = (v) => Math.exp(-0.5 * ((v - p50) / (v < p50 ? sl : sr)) ** 2);
  const bwid = (hi - lo) / nb, xs = (v) => (W - 8) * (v - lo) / (hi - lo) + 4;
  let mx = 0; const vals = [];
  for (let i = 0; i < nb; i++) { const v = pdf(lo + (i + 0.5) * bwid); vals.push(v); mx = Math.max(mx, v); }
  let s = '';
  vals.forEach((v, i) => {
    const x0 = xs(lo + i * bwid) + 1, w = xs(lo + (i + 1) * bwid) - xs(lo + i * bwid) - 2, h = (H - 22) * v / mx;
    const c = lo + (i + 0.5) * bwid >= bar ? 'var(--pos)' : (opts.color || 'var(--accent)');
    s += `<rect x="${x0}" y="${H - 18 - h}" width="${Math.max(1, w)}" height="${h}" rx="2" fill="${c}" opacity="${opts.op || .85}"/>`;
  });
  const bx = xs(bar);
  s += `<line class="ref" x1="${bx}" x2="${bx}" y1="0" y2="${H - 18}"/><text x="${bx + 5}" y="10" class="t-ink2">Bar</text>`;
  [p10, p50, p90].forEach((p, i) => { s += `<text x="${xs(p)}" y="${H - 4}" text-anchor="middle">${['P10', 'P50', 'P90'][i]} ${Math.round(p)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of net savings">${s}</svg>`;
}

/* squarified treemap */
function squarify(items, x, y, w, h) {
  items = items.filter((d) => d.v > 1e-9);
  const out = [], total = items.reduce((a, b) => a + b.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  const rest = items.map((d) => Object.assign({}, d, { a: d.v * scale })).sort((a, b) => b.a - a.a);
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row, side) => { const s = row.reduce((a, b) => a + b.a, 0); let mx = 0, mn = Infinity; row.forEach((r) => { mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); }); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
  while (rest.length) {
    const side = Math.min(rw, rh); let row = [rest.shift()];
    while (rest.length && worst(row.concat(rest[0]), side) <= worst(row, side)) row.push(rest.shift());
    const s = row.reduce((a, b) => a + b.a, 0);
    if (rw >= rh) { const cw = s / rh; let cy = ry; row.forEach((r) => { const ch = r.a / cw; out.push(Object.assign(r, { x: rx, y: cy, w: cw, h: ch })); cy += ch; }); rx += cw; rw -= cw; }
    else { const ch = s / rw; let cx = rx; row.forEach((r) => { const cw = r.a / ch; out.push(Object.assign(r, { x: cx, y: ry, w: cw, h: ch })); cx += cw; }); ry += ch; rh -= ch; }
  }
  return out;
}

/* tooltip + toast */
let tipEl, toastEl, toastT;
function initTips() {
  tipEl = document.getElementById('tip'); toastEl = document.getElementById('toast');
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tipEl.classList.remove('on'); return; }
    tipEl.innerHTML = t.getAttribute('data-tip');
    const x = Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 12), yy = Math.min(e.clientY + 14, window.innerHeight - tipEl.offsetHeight - 12);
    tipEl.style.left = x + 'px'; tipEl.style.top = yy + 'px'; tipEl.classList.add('on');
  });
}
function toast(html) {
  toastEl.innerHTML = html; toastEl.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2400);
}
/* animated number roll */
function roll(el, to, fmt, dur = 520) {
  const from = parseFloat(el.dataset.v || to); el.dataset.v = to;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
