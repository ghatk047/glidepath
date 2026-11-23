import { useEffect } from 'react';
import { useStore } from 'zustand';
import { toCellKey, type NodeDef } from '@glidepath/api-contract';
import { useBundle } from '../data';
import { selectCell, type CellValue } from '../session';
import { useBindContext } from './context';

/** One cell as tier 2 pushed it. */
export interface BoundNode {
  /** Spec id, verbatim (`res.net`). */
  readonly id: string;
  /** Member key (`''` for a scalar, `pilots,fy27`). */
  readonly member: string;
  /** Cell key the session uses (`res.net[]`). */
  readonly cell: string;
  /** Last pushed value; `null` = tier 2 has none; `undefined` = not received yet. */
  readonly value: CellValue | undefined;
  /** Kept from before a drop: show dimmed. */
  readonly stale: boolean;
  /** Label, unit and dims from the bundle, when the id is a formula node. */
  readonly def: NodeDef | undefined;
}

/**
 * Subscribes the component to one cell of the session: `subscribe` on mount, release on unmount
 * (reference-counted by the session client), re-render when tier 2 pushes a new value.
 */
export function useCell(id: string, member = ''): Omit<BoundNode, 'def'> {
  const { session } = useBindContext();
  const cell = toCellKey(id, member);
  useEffect(() => session.subscribe([cell]), [session, cell]);
  const entry = useStore(session.store, selectCell(cell));
  return { id, member, cell, value: entry?.value, stale: entry?.stale ?? false };
}

/** `useNode(id, member?)`: the cell's pushed value plus the node's definition from the bundle. */
export function useNode(id: string, member = ''): BoundNode {
  const { tenant } = useBindContext();
  const cell = useCell(id, member);
  const bundle = useBundle(tenant);
  const def = bundle.data?.nodes.find((n) => n.id === id);
  return { ...cell, def };
}
