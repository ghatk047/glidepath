import { useEffect, useState } from 'react';
import { ApiError, type ExplainResponse } from '@glidepath/api-contract';
import { EM_DASH } from '@glidepath/ui/format';
import { Skeleton } from '@glidepath/ui/glass';
import { TraceDrawer, type TraceContent, type TraceItem } from '@glidepath/ui/overlays/drawer';
import { formatFor, useTrace } from '../../bind';

/** Presses on these re-point the drawer instead of closing it (trace triggers, output numbers). */
export const TRACE_TRIGGERS = '[data-node],[data-trace],[data-mode="output"]';

const show = (value: number | null, unit: string) =>
  value === null ? EM_DASH : formatFor(undefined, unit)(value);

/**
 * The drawer content for tier 2's explain answer, as sent: value, node id, formula in words, the
 * upstream chain from the farthest input to the cell itself (tier 2's `depth`, deepest first; the
 * cell last, highlighted) and the top drivers in tier 2's order.
 */
export function traceContent(x: ExplainResponse): TraceContent {
  const chain = x.upstream
    .map((u, i) => ({ u, i }))
    .sort((a, b) => b.u.depth - a.u.depth || a.i - b.i)
    .map(({ u }): TraceItem => ({ id: u.cell, label: u.label, value: show(u.value, u.unit) }));
  return {
    title: x.label,
    value: show(x.value, x.unit),
    nodeId: x.node,
    formula: x.words,
    upstream: [...chain, { id: x.node, label: x.label, value: show(x.value, x.unit) }],
    drivers: x.drivers.map((d) => ({ id: d.cell, label: d.label, value: show(d.value, d.unit) })),
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
  useEffect(() => {
    if (t.data) onContent(traceContent(t.data));
    else if (t.isError)
      onContent({
        ...loading(cell),
        title: cell,
        value: EM_DASH,
        formula: t.error instanceof ApiError ? t.error.problem.detail : String(t.error),
      });
    else onContent(loading(cell));
  }, [t.data, t.isError, t.error, cell, onContent]);
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
