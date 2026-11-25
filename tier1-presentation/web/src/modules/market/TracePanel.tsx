import type { ReactNode } from 'react';
import { toCellKey } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { TraceChain, type TraceChainNode } from '@glidepath/ui/rows';
import { useNode } from '../../bind';
import { overlayController, useTraceCell } from '../../global/overlays';
import { COPY, DRIVER_YEAR, TRACE_COPY, TRACE_IDS, VALUATION, type TraceId } from './copy';
import { asCost } from './format';

const linkGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

/** One pushed cell as the chain's value text; `—` until tier 2 has pushed it. */
function useShown(id: TraceId, show: (v: number) => string) {
  const n = useNode(id);
  return typeof n.value === 'number' ? show(n.value) : fmt.money(null);
}

/** The pieces of the chain notes that are cells of their own (EPS % vs base, multiple, shares). */
function useNotes(): Partial<Record<TraceId, ReactNode>> {
  const pct = useNode('br.eps_pct27');
  const w = useNode(VALUATION.weight);
  const ev = useNode(VALUATION.ev);
  const pe = useNode(VALUATION.pe);
  const shares = useNode('corp.shares', DRIVER_YEAR);
  // The multiple that prices the share: P/E once any weight sits on it, else EV / EBITDAR.
  const usesPe = typeof w.value === 'number' && w.value > 0;
  const mult = usesPe ? pe.value : ev.value;
  return {
    'br.eps27':
      typeof pct.value === 'number'
        ? `${fmt.pct(pct.value, { digits: 1, signed: true, scale: pct.def?.percentScale })} ${COPY.vsBase}`
        : '',
    'br.px27':
      typeof mult === 'number' ? `${usesPe ? COPY.basisPe : COPY.basisEv} ${fmt.mult(mult)}` : '',
    'br.mcap27':
      typeof shares.value === 'number' ? `${fmt.fte(shares.value)}${COPY.sharesNote}` : '',
  };
}

/**
 * Trace (12 cols): res.net → pnl.o27 → res.tot_ot_all → br.ebitda27 → br.eps27 → br.px27 →
 * br.mcap27, each a trace node that opens the trace drawer on its cell. Values are the
 * session's; the notes `br.eps_pct27`, the multiple and the share count are cells too.
 */
export function TracePanel({ year }: { year: string | null }) {
  const traceCell = useTraceCell(overlayController);
  const notes = useNotes();

  const shown: Record<TraceId, string> = {
    'res.net': useShown('res.net', (v) => fmt.money(v)),
    'pnl.o27': useShown('pnl.o27', (v) => fmt.money(v)),
    'res.tot_ot_all': useShown('res.tot_ot_all', asCost),
    'br.ebitda27': useShown('br.ebitda27', (v) => fmt.signed(v, 'money')),
    'br.eps27': useShown('br.eps27', (v) => fmt.signed(v, 'eps')),
    'br.px27': useShown('br.px27', (v) => fmt.eps(v, { digits: 2, signed: true })),
    'br.mcap27': useShown('br.mcap27', (v) => fmt.money(v, { digits: 0, signed: true })),
  };

  const nodes: TraceChainNode[] = TRACE_IDS.map((id) => {
    const note = notes[id] ?? TRACE_COPY[id].note;
    return {
      nodeId: id,
      label: TRACE_COPY[id].label,
      value: shown[id],
      ...(note ? { note } : {}),
    };
  });
  const selected = TRACE_IDS.find((id) => toCellKey(id, '') === traceCell) ?? null;
  const loading = shown['res.net'] === fmt.money(null);

  return (
    <GlassPanel
      span={12}
      level={1}
      data-testid="market-trace"
      header={{
        label: year ? COPY.traceLabel(year) : <Skeleton size="label" width="30%" />,
        status: (
          <button
            type="button"
            className="gp-market-formulas"
            onClick={() => overlayController.openTrace(toCellKey(selected ?? TRACE_IDS[0], ''))}
          >
            {linkGlyph}
            <span>{COPY.showFormulas}</span>
          </button>
        ),
      }}
      loading={loading}
    >
      <TraceChain
        nodes={nodes}
        selectedId={selected}
        label={COPY.traceList}
        onOpen={(id) => overlayController.openTrace(toCellKey(id, ''))}
      />
    </GlassPanel>
  );
}
