import { useEffect, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { toCellKey } from '@glidepath/api-contract';
import { Toggle } from '@glidepath/ui/inputs/controls';
import { useBindContext, useNode, useVariable, Value, type FormatProp } from '../../bind';
import { useGlow } from './useGlow';

/** An output number (`<Value>`) that glows for a moment when tier 2 pushes a new value. */
export function GlowValue({
  node,
  member = '',
  format,
  className,
}: {
  node: string;
  member?: string;
  format?: FormatProp;
  className?: string;
}) {
  const bound = useNode(node, member);
  const glow = useGlow(bound.value);
  return (
    <span className={className} data-glow={glow || undefined}>
      <Value node={node} member={member} format={format} />
    </span>
  );
}

/** Text that follows a pushed value (a view row, a node cell) and glows when it changes. */
export function GlowText({ value, children }: { value: unknown; children: ReactNode }) {
  const glow = useGlow(value);
  return (
    <span data-glow={glow || undefined} data-value={typeof value === 'number' ? value : undefined}>
      {children}
    </span>
  );
}

/** Pushed values of one id over several members, in the order given (undefined = not yet). */
export function useCells(id: string, members: readonly string[]): (number | null | undefined)[] {
  const { session } = useBindContext();
  const cells = members.map((m) => toCellKey(id, m));
  const key = cells.join('|');
  useEffect(() => session.subscribe(cells), [session, key]);
  return useStore(
    session.store,
    useShallow((s) => cells.map((c) => s.cells.get(c)?.value)),
  );
}

/** 0/1 registry variable as a switch; the write goes through the commit queue. */
export function BoundToggle({
  variable,
  member = '',
  label,
}: {
  variable: string;
  member?: string;
  label: string;
}) {
  const v = useVariable(variable, member);
  return (
    <Toggle
      variableId={variable}
      label={label}
      value={v.value === 1}
      disabled={v.value === undefined}
      onChange={(on) => void v.commit(on ? 1 : 0).catch(() => undefined)}
    />
  );
}
