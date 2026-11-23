/* Glidepath design pack · moodboard, information architecture, components, demo storyline */
const sw = (hex, tok, note = '') => `<div class="swatch"><div class="chipc" style="background:${hex}"></div><div><div class="small">${tok}</div><div class="tok">${hex}${note ? ' · ' + note : ''}</div></div></div>`;

function vMood() {
  return `<div class="doc">
  <section style="margin-top:4px">
    <span class="eyebrow">Direction</span>
    <h2 style="font-size:clamp(44px,6vw,84px);margin-top:8px">Cruise</h2>
    <p class="lede">Calm instruments over a night sky. Glass recedes, numbers lead, and every number moves when you touch it. Built for one room and one question: can AA reach the bar, and how?</p>
    <div class="grid" style="margin-top:28px">
      ${[['Numbers first', 'One hero number per panel. Labels are small mono nouns. Sentences only for a lever\'s one-line hypothesis.'],
        ['One accent', 'Contrail ice marks what you can touch and what you saved. Status colours only mean status.'],
        ['Glass for objects', 'Panels are glass. Content inside them is flat. Nothing is glass on glass except popovers.'],
        ['Motion shows cause', 'When an input moves, the outputs it drives move with it, in order. Nothing animates for decoration.']]
        .map(([h, p]) => `<div class="glass pad c3"><h3>${h}</h3><p class="faint small" style="margin-top:8px">${p}</p></div>`).join('')}
    </div>
  </section>
  <section>
    <div class="sec-h"><h2>Palette</h2><span class="faint small">Cruise is the default. Daylight is for bright rooms and print.</span></div>
    <div class="label" style="margin-bottom:12px">Cruise · dark</div>
    <div class="sw-grid">${sw('#060a12', 'Ground', 'night')}${sw('#16365f', 'Aurora 1', 'steel')}${sw('#0c4450', 'Aurora 2', 'teal')}${sw('#4a2f19', 'Aurora 3', 'horizon')}${sw('#8ccbff', 'Accent', 'contrail')}${sw('#eaf1fb', 'Ink')}</div>
    <div class="label" style="margin:22px 0 12px">Daylight · light</div>
    <div class="sw-grid">${sw('#e8eef6', 'Ground', 'haze')}${sw('#bcd4f2', 'Aurora 1')}${sw('#c8e8e6', 'Aurora 2')}${sw('#f5dcbd', 'Aurora 3')}${sw('#1667c0', 'Accent')}${sw('#0a1525', 'Ink')}</div>
    <div class="grid" style="margin-top:22px">
      <div class="glass pad c4"><div class="label">VP series · validated</div><div class="row" style="margin-top:14px;gap:6px">${[1, 2, 3, 4].map((i) => `<span style="flex:1;height:36px;border-radius:8px;background:var(--vp${i})"></span>`).join('')}</div>
        <div class="legend" style="margin-top:10px">${VPK.map((v, i) => `<span><i class="sw" style="background:var(--vp${i + 1})"></i>${VPS[v]}</span>`).join('')}</div>
        <p class="faint xs" style="margin-top:10px">Colour-blind separation checked in both themes. Always paired with a direct label.</p></div>
      <div class="glass pad c4"><div class="label">Status · never a series</div><div class="row wrap" style="margin-top:14px">${gapChip(23.9)}${gapChip(-23.7)}<span class="chip warn">At risk</span></div>
        <p class="faint xs" style="margin-top:14px">Each status ships with an icon and a word.</p></div>
      <div class="glass pad c4"><div class="label">Sequential · addressability</div><div class="row" style="margin-top:14px;gap:4px">${['seq-1', 'seq-2', 'seq-3'].map((k) => `<span style="flex:1;height:36px;border-radius:8px;background:var(--${k})"></span>`).join('')}</div>
        <div class="spread faint xs" style="margin-top:8px"><span>Locked</span><span>Partly</span><span>Addressable</span></div></div>
    </div>
  </section>
  <section>
    <div class="sec-h"><h2>Type</h2><span class="faint small">Geist for everything, Geist Mono for labels and data. Tabular figures always.</span></div>
    <div class="glass pad"><div class="type-spec">
      <span class="label">Hero · 76 / 300</span><span class="hero-num">$119.3<span class="u">M</span></span>
      <span class="label">Big · 40 / 300</span><span class="big-num">+$0.091 EPS</span>
      <span class="label">Mid · 22 / 400</span><span class="mid-num">$36.6M bar</span>
      <span class="label">Title · 22 / 500</span><span style="font-size:22px;font-weight:500">Software licence &amp; SaaS optimisation</span>
      <span class="label">Body · 15 / 400</span><span>Shelfware, Microsoft over-licensing and renewals without competitive tension.</span>
      <span class="label">Label · mono 11</span><span class="label" style="color:var(--ink-2)">Net savings · CY27</span>
    </div></div>
  </section>
  <section>
    <div class="sec-h"><h2>Glass</h2><span class="faint small">Five layers, the same everywhere.</span></div>
    <div class="grid">
      <div class="c7 glass pad"><div class="layer-stack" aria-hidden="true">
        ${[['Sky · aurora + 5% grain', 'linear-gradient(135deg,var(--aur-1),var(--aur-2) 60%,var(--aur-3))', ''], ['Blur 28px · saturate 150%', 'rgba(140,180,230,.08)', 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'], ['Tint · 5.5 → 10% white', 'linear-gradient(180deg,var(--glass-2),var(--glass))', ''], ['Hairline · 1px at 11%', 'transparent', 'border-color:var(--ink-2);'], ['Highlight · inset 1px top', 'transparent', 'box-shadow:inset 0 2px 0 var(--ink);']]
          .map(([l, bg, x], i) => `<div class="layer" style="left:${8 + i * 9}%;top:${i * 44}px;background:${bg};border:1px solid var(--glass-line);${x}"><span>${l}</span></div>`).join('')}
      </div></div>
      <div class="c5 stack">
        <div class="glass pad"><div class="label">Panel</div><p class="small muted" style="margin-top:6px">radius 22 · padding 22 / 24 · shadow 0 30 70 −30</p></div>
        <div class="glass tight" style="border-radius:16px"><div class="label">Control</div><p class="small muted" style="margin-top:6px">radius 12–16 · no shadow · tint 10%</p></div>
        <div class="well" style="padding:16px 18px"><div class="label">Well (inside glass)</div><p class="small muted" style="margin-top:6px">flat tint, hairline only</p></div>
      </div>
    </div>
  </section>
  <section>
    <div class="sec-h"><h2>Motion</h2><span class="faint small">420ms ease-out for values, a soft spring for thumbs and toggles, 90ms stagger for lists. All off under reduced motion.</span></div>
    <div class="grid">
      <div class="glass pad c3 motion-card"><div class="label">Number roll</div><div class="motion-stage"><span class="big-num" id="mo-roll">$119.3M</span></div><p class="faint xs">Outputs count to their new value.</p></div>
      <div class="glass pad c3 motion-card"><div class="label">Spring thumb</div><div class="motion-stage" style="padding:0 22px">${slider('mo', 'Cloud cost reduction', 0.3, 0, 0.6, 0.01, (v) => pct(v), { ghosts: [['C', 0.3], ['D', 0.35]] })}</div><p class="faint xs">Ghost ticks show where C and D sit.</p></div>
      <div class="glass pad c3 motion-card"><div class="label">Solver settle</div><div class="motion-stage"><svg viewBox="0 0 200 90" width="200" height="90" aria-hidden="true" id="mo-settle">${[0, 1, 2, 3, 4].map((i) => `<line x1="20" x2="180" y1="${14 + i * 16}" y2="${14 + i * 16}" stroke="var(--track)" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="${14 + i * 16}" r="5" fill="#fff"><animate attributeName="cx" values="60;${80 + i * 20};${80 + i * 20}" dur="2.8s" begin="${i * .09}s" repeatCount="indefinite" calcMode="spline" keySplines=".2 .8 .2 1;0 0 1 1"/></circle>`).join('')}</svg></div><p class="faint xs">Moves land one by one, most valuable first.</p></div>
      <div class="glass pad c3 motion-card"><div class="label">Cause flash</div><div class="motion-stage"><span class="mid-num" id="mo-flash" style="padding:4px 8px;border-radius:8px">$211.8M</span></div><p class="faint xs">A recalculated number glows once.</p></div>
    </div>
  </section>
  <section>
    <div class="sec-h"><h2>Charts</h2><span class="faint small">Thin marks, rounded data ends, recessive grid, one dashed reference line for the bar.</span></div>
    <div class="grid">
      <div class="glass pad c4"><div class="label" style="margin-bottom:8px">Gauge</div>${gauge(119.3, 143, 100)}</div>
      <div class="glass pad c4"><div class="label" style="margin-bottom:8px">Distribution vs bar</div>${hist(62.8, 102, 135.6, 144.4)}<div class="label" style="margin:22px 0 8px">Bullet</div>
        <div style="position:relative;height:12px;border-radius:6px;background:var(--track)"><i style="position:absolute;inset:0 auto 0 0;width:72%;background:var(--vp1);border-radius:6px"></i><i style="position:absolute;top:-4px;bottom:-4px;left:84%;width:2px;background:var(--ink)"></i></div></div>
      <div class="glass pad c4"><div class="label" style="margin-bottom:8px">Rules</div><div class="list small">${['Never two y-axes', 'Bar = dashed ink line, labelled', 'Colour follows the entity, never its rank', 'Every chart has hover and a table view', 'Truncated axes carry a break mark', 'Text in ink, never in series colour'].map((r) => `<div class="li" style="grid-template-columns:auto 1fr"><span class="dot"></span><span>${r}</span></div>`).join('')}</div></div>
    </div>
  </section>
  <section>
    <div class="sec-h"><h2>Icons</h2><span class="faint small">24px grid, 1.5 stroke, round joins. No emoji, no airline marks.</span></div>
    <div class="glass pad"><div class="row wrap" style="gap:26px">${['cockpit', 'baseline', 'levers', 'vps', 'solver', 'market', 'data', 'airlines', 'search', 'trace', 'lock', 'spark', 'export', 'import', 'undo'].map((k) => `<span class="stack" style="align-items:center;gap:8px"><svg viewBox="0 0 24 24" width="28" height="28" style="stroke:var(--ink);fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round" aria-hidden="true">${ICONS[k]}</svg><span class="faint xs">${k}</span></span>`).join('')}</div></div>
  </section>
  <section>
    <div class="sec-h"><h2>Words</h2><span class="faint small">The app speaks the room's language.</span></div>
    <div class="glass pad"><div class="row wrap">${[['Bar', 'target + cost growth = $143.0M'], ['Net', 'savings − one-time in IT'], ['Gap', 'net − bar'], ['Run-rate', 'full-year 2028 effect'], ['Locked', 'cannot move in 12 months'], ['Path', 'a solver answer you can open and edit']].map(([w, d]) => `<span class="chip" style="height:auto;padding:8px 12px"><b style="color:var(--ink);font-weight:600">${w}</b>&nbsp;${d}</span>`).join('')}</div></div>
  </section></div>`;
}

function vIA() {
  const mods = [
    ['Cockpit', ['Net vs bar', 'CY26→CY27 bridge', 'Hero inputs', 'VP, EPS, odds']],
    ['Baseline', ['Treemap by pool, domain, VP', 'Line table', 'Line editor']],
    ['Levers', ['17 lever cards', 'Parameters, timing, confidence', 'Monthly curve']],
    ['VPs', ['Targets & bars', 'Who owns what', 'Chargeback']],
    ['Path', ['Goal & constraints', 'Ranked moves', 'Frontier, odds, tornado']],
    ['Market', ['Trace to share price', 'Driver dials', 'EPS & price']],
    ['Excel', ['Export template', 'Import & 3-way diff', 'Apply changeset']],
    ['Airlines', ['Tenant switcher', 'AI reconfiguration', 'Onboarding']],
  ];
  const W = 1120, bw = 124, gx = (W - 8 * bw) / 9;
  let s = `<rect x="${W / 2 - 110}" y="6" width="220" height="44" rx="14" fill="var(--glass-2)" stroke="var(--glass-line)"/><text x="${W / 2}" y="33" text-anchor="middle" class="h">Airline · American</text>`;
  s += `<line x1="${W / 2}" y1="50" x2="${W / 2}" y2="74" stroke="var(--ink-3)"/>`;
  s += `<rect x="${W / 2 - 230}" y="74" width="460" height="44" rx="14" fill="var(--glass-2)" stroke="var(--accent)"/><text x="${W / 2}" y="101" text-anchor="middle" class="h">Scenario · Rates · A · B · C · D · Custom · Paths</text>`;
  s += `<line x1="${gx + bw / 2}" y1="140" x2="${W - gx - bw / 2}" y2="140" stroke="var(--ink-3)"/><line x1="${W / 2}" y1="118" x2="${W / 2}" y2="140" stroke="var(--ink-3)"/>`;
  mods.forEach(([n, subs], i) => {
    const x = gx + i * (bw + gx);
    s += `<line x1="${x + bw / 2}" y1="140" x2="${x + bw / 2}" y2="158" stroke="var(--ink-3)"/>`;
    s += `<rect x="${x}" y="158" width="${bw}" height="40" rx="12" fill="var(--glass-3)" stroke="var(--glass-line)"/><text x="${x + bw / 2}" y="183" text-anchor="middle" class="h">${n}</text>`;
    subs.forEach((t, j) => { s += `<text x="${x + 8}" y="${222 + j * 20}" style="font-size:11px">· ${t.length > 19 ? t.slice(0, 18) + '…' : t}</text>`; });
  });
  s += `<rect x="0" y="310" width="${W}" height="54" rx="16" fill="none" stroke="var(--glass-line)" stroke-dasharray="4 4"/>`;
  ['Flight strip (HUD)', 'Scenario bar', '⌘K find any number', 'Edit popover', 'Trace drawer', 'Edits & undo', 'Theme'].forEach((t, i) => { s += `<text x="${30 + i * 158}" y="342" class="h" style="font-size:12px">${t}</text>`; });
  s += `<text x="${W / 2}" y="384" text-anchor="middle" style="font-size:11px">Global layer: present on every module</text>`;
  const rows = [
    ['Cockpit', 'Can we reach the bar?', 'Target, outside funding, headcount', 'Net, gap, risk-adj., VP gaps, EPS', 'Blend C→D'],
    ['Baseline', 'Where is the money, and what can move?', 'Line amounts, capex share, tags, growth', 'Totals by pool / domain / VP, locked %', '—'],
    ['Levers', 'What does each lever give, when?', '61 lever inputs, start, ramp, conf, on/off', 'In-year, run-rate, one-time, monthly', 'Breakeven per lever'],
    ['VPs', 'Is each VP on the hook fairly?', 'Ownership matrix, method, chargeback', 'VP outlay, target, bar, gap', 'All-VP feasible plan'],
    ['Path', 'What is the least risky way there?', 'Goal, objective, constraints', 'Moves, risk, one-time, P(clear)', 'Min-risk, Pareto, Monte Carlo, tornado'],
    ['Market', 'What is it worth to shareholders?', '91 corporate drivers, multiple', 'EBITDA, EPS, price, market cap', 'Stress presets'],
    ['Excel', 'Can my team work offline?', 'Workbook', 'Delta list, conflicts, validation', '—'],
    ['Airlines', 'Can this run for UA or AS?', 'Prompt, tenant seed', 'Changeset, calibration check', 'AI reconfiguration job'],
  ];
  return `<div class="doc">
    <section style="margin-top:4px"><span class="eyebrow">Structure</span><h2 style="margin-top:8px">One airline, one scenario, eight places to work</h2>
      <p class="lede">Every screen reads the same scenario. Change a number anywhere and the flight strip at the bottom moves, so the room never loses the plot.</p></section>
    <section><div class="glass pad" style="overflow-x:auto"><svg class="ia-svg" viewBox="0 0 ${W} 396" style="min-width:880px;width:100%;display:block" role="img" aria-label="Site map">${s}</svg></div></section>
    <section><div class="sec-h"><h2>Objects</h2></div>
      <div class="glass pad"><div class="row wrap" style="gap:10px">${['Tenant', 'Model version', 'Scenario', 'Changeset', 'Input value', 'Formula node', 'Solver run'].map((o, i, a) => `<span class="chip acc" style="height:34px;padding:0 14px">${o}</span>${i < a.length - 1 ? ic('chev', 'faint').replace('<svg', '<svg style="width:16px;height:16px;stroke:var(--ink-3);fill:none;stroke-width:1.6"') : ''}`).join('')}</div>
      <p class="small muted" style="margin-top:14px;max-width:80ch">A solver run always lands as a new scenario. An Excel import always lands as one changeset. Nothing overwrites a preset; edits make a Custom copy that can be renamed and compared.</p></div></section>
    <section><div class="sec-h"><h2>Modules</h2></div><div class="glass pad tbl-wrap"><table class="tbl"><thead><tr><th>Module</th><th>Question</th><th>You change</th><th>You see</th><th>Solver hook</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? 'muted' : ''}" style="${i === 0 ? 'font-weight:500' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
    <section><div class="sec-h"><h2>Rules</h2></div><div class="grid">
      ${[['Every number is editable', 'Click any figure: popover with value, range, source, confidence and reset. Calculated numbers can be pinned with a reason.'],
        ['Decisions vs estimates', 'Decisions have a white thumb. Estimates carry a lock and a grey thumb: solvers hold them still.'],
        ['Presets are read-only', 'The first edit forks a Custom scenario and the edits counter starts. Undo walks back one change at a time.'],
        ['Trace anything', 'Every output opens a drawer with its formula, its upstream values and its top drivers.'],
        ['Phone works', 'The rail becomes a bottom bar, panels stack, the flight strip keeps net, bar and gap.'],
        ['One name per idea', 'Bar, net, gap, run-rate, locked and path mean the same thing on every screen and in Excel.']]
        .map(([h, p]) => `<div class="glass pad c4"><h3>${h}</h3><p class="faint small" style="margin-top:8px">${p}</p></div>`).join('')}</div></section>
  </div>`;
}

function vComps() {
  const c = (name, stage, meta) => `<div class="glass pad comp"><div class="spread"><h3>${name}</h3></div><div class="stage">${stage}</div><p class="meta">${meta}</p></div>`;
  return `<div class="doc"><section style="margin-top:4px"><span class="eyebrow">Inventory</span><h2 style="margin-top:8px">27 parts</h2><p class="lede">Live specimens. Names match the build backlog that comes next.</p></section>
  <section><div class="sec-h"><h2>Shell</h2></div><div class="comp-grid">
    ${c('Rail', `<div class="rail" style="position:relative;height:auto;flex-direction:row;border:0;background:none;padding:0;top:0"><a aria-current="page">${ic('cockpit')}<span>Cockpit</span></a><a>${ic('levers')}<span>Levers</span></a><a>${ic('solver')}<span>Path</span></a></div>`, 'Icon + 10px label · current = tint + accent stroke · bottom bar under 760px')}
    ${c('Scenario bar', seg('demo', [['C', '<span class="k">C</span>Balanced'], ['D', '<span class="k">D</span>Full stretch']], 'C'), 'Segmented, pressed state = glass-3 · fork to Custom on first edit')}
    ${c('Flight strip (HUD)', `<div class="glass" style="display:flex;padding:8px;border-radius:18px"><div class="hud" style="position:static;transform:none;padding:0"><div class="cell"><span class="label">Net</span><span class="v">$119.3M</span></div><div class="cell"><span class="label">Gap</span>${gapChip(-23.7)}</div></div></div>`, 'Fixed bottom · net, bar, gap, risk-adj., EPS · hidden on Cockpit')}
    ${c('Command palette', `<button class="search" type="button">${ic('search')}<span>Find any number</span><span class="kbd">⌘K</span></button>`, 'Searches 194 inputs, 17 levers, screens · Enter jumps and focuses')}
    ${c('Edits counter', `<span class="edits"><span class="dot"></span><b>3</b> edits</span><button class="iconbtn" type="button" aria-label="Undo">${ic('undo')}</button>`, 'Opens the changeset tray · undo / redo · save as scenario')}
    ${c('Tenant button', `<span class="tenant-btn" style="margin:0">AA</span><span class="tenant-btn" style="margin:0;opacity:.6">UA</span>`, 'IATA code only, no marks · opens Airlines')}
  </div></section>
  <section><div class="sec-h"><h2>Inputs</h2></div><div class="comp-grid">
    ${c('Slider · decision', `<div style="width:100%">${slider('c1', 'Shelfware harvested', 0.1, 0, 0.3, 0.01, (v) => pct(v), { ghosts: [['C', 0.1], ['D', 0.12]] })}</div>`, 'White thumb, accent fill, C / D ghost ticks · step from registry')}
    ${c('Slider · estimate', `<div style="width:100%">${slider('c2', 'Share renewing in 2027', 0.6, 0.2, 1, 0.01, (v) => pct(v), { est: true })}</div>`, 'Lock icon, grey fill · solvers never move it')}
    ${c('Editable number', `<span class="mid-num ed changed">$36.6M</span><span class="faint small">dotted on hover, solid once changed</span>`, 'Any figure · opens Edit popover')}
    ${c('Edit popover', `<div class="glass" style="padding:14px;border-radius:16px;width:100%"><div class="spread"><span class="label">Net target</span><span class="chip">$M</span></div><div class="mid-num" style="margin:10px 0">$100M</div><div class="row wrap"><span class="chip">Source · User</span><span class="chip">Conf · High</span></div></div>`, 'Value, slider, source, confidence, default, reset, pin')}
    ${c('Dial', `<div class="knob" data-knob="brent" style="pointer-events:none">${knob('brent').replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '')}</div>`, 'Drag up/down or arrow keys · ghost tick = default')}
    ${c('Toggle · stepper · segmented', `${toggle('cx', true, 'demo')}<div class="stepper"><button type="button">−</button><input value="3,000" aria-label="demo"><button type="button">+</button></div>${seg('d2', [['1', 'Prop.'], ['2', 'Equal']], '1', 'sm')}`, 'Lever on/off, headcount, methods')}
    ${c('Ownership bar', `<div class="ownbar" style="width:100%"><i style="width:40%;background:var(--vp1)">40%</i><i style="width:35%;background:var(--vp2)">35%</i><i style="width:25%;background:var(--vp3)">25%</i></div>`, 'Drag dividers in 5% steps · row always sums to 100%')}
    ${c('Radio card', `<label class="radio-card" style="width:100%"><input type="radio" checked name="rc">Lowest delivery risk</label>`, 'Solver objective')}
    ${c('Prompt bar', `<div class="prompt" style="width:100%"><input value="Set up Alaska Airlines" aria-label="demo"><button class="btn primary" type="button">Draft</button></div>`, 'AI reconfiguration · always ends in a reviewable changeset')}
  </div></section>
  <section><div class="sec-h"><h2>Outputs</h2></div><div class="comp-grid">
    ${c('Gauge', `<div style="width:200px">${gauge(119.3, 143, 100)}</div>`, 'Net vs bar, target notch dashed, bar notch solid')}
    ${c('Ring tile', `${ring(31.7, 36.6, 'var(--vp1)')}<div class="stack" style="gap:4px"><span class="mid-num">$31.7M</span>${gapChip(-4.9)}</div>`, 'VP net / bar')}
    ${c('Status chip', `${gapChip(23.9)}${gapChip(-4.9)}<span class="chip warn">1 conflict</span>`, 'Icon + word + number · never colour alone')}
    ${c('Waterfall', `<div style="width:100%">${waterfall(Object.assign({}, R(), {}))}</div>`, 'Bridge with axis break mark and target line')}
    ${c('Treemap', `<div style="width:100%;max-height:140px;overflow:hidden">${treemap('pool')}</div>`, 'Two levels, coloured by addressability, click to focus')}
    ${c('Histogram', `<div style="width:100%">${hist(49.5, 74.5, 97.4, 144.4, { lo: 20, hi: 170 })}</div>`, 'Monte Carlo · bins past the bar turn green')}
    ${c('Tornado', `<div style="width:100%">${tornado().replace('viewBox="0 0 360', 'viewBox="0 0 360').slice(0)}</div>`, 'Policy / timing inputs in amber')}
    ${c('Trace node', `<button class="tnode hl" type="button" style="flex:none"><span class="label">EPS</span><span class="mid-num">+$0.091</span><span class="faint xs">+19.6% vs base</span></button>`, 'Click opens Trace drawer')}
    ${c('Move row', `<div class="move" style="width:100%;border:0"><span class="rank">01</span><span class="small">Vendor COLA refused</span><span class="mv-track"><s style="left:70%"></s><i style="left:70%;width:30%"></i><b style="left:100%"></b></span><span class="num small">70% → 100%</span></div>`, 'Solver result · from tick, to thumb')}
    ${c('Diff row', `<table class="tbl" style="width:100%"><tr><td>L08 rate cut</td><td class="r faint">5%</td><td class="r" style="color:var(--accent)">7%</td><td style="width:56px">${toggle('df', true, 'accept')}</td></tr></table>`, 'Exported · file · app now · take')}
    ${c('Monthly curve', `<div style="width:100%">${areaChart(R())}</div>`, 'Stacked by lever family · line = selected lever')}
    ${c('Toast', `<div class="glass" style="padding:10px 16px;border-radius:14px;font-size:13px">Scenario Balanced · net $119.3M</div>`, 'Top centre · 2.4s · confirms cause and effect')}
  </div></section></div>`;
}

function vStory() {
  const beats = [
    ['0:00', 'Cockpit', 'Open on Balanced. Point at the gauge and the bar notch.', 'Ten percent sounds like a hundred million. With cost growth absorbed it is a hundred and forty-three.'],
    ['2:00', 'Baseline', 'Group by pool, then click Airline platforms and US labour.', 'A fifth of the money is locked for 2027. Sabre was renewed in December 2024, so the platforms barely move.'],
    ['4:00', 'Cockpit · R', 'Switch the scenario bar to Rates only.', 'The instinctive move, squeezing vendor rates, gets eight million. It is not a plan.'],
    ['5:00', 'Levers', 'Back to C. Open Software, drag shelfware, toggle Cloud FinOps off and on.', 'Seventeen levers, each with its own timing and confidence. Watch the strip at the bottom.'],
    ['8:00', 'VPs', 'Show four bars. Drag Data & analytics ownership toward Commercial.', 'Every VP is short today. Ownership and chargeback decide who carries what, and you can change both here.'],
    ['10:00', 'Path', 'Press Find a path. Let the moves land.', 'The least risky way to one forty-three leaves people levers alone. It refuses vendor COLA and contains growth first.'],
    ['12:30', 'Path · odds', 'Point at 0% and 4.5%.', 'If each lever only delivers its confidence, even full stretch rarely clears. That is why AA has to own the path.'],
    ['14:00', 'Market', 'Walk the trace from net savings to share price. Turn Brent up ten dollars.', 'Balanced is worth about nine cents of EPS and a dollar a share. The same as 1.7 cents off every gallon of fuel.'],
    ['16:00', 'Cockpit', 'Hand over the controls. Let the MD move one-time funding and the target.', 'Every number on this screen is yours to change.'],
    ['18:00', 'Excel', 'Export C + D. Show the import review with one conflict.', 'Your team can work in Excel. The app reads it back and shows exactly what changed.'],
    ['19:30', 'Airlines', 'Show UA and AS tiles. Close.', 'American is the first airline on it, not the only one.'],
  ];
  return `<div class="doc"><section style="margin-top:4px"><span class="eyebrow">Friday 4 December 2026 · 20 minutes</span><h2 style="margin-top:8px">The target is hard. Here is how AA builds its own path.</h2>
    <p class="lede">One storyline, eleven beats, one hand-over. Rehearse with the share price refreshed and the EIA December outlook loaded.</p></section>
    <section>${beats.map(([t, scr, act, say]) => `<div class="beat"><span class="time">${t}</span><span class="line"><i></i></span><div class="glass card"><div class="stack" style="gap:8px"><span class="chip acc" style="align-self:flex-start">${scr}</span><span class="small muted">${act}</span></div><p class="say">${say}</p></div></div>`).join('')}</section>
    <section><div class="sec-h"><h2>Ready for questions</h2></div><div class="grid">
      ${[['"What if the GCC can\'t hire?"', 'Path → hold GCC hiring capacity · rerun'], ['"What if vendors win COLA?"', 'Levers → L17 COLA refused to 0%'], ['"Who pays the one-time?"', 'Cockpit → outside funding 0% / 100%'], ['"Show me one line."', 'Baseline → click → edit amount'], ['"What about depreciation?"', 'Market → Trace → EPS formula'], ['"Can we start in Q2?"', 'Levers → start month for the people levers']]
        .map(([q, a]) => `<div class="glass pad c4"><p class="small" style="font-weight:500">${q}</p><p class="faint small" style="margin-top:6px">${a}</p></div>`).join('')}</div></section>
    <section><div class="sec-h"><h2>Before the day</h2></div><div class="glass pad"><div class="list">${['Refresh AAL share price and Brent / jet with the EIA December STEO', 'Lock a demo copy of the AA tenant; reset to Balanced before walking in', 'Dry run on the room\'s screen in both Cruise and Daylight', 'Pre-run Monte Carlo for C and D so odds appear instantly', 'Print the storyline card; keep the Excel file from the rehearsal for the import beat'].map((t) => `<div class="li" style="grid-template-columns:auto 1fr"><span class="st-ic"></span><span class="small">${t}</span></div>`).join('')}</div></div></section>
  </div>`;
}

/* motion specimens on the moodboard */
setInterval(() => {
  const r = document.getElementById('mo-roll');
  if (r) { const v = parseFloat(r.dataset.v || 119.3) > 130 ? 119.3 : 143.0; roll(r, v, (x) => '$' + x.toFixed(1) + 'M', 900); }
  const f = document.getElementById('mo-flash');
  if (f) { f.classList.remove('flash'); void f.offsetWidth; f.classList.add('flash'); }
}, 2200);
