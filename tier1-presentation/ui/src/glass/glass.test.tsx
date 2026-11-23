// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Aurora,
  GLASS_BLUR_BUDGET,
  GlassPanel,
  GlassProvider,
  Grid,
  GridCell,
  LOW_BLUR_FRAME_MS,
  SKELETON_OPACITY,
  SPANS,
  Skeleton,
  createGlassBudget,
  glassCss,
  isSlow,
  sampleFrameTime,
  spanAt,
  viewportFor,
  type GlassLevel,
  type Span,
} from './index';
import { CockpitComposite } from './stories/CockpitComposite';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** CSS rules of glassCss as [selector, body] (flattening @media blocks, keeping the query). */
function rules(css = glassCss): { media: string | null; selector: string; body: string }[] {
  const out: { media: string | null; selector: string; body: string }[] = [];
  const re = /@media ([^{]+)\{([\s\S]*?)\n\}|([^{}@]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    if (m[1]) {
      for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        out.push({ media: m[1].trim(), selector: r[1]!.trim(), body: r[2]!.trim() });
    } else out.push({ media: null, selector: m[3]!.trim(), body: m[4]!.trim() });
  }
  return out;
}
const rule = (selector: string, media: string | null = null) =>
  rules().find((r) => r.selector === selector && r.media === media)?.body;

/** jsdom has no matchMedia; this stub answers the reduced-transparency query. */
const stubMatchMedia = (reduceTransparency: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-transparency') ? reduceTransparency : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

const renderComposite = (props: Parameters<typeof CockpitComposite>[0] = {}) =>
  render(
    <GlassProvider frameSampling={false}>
      <CockpitComposite {...props} />
    </GlassProvider>,
  );

describe('UI-02 GlassPanel levels, header slot and 12-column grid (component + layout snapshot)', () => {
  it('levels glass-1/2/3 follow the glass recipe: blur+saturate, tint gradient, hairline, highlight + shadow', () => {
    render(
      <GlassProvider frameSampling={false}>
        {([1, 2, 3] as GlassLevel[]).map((l) => (
          <GlassPanel key={l} level={l} data-testid={`l${l}`} />
        ))}
      </GlassProvider>,
    );
    for (const l of [1, 2, 3]) expect(screen.getByTestId(`l${l}`).dataset.level).toBe(String(l));

    // 2. backdrop blur(28px) saturate(150%), from tokens
    expect(rule('.gp-panel[data-blur="on"]')).toContain(
      'backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate))',
    );
    const base = rule('.gp-panel')!;
    // 3. tint: vertical gradient glass-2 -> glass
    expect(base).toContain('background: linear-gradient(180deg, var(--glass-2), var(--glass))');
    // 4. hairline: 1px glass-line ; 5. highlight inset glass-hi + soft drop shadow
    expect(base).toContain('border: 1px solid var(--glass-line)');
    expect(base).toContain('box-shadow: inset 0 1px 0 var(--glass-hi), var(--shadow)');
    expect(base).toContain('border-radius: var(--radius-panel)');
    expect(rule('.gp-panel[data-level="2"]')).toBe(
      'background: linear-gradient(180deg, var(--glass-3), var(--glass-2));',
    );
    expect(rule('.gp-panel[data-level="3"]')).toBe('background: var(--glass-3);');
    expect(rule('.gp-panel[data-pad="panel"]')).toBe('padding: var(--space-panel-pad);');
  });

  it('header slot names the panel and has a status chip area', () => {
    render(
      <GlassProvider frameSampling={false}>
        <GlassPanel header={{ label: 'Net savings · CY27', status: <span>chip</span> }}>
          body
        </GlassPanel>
      </GlassProvider>,
    );
    const region = screen.getByRole('region', { name: 'Net savings · CY27' });
    const status = region.querySelector('.gp-panel-h > .gp-panel-status')!;
    expect(status.textContent).toBe('chip');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('heading', { level: 2 }).className).toBe('gp-label');
    expect(rule('.gp-label')).toContain('text-transform: uppercase');
    expect(rule('.gp-label')).toContain('letter-spacing: var(--type-xs-tracking)');
    expect(rule('.gp-panel-h')).toContain('justify-content: space-between');
    expect(
      region.outerHTML.replace(/id="[^"]+"|aria-labelledby="[^"]+"/g, ''),
    ).toMatchInlineSnapshot(
      `"<section class="gp-panel" data-level="1" data-blur="on" data-quality="full" data-pad="panel" ><header class="gp-panel-h"><h2  class="gp-label">Net savings · CY27</h2><div class="gp-panel-status" aria-live="polite"><span>chip</span></div></header><div class="gp-body">body</div></section>"`,
    );
  });

  it('grid is 12 columns with the token gap; 6/12 below 1180 px, stacked below 760 px', () => {
    expect(rule('.gp-grid')).toBe(
      'display: grid; grid-template-columns: repeat(var(--space-grid-columns), minmax(0, 1fr)); gap: var(--space-gap);',
    );
    for (const s of SPANS) {
      expect(rule(`.gp-span-${s}`)).toBe(`grid-column: span ${s};`);
      expect(rule(`.gp-span-${s}`, '(max-width: 1180px)')).toBe(
        `grid-column: span ${spanAt(s, 'tablet')};`,
      );
      expect(rule(`.gp-span-${s}`, '(max-width: 760px)')).toBe('grid-column: span 12;');
    }
    expect([1440, 1181, 1180, 761, 760, 390].map(viewportFor)).toEqual([
      'desktop',
      'desktop',
      'tablet',
      'tablet',
      'phone',
      'phone',
    ]);

    // layout snapshot of the Cockpit composite at the three widths
    renderComposite();
    const grid = screen.getByTestId('cockpit-grid');
    const cells = [...grid.children].map((el) => {
      const span = Number(/gp-span-(\d+)/.exec(el.className)![1]) as Span;
      const name = el.getAttribute('data-testid') ?? el.querySelector('.gp-label')!.textContent;
      return { name, span };
    });
    const layout = Object.fromEntries(
      [1440, 1000, 390].map((w) => [
        w,
        cells.map((c) => `${c.name}:${spanAt(c.span, viewportFor(w))}`).join(' | '),
      ]),
    );
    expect(layout).toMatchInlineSnapshot(`
      {
        "1000": "hero:12 | outlay+inputs:12 | vp-1:6 | vp-2:6 | vp-3:6 | vp-4:6 | Shareholder view · 2027:12 | Odds:12 | Fastest path to the bar:12",
        "1440": "hero:5 | outlay+inputs:7 | vp-1:3 | vp-2:3 | vp-3:3 | vp-4:3 | Shareholder view · 2027:4 | Odds:4 | Fastest path to the bar:4",
        "390": "hero:12 | outlay+inputs:12 | vp-1:12 | vp-2:12 | vp-3:12 | vp-4:12 | Shareholder view · 2027:12 | Odds:12 | Fastest path to the bar:12",
      }
    `);
  });

  it('GridCell stacks children with the token gap', () => {
    const { container } = render(
      <Grid>
        <GridCell span={7} stack>
          a
        </GridCell>
      </Grid>,
    );
    expect(container.innerHTML).toBe(
      '<div class="gp-grid"><div class="gp-span-7 gp-stack">a</div></div>',
    );
    expect(rule('.gp-stack')).toContain('gap: var(--space-gap)');
  });
});

describe('UI-02 pre-blurred aurora and backdrop-filter budget (composite story)', () => {
  it('the aurora is pre-blurred: no filter or backdrop-filter on the sky', () => {
    render(
      <GlassProvider frameSampling={false}>
        <Aurora />
      </GlassProvider>,
    );
    const sky = document.querySelector('.gp-aurora')!;
    expect(sky.getAttribute('aria-hidden')).toBe('true');
    expect(sky.querySelectorAll('i')).toHaveLength(3);
    const skyRules = rules().filter((r) => r.selector.startsWith('.gp-aurora'));
    expect(skyRules.length).toBeGreaterThan(4);
    for (const r of skyRules) expect(r.body).not.toMatch(/(^|[\s;])(-webkit-)?(backdrop-)?filter:/);
    expect(rule('.gp-aurora i:nth-child(1)')).toContain(
      'radial-gradient(circle closest-side, var(--aurora-1) 0%',
    );
    expect(rule('.gp-aurora i:nth-child(3)')).toContain('var(--aurora-3)');
    expect(rule('.gp-aurora::after')).toContain('opacity: var(--noise)');
    // drift 46-60 s from motion.skyDrift
    expect(glassCss).toMatch(/gp-drift1 46s/);
    expect(glassCss).toMatch(/gp-drift3 60s/);
  });

  it('only budgeted surfaces carry backdrop-filter in the CSS', () => {
    const withBackdrop = rules().filter((r) => /backdrop-filter/.test(r.body));
    expect(withBackdrop.length).toBeGreaterThan(0);
    for (const r of withBackdrop) expect(r.selector).toContain('[data-blur="on"]');
  });

  it('at most three backdrop-filter layers on screen in the Cockpit composite with overlays', () => {
    renderComposite({ overlays: true });
    const surfaces = document.querySelectorAll('.gp-panel');
    expect(surfaces.length).toBe(14);
    const blurred = document.querySelectorAll('[data-blur="on"]');
    expect(blurred.length).toBeLessThanOrEqual(GLASS_BLUR_BUDGET);
    // overlays (level 3) get the slots; panels stay tint-only over the pre-blurred sky
    expect([...blurred].map((e) => e.getAttribute('data-testid'))).toEqual([
      'popover',
      'palette',
      'drawer',
    ]);
    // count on screen: every element matched by any CSS rule that sets backdrop-filter
    // (jsdom does not compute backdrop-filter, so match the rules' selectors directly)
    const counted = new Set<Element>();
    for (const r of rules().filter((x) => /backdrop-filter/.test(x.body)))
      document.querySelectorAll(r.selector).forEach((el) => counted.add(el));
    expect(counted.size).toBe(3);
    expect(counted.size).toBeLessThanOrEqual(GLASS_BLUR_BUDGET);
  });

  it('closing an overlay frees its slot; a level never splits (uniform look)', () => {
    const b = createGlassBudget();
    const panels = [1, 2].map(() => b.register(1));
    expect(panels.every(b.blurred)).toBe(true);
    const overlays = [3, 3].map((l) => b.register(l as GlassLevel));
    expect(overlays.every(b.blurred)).toBe(true);
    expect(panels.some(b.blurred)).toBe(false); // 2 panels do not fit in 1 slot: none blur
    expect(b.blurCount()).toBe(2);
    b.unregister(overlays[0]!);
    expect(panels.every(b.blurred)).toBe(true);
    expect(b.blurCount()).toBe(3);
    const extra = [b.register(3), b.register(3), b.register(3), b.register(3)];
    expect(b.blurCount()).toBeLessThanOrEqual(3);
    expect(extra.some(b.blurred)).toBe(false);
  });
});

describe('UI-02 low-blur fallback', () => {
  it('prefers-reduced-transparency switches panels and sky to the low-blur fallback', async () => {
    stubMatchMedia(true);
    await act(async () => renderComposite({ overlays: true }));
    for (const el of document.querySelectorAll('.gp-panel, .gp-aurora'))
      expect(el.getAttribute('data-quality')).toBe('low');
    // CSS: same fallback without JS
    const q = '(prefers-reduced-transparency: reduce)';
    expect(rule('.gp-panel[data-blur="on"]', q)).toContain('blur(calc(var(--glass-blur) / 4))');
    expect(rule('.gp-panel[data-level="1"]', q)).toContain('var(--glass-3), var(--glass-2)');
    expect(rule('[data-quality="low"].gp-panel[data-blur="on"]')).toContain(
      'blur(calc(var(--glass-blur) / 4))',
    );
    expect(rule('.gp-aurora[data-quality="low"] i')).toBe('animation: none;');
  });

  it('no preference keeps full glass', async () => {
    stubMatchMedia(false);
    await act(async () => renderComposite());
    expect(document.querySelector('.gp-panel')!.getAttribute('data-quality')).toBe('full');
  });

  it('frame-time sampling: slow frames switch to low blur, smooth frames do not', async () => {
    const fakeRaf = (frameMs: number) => {
      let t = 0;
      const queue: ((t: number) => void)[] = [];
      return {
        raf: (cb: (t: number) => void) => queue.push(cb),
        flush: (n: number) => {
          for (let i = 0; i < n && queue.length; i++) queue.shift()!((t += frameMs));
        },
      };
    };
    for (const [frameMs, expected] of [
      [33, 'low'],
      [16.7, 'full'],
    ] as const) {
      const clock = fakeRaf(frameMs);
      render(
        <GlassProvider frameSampling={{ raf: clock.raf, cancelRaf: () => {} }}>
          <GlassPanel data-testid="p" />
        </GlassProvider>,
      );
      await act(async () => clock.flush(200));
      expect(screen.getByTestId('p').getAttribute('data-quality')).toBe(expected);
      cleanup();
    }
    expect(isSlow([LOW_BLUR_FRAME_MS + 5, LOW_BLUR_FRAME_MS + 5, 10])).toBe(true);
    expect(isSlow([16, 17, 16, 5000])).toBe(false); // a hidden-tab pause is not jank
    const done = vi.fn();
    const stop = sampleFrameTime(done, { raf: () => 0 });
    stop();
    expect(done).not.toHaveBeenCalled();
  });
});

describe('UI-02 Skeleton loading state', () => {
  it('skeletons render at 40% opacity, static, hidden from assistive tech; no spinners in panels', () => {
    renderComposite({ loading: true });
    expect(SKELETON_OPACITY).toBe(0.4);
    expect(rule('.gp-skel')).toContain('opacity: 0.4');
    const panels = document.querySelectorAll('.gp-panel');
    expect(panels.length).toBe(10);
    for (const p of panels) {
      expect(p.getAttribute('aria-busy')).toBe('true');
      expect(p.querySelector('.gp-panel-h .gp-label')).not.toBeNull(); // header stays
      const skels = p.querySelectorAll('.gp-body .gp-skel');
      expect(skels.length).toBeGreaterThan(0);
      skels.forEach((s) => expect(s.getAttribute('aria-hidden')).toBe('true'));
      expect(p.querySelector('[role="progressbar"], progress, svg, [class*="spin"]')).toBeNull();
    }
    // nothing animates while loading: no spinner keyframes, skeleton rules carry no animation
    expect(glassCss).not.toMatch(/spin|rotate\(/);
    for (const r of rules().filter((x) => x.selector.includes('gp-skel')))
      expect(r.body).not.toMatch(/animation|transition/);
  });

  it('numbers fade in once evaluated (loading -> loaded only)', () => {
    const view = (loading: boolean) => (
      <GlassProvider frameSampling={false}>
        <GlassPanel loading={loading} data-testid="p">
          <span>value</span>
        </GlassPanel>
      </GlassProvider>
    );
    const { rerender } = render(view(true));
    const body = () => screen.getByTestId('p').querySelector('.gp-body')!;
    expect(body().hasAttribute('data-reveal')).toBe(false);
    rerender(view(false));
    expect(body().textContent).toBe('value');
    expect(body().hasAttribute('data-reveal')).toBe(true);
    expect(rule('.gp-body[data-reveal]')).toBe(
      'animation: gp-fade var(--motion-value) var(--motion-ease) both;',
    );
    expect(rule('.gp-aurora i, .gp-body[data-reveal]', '(prefers-reduced-motion: reduce)')).toBe(
      'animation: none;',
    );
  });

  it('Skeleton sizes follow the type tokens', () => {
    const { container } = render(<Skeleton size="hero" width="50%" />);
    expect(container.innerHTML).toBe(
      '<span class="gp-skel" data-size="hero" aria-hidden="true" style="width: 50%;"></span>',
    );
    expect(rule('.gp-skel[data-size="hero"]')).toBe('font-size: var(--type-hero-size);');
  });
});

describe('UI-02 G12 accessibility (axe-core)', () => {
  it('the Cockpit composite has no serious or critical violations', async () => {
    renderComposite({ overlays: true });
    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});

describe('UI-02 tokens only', () => {
  it('glass CSS has no hex colours and no px values outside token-derived ones', () => {
    expect(glassCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const px = [...glassCss.replace(/url\("[^"]*"\)/g, '').matchAll(/\d*\.?\d+px/g)].map(
      (m) => m[0],
    );
    // only the token breakpoints (media queries cannot read custom properties) and the
    // glass.border / glass.highlight widths from tokens.json
    expect(new Set(px)).toEqual(new Set(['1px', '1180px', '760px']));
  });
});
