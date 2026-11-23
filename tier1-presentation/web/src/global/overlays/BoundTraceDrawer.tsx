import { useEffect, useMemo, useState } from 'react';
import { ApiError, type ExplainResponse, type PercentScale } from '@glidepath/api-contract';
import { EM_DASH } from '@glidepath/ui/format';
import { Skeleton } from '@glidepath/ui/glass';
import { TraceDrawer, type TraceContent, type TraceItem } from '@glidepath/ui/overlays/drawer';
import { formatFor, useBindContext, useTrace } from '../../bind';
import { useBundle } from '../../data';

/** Presses on these re-point the drawer instead of closing it (trace triggers, output numbers). */
export const TRACE_TRIGGERS = '[data-node],[data-trace],[data-mode="output"]';

/** The bundle's percent scale of a cell's variable or node (`id[member]`); none while unknown. */
export type ScaleOf = (cell: string) => PercentScale | null | undefined;

const NO_SCALE: ScaleOf = () => undefined;
const idOf = (cell: string) => cell.slice(0, cell.indexOf('[') < 0 ? undefined : cell.indexOf('['));

const show = (value: number | null, unit: string, scale?: PercentScale | null) =>
  value === null ? EM_DASH : formatFor(undefined, unit, undefined, scale)(value);

/**
 * The drawer content for tier 2's explain answer, as sent: value, node id, formula in words, the
 * upstream chain from the farthest input to the cell itself (tier 2's `depth`, deepest first; the
 * cell last, highlighted) and the top drivers in tier 2's order.
 */
export function traceContent(x: ExplainResponse, scaleOf: ScaleOf = NO_SCALE): TraceContent {
  const showCell = (value: number | null, unit: string, cell: string) =>
    show(value, unit, scaleOf(cell));
  const chain = x.upstream
    .map((u, i) => ({ u, i }))
    .sort((a, b) => b.u.depth - a.u.depth || a.i - b.i)
    .map(({ u }): TraceItem => ({
      id: u.cell,
      label: u.label,
      value: showCell(u.value, u.unit, u.cell),
    }));
  return {
    title: x.label,
    value: showCell(x.value, x.unit, x.node),
    nodeId: x.node,
    formula: x.words,
    upstream: [...chain, { id: x.node, label: x.label, value: showCell(x.value, x.unit, x.node) }],
    drivers: x.drivers.map((d) => ({
      id: d.cell,
      label: d.label,
      value: showCell(d.value, d.unit, d.cell),
    })),
  };
}

const loading = (cell: string): TraceContent => ({
  title: <Skeleton size="label" width="40%" />,
  value: <Skeleton size="block" width="60%" />,
  nodeId: cell,
  formula: <Skeleton size="label" width="80%" />,
});

/** Fetches `/nodes/:cell/explain` (`useTrace`) while mounted and hands the content up. */
function TraceSource({ cell, onContent }: { cell: string; onContent: (c: TraceContent) => void }) {
  const t = useTrace(cell);
  const { tenant } = useBindContext();
  const bundle = useBundle(tenant);
  const scaleOf = useMemo<ScaleOf>(() => {
    const byId = new Map<string, PercentScale | null>(
      [...(bundle.data?.variables ?? []), ...(bundle.data?.nodes ?? [])].map(
        (d) => [d.id, d.percentScale] as const,
      ),
    );
    return (c) => byId.get(idOf(c));
  }, [bundle.data]);
  useEffect(() => {
    if (t.data) onContent(traceContent(t.data, scaleOf));
    else if (t.isError)
      onContent({
        ...loading(cell),
        title: cell,
        value: EM_DASH,
        formula: t.error instanceof ApiError ? t.error.problem.detail : String(t.error),
      });
    else onContent(loading(cell));
  }, [t.data, t.isError, t.error, cell, onContent, scaleOf]);
  return null;
}

/** Trace drawer bound to a cell (`null` closes it; the last content stays while it slides out). */
export function BoundTraceDrawer({ cell, onClose }: { cell: string | null; onClose: () => void }) {
  const [content, setContent] = useState<TraceContent | null>(null);
  return (
    <>
      {cell !== null && <TraceSource key={cell} cell={cell} onContent={setContent} />}
      <TraceDrawer
        content={cell === null ? null : content}
        onClose={onClose}
        ignoreOutside={TRACE_TRIGGERS}
      />
    </>
  );
}
