/* Glidepath UX prototype · controller: routing, live refresh, editing, palette, drag */
const VIEWS = { cockpit: vCockpit, baseline: vBaseline, levers: vLevers, vps: vVps, solver: vSolver, market: vMarket, data: vData, airlines: vAirlines, mood: vMood, ia: vIA, comps: vComps, story: vStory };
const RESERVED = new Set(Object.keys(VIEWS));

function render() {
  shell();
  const host = document.getElementById('view');
  host.innerHTML = topbar() + `<div class="view-in">${VIEWS[S.view]()}</div>` +
    (isDoc(S.view) ? '' : `<p class="foot-note">Prototype. Scenario numbers are the engine's golden results for AA. Live slider edits use the spec's exact identities where they exist (target, outside funding, VP ownership) and proportional estimates elsewhere until the engine is connected.</p>`);
  host.querySelectorAll('.range input').forEach(syncRange);
  hud();
  document.title = 'Glidepath';
}
function go(v) {
  if (!RESERVED.has(v)) v = 'cockpit';
  S.view = v;
  if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
  render(); window.scrollTo({ top: 0 });
}
function syncRange(inp) {
  const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100;
  inp.style.setProperty('--p', p + '%');
}
function markEdit() { S.edits++; }

/* refresh live numbers without re-rendering controls */
function refresh() {
  const x = R(), out = vpOutlay();
  const B = {
    net: m(x.net), bar: m(x.bar), risk: m(x.risk), rr: m(x.rr), otit: m(x.otIt), iy: m(x.iy), eps: eps(x.eps), px: '+' + usd(x.px), edits: String(S.edits), epsTo: usd(0.465 + x.eps, 3), pxTo: usd(11.90 + x.px),
  };
  document.querySelectorAll('[data-bind]').forEach((el) => {
    const k = el.dataset.bind;
    if (k in B) { if (el.textContent !== B[k]) { el.textContent = B[k]; } return; }
    if (k === 'netHero') roll(el, x.net, (v) => '$' + v.toFixed(1));
    else if (k === 'gapchip') el.innerHTML = gapChip(x.gap);
    else if (k === 'prog') el.style.width = Math.min(100, (x.net / (x.bar * 1.2)) * 100) + '%';
    else if (k.startsWith('lev:')) el.textContent = m(x.lev[k.slice(4)].iy);
    else if (k.startsWith('levrr:')) el.textContent = m(x.lev[k.slice(6)].rr);
    else if (k.startsWith('levot:')) el.textContent = m(x.lev[k.slice(6)].ot);
    else if (k.startsWith('bar:')) { const mx = Math.max(...Object.values(D.scenarios.D.levers).map((l) => l.iy)); el.style.width = (x.lev[k.slice(4)].iy / mx) * 100 + '%'; }
    else if (k.startsWith('fam:')) { const f = FAM.find((z) => z[0] === k.slice(4)); el.textContent = m(f[1].reduce((a, L) => a + x.lev[L].iy, 0)); }
    else if (k.startsWith('vpout:')) { const nv = m(out[k.slice(6)]); if (el.textContent !== nv) { el.textContent = nv; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
    else if (k === 'pxbase' || k === 'pxit') { const c = corp(); el.textContent = usd(k === 'pxbase' ? c.pxBase : c.pxIT); }
  });
  document.querySelectorAll('[data-chart]').forEach((el) => {
    const k = el.dataset.chart;
    if (k === 'gauge') el.innerHTML = gauge(x.net, x.bar, x.target);
    else if (k === 'waterfall') el.innerHTML = waterfall(x);
    else if (k === 'area') el.innerHTML = areaChart(x);
    else if (k === 'eps') el.innerHTML = epsBars(corp());
  });
  const e = document.querySelector('.edits'); if (e) e.innerHTML = `${S.edits ? '<span class="dot"></span>' : ''}<b data-bind="edits">${S.edits}</b> edits`;
}

/* ---------- events ---------- */
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('.range input')) {
    syncRange(t);
    const id = t.dataset.id, v = parseFloat(t.value);
    if (id === 'target') S.target = v;
    else if (id === 'otout') S.otOut = v;
    else if (id === 'pop') { popApply(v); }
    else S.lev[id] = v;
    const o = document.querySelector(`[data-out="${id}"]`);
    if (o) o.textContent = id === 'target' ? '$' + v + 'M' : id === 'otout' ? pct(v) : id === 'pop' ? o.textContent : fmtVal(id, v);
    refresh();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('.range input') && t.dataset.id !== 'pop') { markEdit(); refresh(); }
  if (t.dataset.tg && t.dataset.tg.startsWith('on-')) { S.on[t.dataset.tg.slice(3)] = t.checked; markEdit(); refresh(); toast(`${t.dataset.tg.slice(3)} ${t.checked ? 'on' : 'off'} · net ${m(R().net)}`); }
  else if (t.dataset.tg) { markEdit(); refresh(); }
  if (t.dataset.start) { S.start[t.dataset.start] = parseInt(t.value, 10); markEdit(); render(); }
  if (t.dataset.st) { const v = parseInt(t.value.replace(/\D/g, ''), 10) || 0; S.hc[t.dataset.st] = v; t.value = v.toLocaleString('en-US'); markEdit(); refresh(); }
});
document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a, [data-go], [data-pick], [data-lever], .ed, [data-node]');
  if (!t) return;
  if (t.dataset.nav) { e.preventDefault(); go(t.dataset.nav); return; }
  if (t.dataset.seg) {
    const name = t.dataset.seg, k = t.dataset.k;
    t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === t));
    if (name === 'scen') { S.scen = k; S.lev = {}; S.on = {}; S.start = {}; S.edits = 0; render(); toast(`Scenario ${SCN.find((s) => s[0] === k)[2]} · net ${m(R().net)}`); }
    else if (name === 'group') { S.sel.group = k; S.sel.key = null; render(); }
    return;
  }
  if (t.dataset.lever && !e.target.closest('.tgl')) { S.sel.lever = t.dataset.lever; render(); return; }
  if (t.dataset.pick) { S.sel.key = t.dataset.pick; render(); return; }
  if (t.dataset.node) { S.sel.node = t.dataset.node; document.querySelectorAll('.tnode').forEach((n) => n.classList.toggle('hl', n === t)); openTrace(t.dataset.node); return; }
  if (t.hasAttribute('data-trace')) { openTrace(S.sel.node); return; }
  if (t.hasAttribute('data-palette')) { openPalette(); return; }
  if (t.hasAttribute('data-theme')) { cycleTheme(); return; }
  if (t.hasAttribute('data-solve')) { solveAnim(); return; }
  if (t.hasAttribute('data-knobreset')) { Object.keys(KN).forEach((k) => { KS[k] = KN[k].v; }); MULT = 7.393; render(); return; }
  if (t.dataset.toast) { toast(`${ic('check').replace('<svg', '<svg style="width:16px;height:16px;stroke:var(--pos);fill:none;stroke-width:2.4"')}${esc(t.dataset.toast)}`); return; }
  if (t.dataset.step) { const id = t.dataset.step; S.hc[id] = Math.max(0, S.hc[id] + parseInt(t.dataset.d, 10)); const inp = document.getElementById('st-' + id); if (inp) inp.value = S.hc[id].toLocaleString('en-US'); markEdit(); refresh(); return; }
  if (t.classList.contains('ed')) { openPop(t); return; }
  if (t.dataset.go) { go(t.dataset.go); }
});
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'Escape') { closeAll(); }
});

/* ---------- theme ---------- */
function cycleTheme() {
  const r = document.documentElement, cur = r.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  r.setAttribute('data-theme', dark ? 'light' : 'dark');
  try { localStorage.setItem('gp-theme', dark ? 'light' : 'dark'); } catch (err) { /* storage unavailable */ }
  render();
}

/* ---------- edit popover ---------- */
let popCtx = null;
const POPDEF = {
  target: { lab: 'Net target · CY27', unit: '$M', min: 50, max: 150, step: 1, get: () => S.target, set: (v) => { S.target = v; }, src: 'User', conf: 'High', fmt: (v) => '$' + v + 'M' },
  growth: { lab: 'Pool cost growth · CY27', unit: '%/yr', min: 0, max: 0.15, step: 0.005, get: () => D.pool_growth[S.sel.key] || 0.04, set: () => {}, src: 'Baseline', conf: 'Medium', fmt: (v) => pct(v, 1) },
  line: { lab: 'CY26 line amount', unit: '$M', min: 0, max: 80, step: 0.1, get: () => 1, set: () => {}, src: 'Baseline', conf: 'Medium', fmt: (v) => '$' + v.toFixed(2) + 'M' },
  mult: { lab: 'EV / EBITDAR multiple', unit: '×', min: 4, max: 11, step: 0.05, get: () => MULT, set: (v) => { MULT = v; }, src: 'Market-implied', conf: 'Medium', fmt: (v) => v.toFixed(2) + '×' },
};
function openPop(el) {
  const k = el.dataset.ed, d = POPDEF[k]; if (!d) return;
  const cur = k === 'line' ? parseFloat(el.textContent.replace(/[^0-9.]/g, '')) : d.get();
  popCtx = { k, el, d, v0: cur };
  const pop = document.getElementById('pop');
  pop.innerHTML = `<div class="spread"><span class="label">${d.lab}</span><span class="chip">${d.unit}</span></div>
    <input class="numin" id="pop-num" value="${d.fmt(cur)}" aria-label="${d.lab}">
    ${slider('pop', 'Drag or type', cur, d.min, Math.max(d.max, cur * 1.5), d.step, d.fmt)}
    <div class="meta"><span class="chip">Source · ${d.src}</span><span class="chip">Confidence · ${d.conf}</span><span class="chip">Default ${d.fmt(cur)}</span></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn ghost" type="button" data-popreset>Reset</button><button class="btn primary" type="button" data-popdone>Done</button></div>`;
  pop.querySelectorAll('.range input').forEach(syncRange);
  const r = el.getBoundingClientRect();
  pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - 312)) + 'px';
  pop.style.top = Math.min(r.bottom + 10, window.innerHeight - 290) + 'px';
  pop.classList.add('on');
  pop.querySelector('[data-popdone]').onclick = () => { closeAll(); };
  pop.querySelector('[data-popreset]').onclick = () => { popApply(popCtx.v0); closeAll(); };
  pop.querySelector('#pop-num').onchange = (ev) => { const v = parseFloat(ev.target.value.replace(/[^0-9.\-]/g, '')); if (!isNaN(v)) popApply(k === 'growth' && v > 1 ? v / 100 : v); };
}
function popApply(v) {
  if (!popCtx) return;
  popCtx.d.set(v);
  if (popCtx.k === 'line' || popCtx.k === 'growth') { popCtx.el.textContent = popCtx.d.fmt(v); }
  popCtx.el.classList.add('changed');
  const n = document.getElementById('pop-num'); if (n) n.value = popCtx.d.fmt(v);
  if (!popCtx.touched) { popCtx.touched = true; markEdit(); }
  if (popCtx.k === 'target') { const s = document.getElementById('in-target'); if (s) { s.value = v; syncRange(s); const o = document.querySelector('[data-out="target"]'); if (o) o.textContent = '$' + v + 'M'; } }
  if (popCtx.k === 'mult') popCtx.el.textContent = v.toFixed(2) + '×';
  refresh();
}
function closeAll() {
  document.getElementById('pop').classList.remove('on'); popCtx = null;
  document.getElementById('scrim').classList.remove('on');
  document.getElementById('drawer').classList.remove('on');
}
document.addEventListener('pointerdown', (e) => {
  const pop = document.getElementById('pop');
  if (pop.classList.contains('on') && !pop.contains(e.target) && !e.target.closest('.ed')) closeAll();
  const dr = document.getElementById('drawer');
  if (dr.classList.contains('on') && !dr.contains(e.target) && !e.target.closest('[data-node],[data-trace]')) dr.classList.remove('on');
});

/* ---------- command palette ---------- */
function openPalette() {
  const sc = document.getElementById('scrim');
  sc.innerHTML = `<div class="palette glass" role="dialog" aria-label="Find any number"><input id="pal-q" placeholder="Find any input, lever, line or output…" autocomplete="off"><div class="res" id="pal-res"></div></div>`;
  sc.classList.add('on');
  const q = document.getElementById('pal-q'); q.focus();
  const items = Object.entries(D.vmeta).filter(([, v]) => v.control !== 'hidden').map(([id, v]) => ({ id, label: SHORT[id] || v.label, kind: v.kind, unit: v.unit }))
    .concat(D.levers.map((l) => ({ id: l.id, label: l.label, kind: 'lever', unit: '' })))
    .concat(NAV.map(([k, , t]) => ({ id: '#' + k, label: t, kind: 'screen', unit: '' })));
  const draw = () => {
    const s = q.value.toLowerCase();
    const hits = items.filter((i) => !s || i.label.toLowerCase().includes(s) || i.id.toLowerCase().includes(s)).slice(0, 9);
    document.getElementById('pal-res').innerHTML = hits.map((h, i) => `<button type="button" class="${i ? '' : 'on'}" data-pal="${esc(h.id)}"><span>${esc(h.label)}</span><span class="faint xs" style="font-family:var(--f-mono)">${h.kind}${h.unit ? ' · ' + esc(h.unit) : ''}</span></button>`).join('') || '<p class="faint small" style="padding:12px">No match. Try "COLA", "cloud" or "headcount".</p>';
  };
  q.oninput = draw; draw();
  sc.onclick = (e) => {
    const b = e.target.closest('[data-pal]');
    if (b) { const id = b.dataset.pal; closeAll(); if (id[0] === '#') go(id.slice(1)); else if (/^L\d\d$/.test(id)) { S.sel.lever = id; go('levers'); } else { const L = (id.match(/lev\.(L\d\d)/) || [])[1]; if (L) { S.sel.lever = L; go('levers'); } else go('cockpit'); toast('Jumped to ' + esc(b.querySelector('span').textContent)); } }
    else if (e.target === sc) closeAll();
  };
  q.onkeydown = (e) => { if (e.key === 'Enter') { const b = sc.querySelector('[data-pal]'); if (b) b.click(); } };
}

/* ---------- trace drawer ---------- */
const FORMULA = {
  net: ['res.net', 'Σ lever in-year − one-time × (1 − share funded outside IT)'],
  opex: ['pnl.o27', 'Σ opex part of lever in-year savings (capex excluded)'],
  ot: ['res.tot_ot_all', 'All one-time cost incurred in CY27; the P&L bears it whoever funds it'],
  ebitda: ['br.ebitda27', 'opex saved − one-time − profit sharing on the pre-tax change'],
  eps: ['br.eps27', '(EBITDA change + D&A relief) × (1 − tax) ÷ diluted shares'],
  px: ['br.px27', 'EV / EBITDAR × EBITDAR change ÷ shares (blend weight on P/E is an input)'],
  mcap: ['br.mcap27', 'share price change × diluted shares'],
};
function openTrace(k) {
  const x = R(), nodes = traceNodes(x), i = nodes.findIndex((n) => n[0] === k);
  const dr = document.getElementById('drawer');
  dr.innerHTML = `<div class="spread"><span class="label">Trace · ${nodes[i][1]}</span><button class="iconbtn" type="button" aria-label="Close" onclick="document.getElementById('drawer').classList.remove('on')">✕</button></div>
    <div class="big-num" style="margin:14px 0 4px">${nodes[i][2]}</div><p class="faint small" style="font-family:var(--f-mono)">${FORMULA[k][0]}</p>
    <p class="small" style="margin-top:16px">${FORMULA[k][1]}</p>
    <div class="label" style="margin:24px 0 10px">Upstream</div>
    <div class="stack" style="gap:8px">${nodes.slice(0, i + 1).map((n, j) => `<div class="well" style="padding:12px 14px;display:flex;justify-content:space-between;gap:10px;${j === i ? 'border-color:var(--accent)' : ''}"><span class="small">${n[1]}</span><span class="num">${n[2]}</span></div>`).join('')}</div>
    <div class="label" style="margin:24px 0 10px">Top drivers</div>
    <div class="list">${Object.entries(x.lev).sort((a, b) => b[1].iy - a[1].iy).slice(0, 5).map(([L, v]) => `<div class="li" style="grid-template-columns:minmax(0,1fr) auto"><span class="small">${esc(D.levers.find((l) => l.id === L).label)}</span><span class="num small">${m(v.iy)}</span></div>`).join('')}</div>`;
  dr.classList.add('on');
}

/* ---------- solver animation ---------- */
function solveAnim() {
  const rows = document.querySelectorAll('.move');
  rows.forEach((r) => { r.style.opacity = .25; });
  rows.forEach((r, i) => setTimeout(() => { r.style.transition = 'opacity .35s'; r.style.opacity = 1; }, 120 + i * 90));
  toast('Searching 1,634 combinations…');
  setTimeout(() => toast(`${ic('check').replace('<svg', '<svg style="width:16px;height:16px;stroke:var(--pos);fill:none;stroke-width:2.4"')}Path found · $143.0M at lowest risk`), 120 + rows.length * 90 + 200);
}

/* ---------- drag: VP ownership dividers ---------- */
let drag = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.hdl'); if (!h) return;
  const bar = h.parentElement; drag = { dom: h.dataset.hdl, i: +h.dataset.i, bar, rect: bar.getBoundingClientRect() };
  h.setPointerCapture(e.pointerId); e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const sh = VPK.map((v) => S.domShare[drag.dom + ',' + v] || 0);
  const cum = [sh[0], sh[0] + sh[1], sh[0] + sh[1] + sh[2]];
  let pos = Math.round(Math.max(0, Math.min(1, (e.clientX - drag.rect.left) / drag.rect.width)) * 20) / 20;
  const lo = drag.i ? cum[drag.i - 1] : 0, hi = drag.i < 2 ? cum[drag.i + 1] : 1;
  pos = Math.max(lo, Math.min(hi, pos)); cum[drag.i] = pos;
  const ns = [cum[0], cum[1] - cum[0], cum[2] - cum[1], 1 - cum[2]];
  VPK.forEach((v, j) => { S.domShare[drag.dom + ',' + v] = Math.round(ns[j] * 100) / 100; });
  const segs = drag.bar.querySelectorAll('i'), hdls = drag.bar.querySelectorAll('.hdl');
  ns.forEach((s, j) => { segs[j].style.width = s * 100 + '%'; segs[j].textContent = s >= 0.12 ? pct(s) : ''; });
  cum.forEach((c, j) => { hdls[j].style.left = c * 100 + '%'; });
  refresh();
});
document.addEventListener('pointerup', () => { if (drag) { drag = null; markEdit(); refresh(); toast('Ownership changed · VP outlays recalculated'); } });

/* ---------- knobs ---------- */
let kdrag = null;
document.addEventListener('pointerdown', (e) => {
  const k = e.target.closest('.knob svg'); if (!k) return;
  const key = k.parentElement.dataset.knob; kdrag = { key, y: e.clientY, v: KS[key] }; k.setPointerCapture(e.pointerId); e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!kdrag) return;
  const d = KN[kdrag.key], dv = ((kdrag.y - e.clientY) / 160) * (d.max - d.min);
  KS[kdrag.key] = Math.round(Math.max(d.min, Math.min(d.max, kdrag.v + dv)) / d.step) * d.step;
  const host = document.querySelector(`[data-knob="${kdrag.key}"]`); host.outerHTML = knob(kdrag.key);
  refresh();
});
document.addEventListener('pointerup', () => { if (kdrag) { kdrag = null; markEdit(); refresh(); } });
document.addEventListener('keydown', (e) => {
  const k = e.target.closest && e.target.closest('.knob svg'); if (!k) return;
  const key = k.parentElement.dataset.knob, d = KN[key];
  if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) {
    e.preventDefault(); KS[key] = Math.max(d.min, Math.min(d.max, KS[key] + (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? d.step : -d.step)));
    k.parentElement.outerHTML = knob(key); document.querySelector(`[data-knob="${key}"] svg`).focus(); refresh();
  }
});

/* ---------- boot ---------- */
try { const th = localStorage.getItem('gp-theme'); if (th) document.documentElement.setAttribute('data-theme', th); } catch (err) { /* storage unavailable */ }
const qp = new URLSearchParams(location.search);
if (qp.get('theme')) document.documentElement.setAttribute('data-theme', qp.get('theme'));
initTips();
go(location.hash.slice(1) || 'cockpit');
