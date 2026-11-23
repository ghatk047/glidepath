// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlassProvider } from '../../glass';
import { fmt } from '../../format';
import {
  EditPopover,
  EditableNumber,
  editableCss,
  parseNumber,
  type EditableNumberPopover,
} from './index';

beforeEach(() => {
  // reduced motion: the number roll jumps, so assertions need no timers
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** CSS rules of editableCss as [selector, body]. */
const rules = () =>
  [...editableCss.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!.trim(),
  }));
const rule = (selector: string) => rules().find((r) => r.selector === selector)?.body ?? '';

const target = (over: Partial<EditableNumberPopover> = {}): EditableNumberPopover => ({
  label: 'Net target · CY27',
  unit: '$M',
  min: 50,
  max: 150,
  step: 1,
  source: 'User',
  confidence: 'High',
  defaultValue: 100,
  ...over,
});

const wrap = (ui: React.ReactNode) => <GlassProvider frameSampling={false}>{ui}</GlassProvider>;

describe('UI-09 EditableNumber: underline states and mode routing', () => {
  it('dotted underline on hover, solid once changed (css + data-changed)', () => {
    const ed = rule('.gp-ed');
    expect(ed).toContain('text-decoration: underline dotted transparent');
    expect(rule('.gp-ed:hover')).toContain('text-decoration-color: var(--accent)');
    expect(rule('.gp-ed[data-changed]')).toContain('text-decoration-style: solid');
    expect(rule('.gp-ed[data-changed]')).toContain('text-decoration-color: var(--accent)');

    const onChange = vi.fn();
    render(
      wrap(
        <EditableNumber
          variableId="g.target_net"
          value={100}
          format={(v) => fmt.money(v, { digits: 0 })}
          popover={target({ onChange })}
        />,
      ),
    );
    const btn = screen.getByRole('button', { name: /Net target/ });
    expect(btn.hasAttribute('data-changed')).toBe(false);
    fireEvent.click(btn);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '120' } });
    expect(onChange).toHaveBeenCalledWith(120);
    expect(btn.hasAttribute('data-changed')).toBe(true);
  });

  it('changed prop wins over the local edit state', () => {
    render(
      wrap(<EditableNumber variableId="x" value={1} format={fmt.fte} changed popover={target()} />),
    );
    expect(screen.getByRole('button', { name: /Net target/ }).hasAttribute('data-changed')).toBe(
      true,
    );
  });

  it('input mode opens the popover (dialog) and Done closes it', () => {
    render(
      wrap(
        <EditableNumber
          variableId="g.target_net"
          value={100}
          format={(v) => fmt.money(v, { digits: 0 })}
          popover={target()}
        />,
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const btn = screen.getByRole('button', { name: /Net target/ });
    expect(btn.textContent).toBe('$100M');
    expect(btn.getAttribute('data-id')).toBe('g.target_net');
    fireEvent.click(btn);
    const dlg = screen.getByRole('dialog', { name: 'Net target · CY27' });
    expect(document.activeElement).toBe(within(dlg).getByRole('textbox'));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('output mode calls onTrace with the node id and does not open the popover', () => {
    const onTrace = vi.fn();
    render(
      wrap(
        <EditableNumber
          mode="output"
          nodeId="res.net"
          value={43}
          format={fmt.money}
          onTrace={onTrace}
        />,
      ),
    );
    const btn = screen.getByRole('button', { name: '$43.0M' });
    fireEvent.click(btn);
    expect(onTrace).toHaveBeenCalledExactlyOnceWith('res.net');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an em dash for a missing value and follows pushed values', () => {
    const { rerender } = render(
      wrap(<EditableNumber variableId="x" value={null} format={fmt.money} />),
    );
    expect(screen.getByRole('button').textContent).toBe('—');
    rerender(wrap(<EditableNumber variableId="x" value={7.5} format={fmt.money} />));
    expect(screen.getByRole('button').textContent).toBe('$7.5M');
  });
});

describe('UI-09 EditPopover: number field, slider, chips, Reset / Done, Escape, Pin with reason', () => {
  const base = {
    ...target(),
    value: 100,
    format: (v: number) => fmt.money(v, { digits: 0 }),
  };

  it('renders the number field, slider within min/max, and the source, confidence and default chips', () => {
    render(wrap(<EditPopover {...base} onClose={() => {}} />));
    const dlg = screen.getByRole('dialog', { name: 'Net target · CY27' });
    expect((within(dlg).getByRole('textbox') as HTMLInputElement).value).toBe('$100M');
    const slider = within(dlg).getByRole('slider') as HTMLInputElement;
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['50', '150', '1', '100']);
    expect(within(dlg).getByText('$M')).toBeTruthy();
    expect(within(dlg).getByText('Source · User')).toBeTruthy();
    expect(within(dlg).getByText('Confidence · High')).toBeTruthy();
    expect(within(dlg).getByText('Default $100M')).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: 'Reset' })).toBeTruthy();
    expect(within(dlg).getByRole('button', { name: 'Done' })).toBeTruthy();
    // input mode: no pin controls
    expect(within(dlg).queryByRole('button', { name: 'Pin with reason' })).toBeNull();
  });

  it('typed value commits on Enter, slider changes call onChange', () => {
    const onChange = vi.fn();
    render(wrap(<EditPopover {...base} onChange={onChange} onClose={() => {}} />));
    const num = screen.getByRole('textbox');
    fireEvent.change(num, { target: { value: '$125M' } });
    fireEvent.keyDown(num, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(125);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '60' } });
    expect(onChange).toHaveBeenLastCalledWith(60);
    // garbage reverts to the shown value without a call
    onChange.mockClear();
    fireEvent.change(num, { target: { value: 'abc' } });
    fireEvent.blur(num);
    expect(onChange).not.toHaveBeenCalled();
    expect((num as HTMLInputElement).value).toBe('$100M');
  });

  it('a custom parse handles units (percent typed as 4 means 0.04)', () => {
    const onChange = vi.fn();
    render(
      wrap(
        <EditPopover
          {...base}
          value={0.04}
          min={0}
          max={0.15}
          step={0.005}
          defaultValue={0.04}
          format={fmt.pct}
          parse={(t) => (parseNumber(t) ?? NaN) / 100 || null}
          onChange={onChange}
          onClose={() => {}}
        />,
      ),
    );
    const num = screen.getByRole('textbox');
    fireEvent.change(num, { target: { value: '5.5%' } });
    fireEvent.blur(num);
    expect(onChange).toHaveBeenCalledWith(0.055);
  });

  it('Reset restores the default (onReset, else onChange(default)) and closes; Done closes', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(
      wrap(<EditPopover {...base} value={120} onChange={onChange} onClose={onClose} />),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenCalledWith(100);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const onReset = vi.fn();
    const onClose2 = vi.fn();
    render(
      wrap(<EditPopover {...base} onReset={onReset} onChange={onChange} onClose={onClose2} />),
    );
    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose2).toHaveBeenCalledTimes(2);
  });

  it('Escape closes the popover (and an outside press does too)', () => {
    const onClose = vi.fn();
    render(
      wrap(
        <div>
          <span data-testid="outside">elsewhere</span>
          <EditPopover {...base} onClose={onClose} />
        </div>,
      ),
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape closes through EditableNumber and returns focus to the number', () => {
    render(
      wrap(
        <EditableNumber
          variableId="g.target_net"
          value={100}
          format={fmt.fte}
          popover={target()}
        />,
      ),
    );
    const btn = screen.getByRole('button', { name: /Net target/ });
    fireEvent.click(btn);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('output mode offers "Pin with reason": needs a reason, then calls onPin(value, reason)', () => {
    const onPin = vi.fn();
    const onClose = vi.fn();
    render(
      wrap(<EditPopover {...base} mode="output" value={43} onPin={onPin} onClose={onClose} />),
    );
    const pin = screen.getByRole('button', { name: 'Pin with reason' }) as HTMLButtonElement;
    expect(pin.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for pinning' }), {
      target: { value: '  Board-approved figure ' },
    });
    expect(pin.disabled).toBe(false);
    fireEvent.click(pin);
    expect(onPin).toHaveBeenCalledExactlyOnceWith({ value: 43, reason: 'Board-approved figure' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('EditableNumber output mode: the pin button opens the popover in output mode', () => {
    const onPin = vi.fn();
    const onTrace = vi.fn();
    render(
      wrap(
        <EditableNumber
          mode="output"
          nodeId="res.net"
          value={43}
          format={fmt.money}
          onTrace={onTrace}
          popover={target({ label: 'Net savings · CY27', onPin })}
        />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Pin with reason: Net savings/ }));
    const dlg = screen.getByRole('dialog', { name: 'Net savings · CY27' });
    expect(dlg.getAttribute('data-mode')).toBe('output');
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Reason for pinning' }), {
      target: { value: 'Locked by CFO' },
    });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Pin with reason' }));
    expect(onPin).toHaveBeenCalledExactlyOnceWith({ value: 43, reason: 'Locked by CFO' });
    expect(onTrace).not.toHaveBeenCalled();
  });
});

describe('UI-09 warnings are tier 2 words, verbatim', () => {
  it('renders each warning text exactly as given, in a status region', () => {
    const warnings = [
      'Above the CY26 ceiling of $150M — check the cap.',
      '  Spacing, <b>markup</b> and “quotes” stay as written.  ',
    ];
    render(
      wrap(
        <EditPopover
          {...target()}
          value={100}
          format={fmt.fte}
          warnings={warnings}
          onClose={() => {}}
        />,
      ),
    );
    const region = screen.getByRole('status');
    const items = within(region).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(warnings);
    expect(items[1]!.querySelector('b')).toBeNull();
    // the number field points at the warnings
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe(region.id);
  });

  it('renders no warning region when there are none', () => {
    render(
      wrap(
        <EditPopover {...target()} value={100} format={fmt.fte} warnings={[]} onClose={() => {}} />,
      ),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('UI-09 no formulas or business rules: values arrive as props', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.tsx'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

  it('imports nothing from tier 2 or tier 3, and no number-format calls outside format', () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(
        /tier2-logic|tier3-data|@glidepath\/(engine|domain|solvers|excel|data-access)/,
      );
      expect(src, f).not.toMatch(/\.(toFixed|toLocaleString|toPrecision)\(|\bIntl\b/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\d(px)\b/);
    }
  });

  it('has no accessibility violations (axe) with the popover open', async () => {
    const { container } = render(
      wrap(
        <main>
          <EditableNumber
            variableId="g.target_net"
            value={100}
            format={fmt.fte}
            popover={target({ warnings: ['Check the cap.'] })}
          />
        </main>,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Net target/ }));
    const res = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((x) => x.id)).toEqual([]);
    void container;
  });
});
