// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../glass';
import { Rail, ScenarioBar, TenantButton, shellCss, type RailItem } from './index';

afterEach(cleanup);

/** CSS rules of shellCss as [selector, body], with the media query they sit in. */
function rules(css = shellCss): { media: string | null; selector: string; body: string }[] {
  const out: { media: string | null; selector: string; body: string }[] = [];
  const re = /@media ([^{]+)\{([\s\S]*?)\n\}|([^{}@]+)\{([^{}]*)\}/g;
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(re)) {
    if (m[1]) {
      for (const r of m[2]!.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        out.push({ media: m[1].trim(), selector: r[1]!.trim(), body: r[2]!.trim() });
    } else out.push({ media: null, selector: m[3]!.trim(), body: m[4]!.trim() });
  }
  return out;
}
const rule = (selector: string, media: string | null = null) =>
  rules().find((r) => r.selector === selector && r.media === media)?.body ?? '';
const PHONE = '(max-width: 760px)';

const icon = (id: string) => (
  <svg data-icon={id} viewBox="0 0 24 24">
    <path d="M3 12h18" />
  </svg>
);
const items: RailItem[] = [
  { id: 'cockpit', label: 'Cockpit', icon: icon('cockpit') },
  { id: 'baseline', label: 'Baseline', icon: icon('baseline') },
  { id: 'levers', label: 'Levers', icon: icon('levers') },
  { id: 'mood', label: 'Mood', icon: icon('mood'), group: 'docs' },
];
const scenarios = [
  { id: 'rates', letter: 'R', name: 'Rates only' },
  { id: 'A', letter: 'A', name: 'Commercial' },
  { id: 'B', letter: 'B', name: 'Op-model reset' },
  { id: 'C', letter: 'C', name: 'Balanced' },
  { id: 'D', letter: 'D', name: 'Full stretch' },
];
const customs = [{ id: 'custom-1', name: 'Custom (from C)' }];
const paths = [
  { id: 'path-1', name: 'Min-risk mix' },
  { id: 'path-2', name: 'Fastest path' },
];

const renderRail = (current = 'baseline', extra: Partial<Parameters<typeof Rail>[0]> = {}) =>
  render(<Rail items={items} current={current} tenantCode="UA" {...extra} />);

describe('UI-05 Rail (#1)', () => {
  it('rail: renders every item with its label and icon, the tenant monogram on top', () => {
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Modules' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Cockpit', 'Baseline', 'Levers', 'Mood']);
    expect(links[0]!.querySelector('svg[data-icon="cockpit"]')).not.toBeNull();
    expect(nav.firstElementChild!.textContent).toBe('UA');
  });

  it('rail: aria-current marks only the current item', () => {
    renderRail('levers');
    const current = screen.getAllByRole('link').filter((a) => a.hasAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toBe('Levers');
    expect(current[0]!.getAttribute('aria-current')).toBe('page');
    cleanup();
    renderRail('nothing');
    expect(document.querySelector('[aria-current]')).toBeNull();
  });

  it('rail: current = glass-2 tint + accent icon', () => {
    expect(rule('.gp-rail-item[aria-current="page"]')).toContain('background: var(--glass-2)');
    expect(rule('.gp-rail-item[aria-current="page"] .gp-rail-icon')).toBe('color: var(--accent);');
  });

  it('rail: 84 px column on desktop (the rail-width token)', () => {
    expect(rule('.gp-rail')).toContain('width: var(--space-rail-width)');
  });

  it('rail: bottom bar under 760 px, scrolling inside itself', () => {
    const bar = rule('.gp-rail', PHONE);
    expect(bar).toMatch(/position: fixed/);
    expect(bar).toMatch(/bottom: 0/);
    expect(bar).toMatch(/flex-direction: row/);
    expect(bar).toMatch(/overflow-x: auto/);
    expect(bar).toMatch(/overscroll-behavior-x: contain/);
  });

  it('rail: a divider only where the group changes', () => {
    const { container } = renderRail();
    expect(container.querySelectorAll('.gp-rail-sep')).toHaveLength(1);
  });

  it('rail: keyboard operable: items are links, in order, and report activation', () => {
    const onSelect = vi.fn((_id: string, e: { preventDefault(): void }) => e.preventDefault());
    const onTenant = vi.fn();
    renderRail('cockpit', { onSelect, onTenant });
    const tenant = screen.getByRole('button', { name: /switch airline/ });
    tenant.focus();
    expect(document.activeElement).toBe(tenant);
    fireEvent.click(tenant);
    expect(onTenant).toHaveBeenCalledOnce();
    const link = screen.getByRole('link', { name: 'Levers' });
    expect(link.getAttribute('href')).toBe('#levers');
    link.focus();
    expect(document.activeElement).toBe(link);
    fireEvent.click(link);
    expect(onSelect).toHaveBeenCalledWith('levers', expect.anything());
  });
});

describe('UI-05 Scenario bar (#2)', () => {
  const bar = (current = 'C', onSelect = vi.fn()) =>
    render(
      <GlassProvider frameSampling={false}>
        <ScenarioBar
          scenarios={scenarios}
          current={current}
          customs={customs}
          paths={paths}
          onSelect={onSelect}
        />
      </GlassProvider>,
    );

  it('scenario bar: segmented letters + names', () => {
    bar();
    const group = screen.getByRole('group', { name: 'Scenario' });
    for (const s of scenarios) {
      const b = within(group).getByRole('button', { name: `${s.letter} ${s.name}` });
      expect(b.querySelector('.gp-seg-k')!.textContent).toBe(s.letter);
      expect(b.querySelector('.gp-seg-t')!.textContent).toBe(s.name);
    }
  });

  it('scenario bar: letters only on phone (names stay in the accessible name)', () => {
    const phone = rule('.gp-seg-t, .gp-seg-more-name', PHONE);
    expect(phone).toMatch(/clip-path: inset\(50%\)/);
    expect(phone).not.toMatch(/display: none/);
    bar();
    expect(screen.getByRole('button', { name: 'D Full stretch' })).toBeTruthy();
  });

  it('scenario bar: pressed = glass-3, one preset pressed', () => {
    bar('B');
    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.textContent).toBe('BOp-model reset');
    expect(
      rule('.gp-seg button[aria-pressed="true"], .gp-seg button[data-active="true"]'),
    ).toContain('background: var(--glass-3)');
  });

  it('scenario bar: selecting a preset reports its id', () => {
    const onSelect = vi.fn();
    bar('C', onSelect);
    fireEvent.click(screen.getByRole('button', { name: 'A Commercial' }));
    expect(onSelect).toHaveBeenCalledWith('A');
  });

  it('scenario bar: custom and path scenarios sit in an overflow menu', () => {
    const onSelect = vi.fn();
    bar('C', onSelect);
    expect(screen.queryByRole('menu')).toBeNull();
    const more = screen.getByRole('button', { name: 'More scenarios' });
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More scenarios' });
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const custom = within(screen.getByRole('group', { name: 'Custom' }));
    expect(custom.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([
      'Custom (from C)',
    ]);
    const pathGroup = within(screen.getByRole('group', { name: 'Paths' }));
    expect(pathGroup.getAllByRole('menuitemradio').map((b) => b.textContent)).toEqual([
      'Min-risk mix',
      'Fastest path',
    ]);
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Fastest path' }));
    expect(onSelect).toHaveBeenCalledWith('path-2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('scenario bar: no overflow button without customs or paths', () => {
    render(<ScenarioBar scenarios={scenarios} current="C" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: /More scenarios/ })).toBeNull();
  });

  it('scenario bar: a custom or path scenario as current shows on the overflow button, no preset pressed', () => {
    bar('custom-1');
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
    const more = screen.getByRole('button', { name: 'More scenarios, Custom (from C) selected' });
    expect(more.getAttribute('data-active')).toBe('true');
    fireEvent.click(more);
    expect(
      screen.getByRole('menuitemradio', { name: 'Custom (from C)' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('scenario bar: keyboard operable (arrows, Home/End, Escape returns focus)', () => {
    bar('path-1');
    const more = screen.getByRole('button', { name: /More scenarios/ });
    more.focus();
    fireEvent.keyDown(more, { key: 'ArrowDown' });
    const radios = screen.getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(radios[1]); // the checked item
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[0]); // wraps
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('scenario bar: an outside press closes the menu', () => {
    bar();
    fireEvent.click(screen.getByRole('button', { name: 'More scenarios' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('UI-05 Tenant button (#6)', () => {
  it('tenant button: IATA code in a neutral monogram, never a logo', () => {
    const { container } = render(<TenantButton code="ua" />);
    const btn = screen.getByRole('button');
    expect(btn.querySelector('[data-monogram]')!.textContent).toBe('UA');
    expect(container.querySelector('img, svg, picture, canvas, [style*="url("]')).toBeNull();
    expect(rule('.gp-tenant-btn')).toContain('background: var(--glass-2)');
    expect(rule('.gp-tenant-btn')).toContain('var(--font-mono)');
  });

  it('tenant button: status is in the accessible name and data-status', () => {
    render(<TenantButton code="UA" name="United" status="switching" />);
    const btn = screen.getByRole('button', { name: 'United, switching, switch airline' });
    expect(btn.getAttribute('data-status')).toBe('switching');
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('tenant button: a code is clamped to three characters', () => {
    render(<TenantButton code="abcdef" />);
    expect(document.querySelector('[data-monogram]')!.textContent).toBe('ABC');
  });
});

describe('UI-05 G12: touch targets and axe', () => {
  it('44 px touch targets on phone: rail items, tenant button, segments, menu rows', () => {
    const min = '2.75rem';
    expect(rule('.gp-rail-item', PHONE)).toContain(`min-height: ${min}`);
    expect(rule('.gp-tenant-btn', PHONE)).toContain(`width: ${min}`);
    expect(rule('.gp-tenant-btn', PHONE)).toContain(`height: ${min}`);
    expect(rule('.gp-seg button', PHONE)).toContain(`min-height: ${min}`);
    expect(rule('.gp-seg button', PHONE)).toContain(`min-width: ${min}`);
    expect(rule('.gp-menu button', PHONE)).toContain(`min-height: ${min}`);
  });

  it('shell components have no serious or critical axe violations (menu open too)', async () => {
    render(
      <GlassProvider frameSampling={false}>
        <Rail items={items} current="cockpit" tenantCode="UA" tenantName="United" />
        <main>
          <ScenarioBar
            scenarios={scenarios}
            current="C"
            customs={customs}
            paths={paths}
            onSelect={() => {}}
          />
        </main>
      </GlassProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More scenarios' }));
    const result = await axe.run(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  it('focus is visible on every control', () => {
    expect(shellCss).toMatch(/\.gp-rail-item:focus-visible[^{]*\{ outline:/);
  });
});

describe('UI-05 tokens only, no business logic', () => {
  it('shell CSS has no hex colours and no px beyond token widths and the phone breakpoint', () => {
    expect(shellCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const px = [...shellCss.matchAll(/\d*\.?\d+px/g)].map((m) => m[0]);
    expect(new Set(px)).toEqual(new Set(['1px', '760px']));
  });
});
