// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../../glass';
import {
  Coachmark,
  Spotlight,
  TourOverlay,
  placeCard,
  tourCss,
  type TourPlacement,
  type TourRect,
} from './index';

let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduced && q.includes('prefers-reduced-motion'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const wrap = (ui: React.ReactNode) => <GlassProvider frameSampling={false}>{ui}</GlassProvider>;

describe('placeCard', () => {
  const vp = { width: 1000, height: 800 };
  const card = { width: 300, height: 200 };
  const gap = 16;
  const mid: TourRect = { top: 300, left: 400, width: 200, height: 100 };
  const inside = (r: { top: number; left: number }) =>
    r.top >= 0 && r.left >= 0 && r.left + card.width <= vp.width && r.top + card.height <= vp.height;

  it.each<[TourPlacement]>([['top'], ['bottom'], ['left'], ['right']])(
    'uses the preferred side %s when it fits and stays inside the viewport',
    (side) => {
      const r = placeCard(mid, card, vp, side, gap);
      expect(r.placement).toBe(side);
      expect(inside(r)).toBe(true);
      if (side === 'top') expect(r.top).toBe(mid.top - gap - card.height);
      if (side === 'bottom') expect(r.top).toBe(mid.top + mid.height + gap);
      if (side === 'left') expect(r.left).toBe(mid.left - gap - card.width);
      if (side === 'right') expect(r.left).toBe(mid.left + mid.width + gap);
    },
  );

  const flips: [string, TourRect, TourPlacement, string][] = [
    ['top to bottom', { top: 50, left: 400, width: 200, height: 50 }, 'top', 'bottom'],
    ['bottom to top', { top: 700, left: 400, width: 200, height: 50 }, 'bottom', 'top'],
    ['left to right', { top: 300, left: 20, width: 100, height: 100 }, 'left', 'right'],
    ['right to left', { top: 300, left: 880, width: 100, height: 100 }, 'right', 'left'],
  ];
  it.each(flips)('flips %s', (_n, rect, pref, expected) => {
    const r = placeCard(rect, card, vp, pref, gap);
    expect(r.placement).toBe(expected);
    expect(inside(r)).toBe(true);
  });

  it('tries the other axis when both sides of an axis fail', () => {
    // a wide, tall target leaves no room above, below
    const rect: TourRect = { top: 10, left: 400, width: 200, height: 780 };
    const r = placeCard(rect, card, vp, 'top', gap);
    expect(['left', 'right']).toContain(r.placement);
    expect(inside(r)).toBe(true);
  });

  it('clamps the cross axis into the viewport', () => {
    const rect: TourRect = { top: 300, left: 0, width: 40, height: 40 };
    const r = placeCard(rect, card, vp, 'bottom', gap);
    expect(r.placement).toBe('bottom');
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(inside(r)).toBe(true);
  });

  it('centres with a null target', () => {
    expect(placeCard(null, card, vp, 'top', gap)).toEqual({ top: 300, left: 350, placement: 'center' });
  });

  it('centres when nothing fits', () => {
    const rect: TourRect = { top: 0, left: 0, width: 1000, height: 800 };
    expect(placeCard(rect, card, vp, 'right', gap).placement).toBe('center');
  });
});

describe('Spotlight', () => {
  it('draws one fixed hole around the rect, pointer-events none, scrim from tokens', () => {
    const { container } = render(<Spotlight rect={{ top: 100, left: 50, width: 200, height: 40 }} pad={8} />);
    const spots = container.querySelectorAll('.gp-tour-spot');
    expect(spots).toHaveLength(1);
    const el = spots[0] as HTMLElement;
    expect(el.style.width).toBe('216px');
    expect(el.style.height).toBe('56px');
    expect(el.style.transform).toBe('translate(42px, 92px)');
    const rule = tourCss.split('\n').find((l) => l.startsWith('.gp-tour-spot'))!;
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('pointer-events: none');
    expect(rule).toMatch(/color-mix\(in srgb, var\(--ground\) 55%, transparent\)/);
    expect(rule).toContain('var(--accent-glow)');
    expect(rule).toContain('var(--radius-card)');
    expect(tourCss).not.toMatch(/backdrop-filter/);
    expect(tourCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('draws nothing without a rect', () => {
    const { container } = render(<Spotlight rect={null} />);
    expect(container.querySelector('.gp-tour-spot')).toBeNull();
  });

  it('has no transition under reduced motion', () => {
    reduced = true;
    const { container } = render(<Spotlight rect={{ top: 0, left: 0, width: 10, height: 10 }} />);
    expect((container.querySelector('.gp-tour-spot') as HTMLElement).style.transition).toContain('none');
    expect(tourCss).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none/);
  });
});

function Harness({ count = 3, onSkip = () => {} }: { count?: number; onSkip?: () => void }) {
  const [i, setI] = useState(0);
  return wrap(
    <>
      <button type="button" id="opener">
        opener
      </button>
      <TourOverlay
        rect={{ top: 100, left: 100, width: 200, height: 60 }}
        index={i}
        count={count}
        title={`Title ${i + 1}`}
        body={<span>Body {i + 1}</span>}
        preferred="bottom"
        onNext={() => setI((n) => Math.min(count - 1, n + 1))}
        onBack={() => setI((n) => Math.max(0, n - 1))}
        onClose={onSkip}
      />
    </>,
  );
}

describe('Coachmark', () => {
  it('is a non-modal labelled dialog with counter, title, body and buttons', () => {
    render(<Harness />);
    const d = screen.getByRole('dialog');
    expect(d.getAttribute('aria-modal')).toBe('false');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Title 1');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe('Body 1');
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
    expect(d.querySelector('.gp-tour-dots')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows Done on the last step and enables Back after the first', () => {
    render(<Harness count={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('2 / 2')).toBeTruthy();
  });

  it('focuses Next on every step', () => {
    render(<Harness />);
    const next = () => screen.getByRole('button', { name: /^(Next|Done)$/ });
    expect(document.activeElement).toBe(next());
    fireEvent.click(next());
    expect(document.activeElement).toBe(next());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(document.activeElement).toBe(next());
  });

  it('keys: ArrowRight and Enter next, ArrowLeft back, Escape skip', () => {
    const onSkip = vi.fn();
    render(<Harness onSkip={onSkip} />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByText('3 / 3')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByText('2 / 3')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('Enter on a focused button does not also advance', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'Enter' });
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('Tab cycles inside the card', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // Back is now enabled
    const dialog = screen.getByRole('dialog');
    const buttons = [...dialog.querySelectorAll('button')];
    const head = buttons[0]!;
    const tail = buttons[buttons.length - 1]!;
    tail.focus();
    fireEvent.keyDown(tail, { key: 'Tab' });
    expect(document.activeElement).toBe(head);
    fireEvent.keyDown(head, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(tail);
  });

  it('announces Step n of N once per step in a polite live region', () => {
    render(<Harness />);
    const live = screen.getByRole('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Step 1 of 3: Title 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Step 2 of 3: Title 2');
  });

  it('has no transition on the card under reduced motion', () => {
    reduced = true;
    render(
      wrap(
        <Coachmark index={0} count={1} title="t" body="b" onNext={() => {}} onBack={() => {}} onClose={() => {}} />,
      ),
    );
    expect(screen.getByRole('dialog').style.transition).toContain('none');
  });
});

describe('TourOverlay', () => {
  it('positions the card beside the target and centres without one', () => {
    const { rerender } = render(
      wrap(
        <TourOverlay
          rect={{ top: 100, left: 100, width: 200, height: 60 }}
          index={0}
          count={1}
          title="t"
          body="b"
          preferred="bottom"
          onNext={() => {}}
          onBack={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    const d = screen.getByRole('dialog');
    expect(d.getAttribute('data-placement')).toBe('bottom');
    expect(d.style.top).toBe('176px');
    rerender(
      wrap(
        <TourOverlay
          rect={null}
          index={0}
          count={1}
          title="t"
          body="b"
          preferred="bottom"
          onNext={() => {}}
          onBack={() => {}}
          onClose={() => {}}
        />,
      ),
    );
    expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe('center');
    expect(document.querySelector('.gp-tour-spot')).toBeNull();
  });

  it('docks as a bottom sheet at phone width', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width: 760px'),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    render(<Harness />);
    const d = screen.getByRole('dialog');
    expect(d.getAttribute('data-sheet')).toBe('true');
    expect(d.style.top).toBe('');
  });

  it('passes axe', async () => {
    const { container } = render(<Harness />);
    await act(async () => {});
    const r = await axe.run(container.ownerDocument.body, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(r.violations.map((x) => `${x.id}: ${x.nodes[0]?.html}`)).toEqual([]);
  });
});
