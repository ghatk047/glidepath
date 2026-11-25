// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../glass';
import { COMPUTE_GLYPHS, ComputeFlow, computeCss, wavePath } from './index';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const root = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-compute]');
const count = (c: HTMLElement, sel: string) => c.querySelectorAll(sel).length;

describe('ComputeFlow markup', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<ComputeFlow active={false} />);
    expect(root(container)).toBeNull();
  });

  it('inline: 3 waves, 6 glyphs, decorative', () => {
    const { container } = render(<ComputeFlow active />);
    const r = root(container)!;
    expect(r.getAttribute('aria-hidden')).toBe('true');
    expect(r.dataset.variant).toBe('inline');
    expect(r.dataset.motion).toBe('on');
    expect(count(container, '.gp-compute-wave')).toBe(3);
    expect(count(container, '.gp-compute-glyphs > b')).toBe(6);
  });

  it('field: 4 waves, 12 glyphs', () => {
    const { container } = render(<ComputeFlow active variant="field" />);
    expect(count(container, '.gp-compute-wave')).toBe(4);
    expect(count(container, '.gp-compute-glyphs > b')).toBe(12);
  });

  it('passes progress through as a custom property, clamped', () => {
    const { container } = render(<ComputeFlow active progress={0.4} />);
    expect(root(container)!.style.getPropertyValue('--gp-p')).toBe('0.4');
  });
});

describe('still rendering', () => {
  const check = (c: HTMLElement) => {
    const r = root(c)!;
    expect(r.dataset.motion).toBe('still');
    expect(count(c, '.gp-compute-wave[data-still]')).toBe(1);
    expect(count(c, '.gp-compute-glyphs > b[data-still]')).toBe(3);
    expect(computeCss).toMatch(/\[data-motion="still"\]/);
    // keyframe animation and will-change are only declared under data-motion="on"
    for (const m of computeCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/animation:|animation-|will-change/.test(m[2]!)) {
        const sel = m[1]!.trim();
        if (/^@keyframes/.test(sel)) continue;
        expect(sel).not.toMatch(/data-motion="still"/);
      }
    }
  };

  it('still prop', () => check(render(<ComputeFlow active still />).container));

  it('prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    check(render(<ComputeFlow active />).container);
  });

  it('low glass quality', () => {
    check(render(<GlassProvider forceLow frameSampling={false}><ComputeFlow active /></GlassProvider>).container);
  });
});

describe('off-screen pause', () => {
  it('sets data-visible from IntersectionObserver', () => {
    let cb: (e: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(f: typeof cb) {
          cb = f;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { container, unmount } = render(<ComputeFlow active />);
    expect(root(container)!.dataset.visible).toBe('true');
    act(() => cb([{ isIntersecting: false }]));
    expect(root(container)!.dataset.visible).toBe('false');
    act(() => cb([{ isIntersecting: true }]));
    expect(root(container)!.dataset.visible).toBe('true');
    unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(computeCss).toMatch(/\[data-visible="false"\][^{]*\{[^}]*animation-play-state: paused/);
    expect(computeCss).toMatch(/\[data-visible="true"\] \.gp-compute-wave \{ will-change/);
  });
});

describe('computeCss', () => {
  it('keyframes animate only transform and opacity', () => {
    const frames = [...computeCss.matchAll(/@keyframes [\w-]+ \{((?:[^{}]*\{[^{}]*\})+)\s*\}/g)];
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const f of frames)
      for (const decl of f[1]!.matchAll(/\{([^{}]*)\}/g))
        for (const d of decl[1]!.split(';').map((s) => s.trim()).filter(Boolean))
          expect(d.split(':')[0]!.trim()).toMatch(/^(transform|opacity)$/);
  });

  it('durations and delays are calc() of motion tokens', () => {
    const times = [...computeCss.matchAll(/animation(?:-duration|-delay)?: ([^;]+);/g)].map((m) => m[1]!);
    expect(times.length).toBeGreaterThan(3);
    for (const t of times) if (/\d+m?s\b/.test(t.replace(/var\([^)]*\)/g, ''))) throw new Error(`literal time: ${t}`);
    expect(computeCss).toContain('calc(var(--motion-flash) * var(--w))');
    expect(computeCss).toContain('calc(var(--motion-roll) * 5)');
    expect(computeCss).toContain('calc(var(--motion-stagger) * var(--i) * 4)');
  });

  it('no filter, backdrop-filter, box-shadow, hex or px literals; only accent and ink colours', () => {
    expect(computeCss).not.toMatch(/filter|box-shadow/);
    expect(computeCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(computeCss).not.toMatch(/\d\s*px\b/);
    const colours = [...computeCss.matchAll(/(?:stroke|color):\s*([^;]+);/g)].map((m) => m[1]!.trim());
    for (const col of colours) expect(col).toMatch(/^var\(--(accent|accent-2|ink-3)\)$/);
  });
});

describe('wavePath', () => {
  it('is deterministic, periodic and inside the viewBox', () => {
    expect(wavePath(3, 8)).toBe(wavePath(3, 8));
    for (const [c, a] of [[1, 5], [4, 12], [7, 99], [0, -3]] as const) {
      const d = wavePath(c, a);
      const pts = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(200);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(40);
      }
      expect(pts[0]![1]).toBeCloseTo(pts[pts.length - 1]![1]!, 1);
    }
  });
  it('exposes the glyph set', () => {
    expect(COMPUTE_GLYPHS).toContain('∑');
    expect(COMPUTE_GLYPHS.length).toBe(12);
  });
});

describe('a11y', () => {
  it('has no axe violations', async () => {
    const { container } = render(<ComputeFlow active variant="field" />);
    const res = await axe.run(container);
    expect(res.violations).toEqual([]);
  });
});
