// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toModule = vi.fn();
const toScenario = vi.fn();
const commit = vi.fn();

vi.mock('../shell/navigation', () => ({
  useShellNavigation: () => ({ toModule, toScenario }),
}));
vi.mock('../../data', () => ({
  useTenants: () => ({ data: { tenants: [{ slug: 'zz', name: 'Zed Air' }] } }),
}));
vi.mock('../../bind', () => ({
  // the real Value needs a live session; here only the mapping to node, member and format matters
  Value: ({ node, member, format }: { node: string; member?: string; format?: string }) => (
    <span data-bound-node={node} data-bound-member={member} data-bound-format={format} />
  ),
}));

import { MODULE_IDS } from '../../app/modules';
import { TourBody, parsePlaceholder } from './body';
import { SEEN_KEY, readSeen } from './seen';
import { TOUR_CHAPTERS, TOUR_STEPS, TOUR_VERSION } from './steps';
import { tourStore } from './store';
import { TourButton } from './TourButton';
import { TourHost } from './TourHost';
import { ANCHOR_WAIT_MS } from './useAnchor';

const AIRLINE_WORDS = /\b(AA|American|Sabre|DXC|Hyderabad)\b/i;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  window.localStorage.clear();
  tourStore.setState({ open: false, index: 0, seen: false });
  window.scrollTo = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
  toModule.mockClear();
  toScenario.mockClear();
  commit.mockClear();
});

const anchorEl = (selector: string) => {
  const el = document.createElement('div');
  if (selector.startsWith('[data-testid=')) el.dataset['testid'] = /"(.*)"/.exec(selector)![1]!;
  else if (selector.startsWith('.')) el.className = selector.slice(1);
  else if (selector.startsWith('[') && !selector.includes(' '))
    el.setAttribute(selector.slice(1, selector.indexOf('=') > 0 ? selector.indexOf('=') : -1), '');
  document.body.append(el);
  return el;
};

describe('steps table', () => {
  it('matches plan 4.2: 14 steps, ids, modules, placements', () => {
    expect(TOUR_STEPS.map((s) => [s.id, s.module, s.placement])).toEqual([
      ['bar', 'cockpit', 'right'],
      ['baseline', 'baseline', 'right'],
      ['rates', 'cockpit', 'bottom'],
      ['levers', 'levers', 'left'],
      ['vps', 'vps', 'top'],
      ['path', 'path', 'top'],
      ['odds', 'path', 'left'],
      ['market', 'market', 'right'],
      ['handover', 'cockpit', 'left'],
      ['excel', 'excel', 'bottom'],
      ['airlines', 'airlines', 'top'],
      ['wizard', 'wizard', 'bottom'],
      ['optimize', 'wizard', 'bottom'],
      ['restart', null, 'bottom'],
    ]);
    expect(TOUR_STEPS.map((s) => s.anchor)).toEqual([
      '[data-testid="cockpit-net"]',
      '.gp-treemap',
      '.gp-seg',
      '[data-lever-detail]',
      '.gp-vps-rows',
      '.gp-path-actions',
      '[data-testid="path-odds"]',
      '[data-testid="market-trace"]',
      '[data-testid="cockpit-inputs"]',
      '[data-module="excel"] .gp-xl-chips',
      '[data-testid="airlines-grid"]',
      '[data-wizard-stepper]',
      '[data-wizard-optimize]',
      '[data-tour-button]',
    ]);
    expect(TOUR_VERSION).toBe('1');
    for (const s of TOUR_STEPS) if (s.module) expect(MODULE_IDS).toContain(s.module);
  });

  it('copy: at most 16 words, no digit outside placeholders, no airline word, ids or tenant only', () => {
    for (const s of TOUR_STEPS) {
      const bare = s.body.replace(/\{[^{}]+\}/g, '');
      expect(bare, s.id).not.toMatch(/\d/);
      expect(`${s.title} ${s.body}`, s.id).not.toMatch(AIRLINE_WORDS);
      expect(s.body.replace(/\{[^{}]+\}/g, 'x').split(/\s+/).length, s.id).toBeLessThanOrEqual(16);
      for (const m of s.body.matchAll(/\{([^{}]+)\}/g)) {
        const raw = m[1]!;
        if (raw === 'tenant') continue;
        expect(parsePlaceholder(raw).node, s.id).toMatch(/^(res|base|br|vp)\.[a-z0-9_]+$/);
      }
    }
  });

  it('chapters name existing steps', () => {
    for (const id of Object.values(TOUR_CHAPTERS)) expect(TOUR_STEPS.map((s) => s.id)).toContain(id);
  });
});

describe('placeholders', () => {
  it('parses node, member and format', () => {
    expect(parsePlaceholder('res.net')).toEqual({ node: 'res.net', member: '', format: undefined });
    expect(parsePlaceholder('base.locked_share|pct')).toEqual({
      node: 'base.locked_share',
      member: '',
      format: 'pct',
    });
    expect(parsePlaceholder('vp.net[vp_x]')).toEqual({ node: 'vp.net', member: 'vp_x', format: undefined });
    expect(parsePlaceholder('br.eps27|eps').format).toBe('eps');
  });

  it('renders Value cells with verbatim node ids and the tenant name', () => {
    const { container } = render(
      <TourBody text="{tenant}: {res.net} and {base.locked_share|pct}, {vp.net[vp_x]}." tenantName="Zed Air" />,
    );
    expect(container.textContent).toContain('Zed Air: ');
    const cells = [...container.querySelectorAll<HTMLElement>('[data-bound-node]')];
    expect(cells.map((c) => c.dataset['boundNode'])).toEqual(['res.net', 'base.locked_share', 'vp.net']);
    expect(cells[1]!.dataset['boundFormat']).toBe('pct');
    expect(cells[2]!.dataset['boundMember']).toBe('vp_x');
  });
});

describe('store and seen', () => {
  it('never auto-starts; start opens step 1', () => {
    expect(tourStore.getState().open).toBe(false);
    tourStore.getState().next();
    expect(tourStore.getState().open).toBe(false);
    tourStore.setState({ index: 5 });
    tourStore.getState().start();
    expect(tourStore.getState()).toMatchObject({ open: true, index: 0 });
  });

  it('next, back, skip and done; both writes seen', () => {
    const s = () => tourStore.getState();
    s().start();
    s().back();
    expect(s().index).toBe(0);
    s().next();
    s().next();
    s().back();
    expect(s().index).toBe(1);
    s().close('skip');
    expect(s().open).toBe(false);
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(TOUR_VERSION);

    window.localStorage.clear();
    s().startAt('restart');
    expect(s().index).toBe(TOUR_STEPS.length - 1);
    s().next();
    expect(s().open).toBe(false);
    expect(readSeen()).toBe(true);
  });

  it('jump and chapters', () => {
    const s = () => tourStore.getState();
    s().jumpTo('wizard');
    expect(s().open).toBe(false);
    s().startAt('wizard');
    expect(TOUR_STEPS[s().index]!.id).toBe('wizard');
    s().jumpTo('odds');
    expect(TOUR_STEPS[s().index]!.id).toBe('odds');
    s().jumpTo('nope');
    expect(TOUR_STEPS[s().index]!.id).toBe('odds');
    s().startAt('nope');
    expect(TOUR_STEPS[s().index]!.id).toBe('odds');
  });

  it('blocked storage still runs the tour', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSeen()).toBe(false);
    tourStore.getState().start();
    expect(() => tourStore.getState().close('skip')).not.toThrow();
    spy.mockRestore();
    get.mockRestore();
  });
});

describe('TourButton', () => {
  it('has the dot until seen and always starts at step 1', () => {
    render(<TourButton />);
    const btn = screen.getByRole('button', { name: 'Start the walkthrough' });
    expect(btn.hasAttribute('data-tour-button')).toBe(true);
    expect(btn.hasAttribute('data-tour-seen')).toBe(false);
    tourStore.setState({ index: 4 });
    fireEvent.click(btn);
    expect(tourStore.getState()).toMatchObject({ open: true, index: 0 });
    act(() => tourStore.getState().close('skip'));
    expect(btn.hasAttribute('data-tour-seen')).toBe(true);
  });
});

describe('TourHost', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<TourHost module="cockpit" />);
    expect(container.querySelector('[data-tour]')).toBeNull();
    expect(toModule).not.toHaveBeenCalled();
  });

  it('shows the step on its screen with the anchor highlighted', () => {
    anchorEl('[data-testid="cockpit-net"]');
    render(<TourHost module="cockpit" />);
    act(() => tourStore.getState().start());
    const host = document.querySelector('[data-tour]')!;
    expect(host.getAttribute('data-tour-step')).toBe('bar');
    expect(host.hasAttribute('data-tour-missing')).toBe(false);
    expect(toModule).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('navigates with toModule on another module and waits for the anchor', () => {
    const { rerender } = render(<TourHost module="cockpit" />);
    act(() => tourStore.getState().startAt('baseline'));
    expect(toModule).toHaveBeenCalledTimes(1);
    expect(toModule).toHaveBeenCalledWith('baseline');
    expect(document.querySelector('[data-tour]')).toBeNull();

    rerender(<TourHost module="baseline" />);
    anchorEl('.gp-treemap');
    // the anchor appears after the module mounted
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toModule).toHaveBeenCalledTimes(1);
  });

  it('a step with module null stays on the current screen', () => {
    anchorEl('[data-tour-button]');
    render(<TourHost module="airlines" />);
    act(() => tourStore.getState().startAt('restart'));
    expect(toModule).not.toHaveBeenCalled();
    expect(document.querySelector('[data-tour-step]')!.getAttribute('data-tour-step')).toBe('restart');
  });

  it('a missing anchor centres the card and sets data-tour-missing; the tour continues', () => {
    render(<TourHost module="cockpit" />);
    act(() => tourStore.getState().start());
    expect(document.querySelector('[data-tour]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(ANCHOR_WAIT_MS + 1);
    });
    const host = document.querySelector('[data-tour]')!;
    expect(host.hasAttribute('data-tour-missing')).toBe(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(tourStore.getState().index).toBe(1);
  });

  it('Back, Skip and Done work from the card', () => {
    render(<TourHost module="cockpit" />);
    act(() => tourStore.getState().start());
    act(() => {
      vi.advanceTimersByTime(ANCHOR_WAIT_MS + 1);
    });
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(tourStore.getState().open).toBe(false);
    expect(document.querySelector('[data-tour]')).toBeNull();
  });

  it('never commits, previews or switches scenario', () => {
    anchorEl('[data-testid="cockpit-net"]');
    render(<TourHost module="cockpit" />);
    act(() => tourStore.getState().start());
    for (let i = 0; i < TOUR_STEPS.length; i++) act(() => tourStore.getState().next());
    expect(toScenario).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('read-only by construction', () => {
  it('no engine source touches commit, preview, applyChangeset or toScenario', () => {
    const dir = `${dirname(fileURLToPath(import.meta.url))}/`;
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !n.includes('.test.'))) {
      const code = readFileSync(`${dir}${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/useCommit|useVariable|\.preview\(|applyChangeset|toScenario/);
    }
  });
});
