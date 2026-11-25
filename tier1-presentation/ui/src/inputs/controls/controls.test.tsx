// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dial, PromptBar, PROMPT_NOTE, RadioCard, Segmented, Stepper, Toggle, controlsCss } from './index';

afterEach(cleanup);

const rules = () =>
  [...controlsCss.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]!.trim() }));
const rule = (s: string) => rules().find((r) => r.selector === s)?.body ?? '';

describe('UI-10 Dial', () => {
  const props = { label: 'Brent', value: 5, min: 0, max: 10, step: 1, defaultValue: 5 };

  it('role=slider with aria values; arrow keys step; ghost tick marks default; arc is 270 degrees', () => {
    const onChange = vi.fn();
    render(<Dial {...props} onChange={onChange} />);
    const s = screen.getByRole('slider', { name: 'Brent' });
    expect(s.getAttribute('aria-valuenow')).toBe('5');
    expect(s.getAttribute('aria-valuemin')).toBe('0');
    expect(s.getAttribute('aria-valuemax')).toBe('10');
    fireEvent.keyDown(s, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(s, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(4);
    expect(screen.getByTestId('dial-ghost')).toBeTruthy();
    expect(s.querySelector('.gp-dial-track')!.getAttribute('d')).toMatch(/A37 37 0 1 1/);
  });

  it('clamps at the ends and drags up/down', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Dial {...props} value={10} onChange={onChange} />);
    const s = screen.getByRole('slider');
    fireEvent.keyDown(s, { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<Dial {...props} onChange={onChange} />);
    fireEvent.pointerDown(s, { clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(s, { clientY: 120, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(10);
    fireEvent.pointerUp(s, { pointerId: 1 });
  });

  it('has no axe violations', async () => {
    const { container } = render(<Dial {...props} />);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('UI-10 Toggle, Stepper, Segmented, RadioCard', () => {
  it('Toggle springs on the toggle spring token and reports changes', () => {
    expect(rule('.gp-toggle-track::after')).toContain('transition: transform');
    expect(rule('.gp-toggle-track::after')).toContain('var(--motion-spring)');
    const onChange = vi.fn();
    render(<Toggle label="Lever" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Lever' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Stepper steps by step and accepts typed entry', () => {
    const onChange = vi.fn();
    render(<Stepper label="US FTE" value={1000} step={50} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase US FTE' }));
    expect(onChange).toHaveBeenLastCalledWith(1050);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease US FTE' }));
    expect(onChange).toHaveBeenLastCalledWith(950);
    const input = screen.getByRole('textbox', { name: 'US FTE' }) as HTMLInputElement;
    expect(input.value).toBe('1,000');
    fireEvent.change(input, { target: { value: '1,234' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(1234);
  });

  it('Segmented marks the choice with aria-pressed and reports ids', () => {
    const onChange = vi.fn();
    render(
      <Segmented label="Method" value="2" options={[{ id: '1', label: 'Proportional' }, { id: '2', label: 'Equal' }]} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: 'Equal' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Proportional' }));
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('RadioCard checked = glass-2 + hairline', () => {
    expect(rule('.gp-radio-card[data-checked]')).toContain('background: var(--glass-2)');
    expect(rule('.gp-radio-card[data-checked]')).toContain('border-color: var(--glass-line)');
    const onChange = vi.fn();
    const { container } = render(
      <RadioCard label="Objective" value="a" options={[{ id: 'a', label: 'Max net' }, { id: 'b', label: 'Min risk' }]} onChange={onChange} />,
    );
    const cards = container.querySelectorAll('.gp-radio-card');
    expect(cards[0]!.hasAttribute('data-checked')).toBe(true);
    expect(cards[1]!.hasAttribute('data-checked')).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Min risk' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div>
        <Toggle label="Lever" value />
        <Stepper label="FTE" value={1} step={1} />
        <Segmented label="M" value="a" options={[{ id: 'a', label: 'A' }]} />
        <RadioCard label="O" value="a" options={[{ id: 'a', label: 'A' }]} />
      </div>,
    );
    expect((await axe.run(container)).violations).toEqual([]);
  });
});

describe('UI-10 PromptBar', () => {
  it('submits the value and says it ends in a reviewable changeset', () => {
    const onSubmit = vi.fn();
    render(<PromptBar value="Set up Alaska for CY27" onSubmit={onSubmit} />);
    expect(screen.getByText(PROMPT_NOTE).textContent).toMatch(/reviewable changeset/);
    fireEvent.click(screen.getByRole('button', { name: 'Draft' }));
    expect(onSubmit).toHaveBeenCalledWith('Set up Alaska for CY27');
  });

  it('has no hex colours or raw pixel sizes in the CSS (tokens only)', () => {
    expect(controlsCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(controlsCss.replace(/\b1px\b/g, '')).not.toMatch(/\d\s?px\b/);
  });
});
