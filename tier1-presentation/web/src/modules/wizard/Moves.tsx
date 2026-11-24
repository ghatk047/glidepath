import { useRef } from 'react';
import type { RankedMove, VariableDef } from '@glidepath/api-contract';
import { MoveRow } from '@glidepath/ui/rows';
import { COPY } from './copyResult';
import { useLanding } from '../path/useLanding';

/** `lev.L01.cut[]` → `lev.L01.cut`, `''`; `lev.start[L03]` → `lev.start`, `L03`. */
const splitCell = (cell: string): { id: string; member: string } => {
  const m = /^(.*)\[(.*)\]$/.exec(cell);
  return m ? { id: m[1]!, member: m[2]! } : { id: cell, member: '' };
};

/**
 * The optimizer's ranked moves, in tier 2's order, landing one by one (`motion.stagger`). Labels,
 * limits, step and unit come from the registry variable of each cell. `runId` keys the landing
 * and is remembered across the scenario switch of "Use this path", so the list does not replay.
 */
export function Moves({
  moves,
  runId,
  variables,
  from,
}: {
  moves: readonly RankedMove[];
  runId: string | null;
  variables: readonly VariableDef[] | undefined;
  from: string;
}) {
  const last = useRef<string | null>(null);
  if (runId) last.current = runId;
  const shown = useLanding(runId ?? last.current ?? 'kept', moves.length);
  if (moves.length === 0) return null;
  return (
    <ol className="gp-wzr-moves" aria-label={COPY.moves} aria-busy={shown < moves.length}>
      {moves.slice(0, shown).map((move, i) => {
        const { id, member } = splitCell(move.cell);
        const def = variables?.find((v) => v.id === id);
        const label = def ? (member ? `${def.label} · ${member}` : def.label) : move.cell;
        return (
          <li key={move.cell} data-cell={move.cell} data-moved={id} data-impact={move.impact}>
            <MoveRow
              variableId={id}
              label={label}
              from={move.from}
              to={move.to}
              min={def?.min ?? move.from}
              max={def?.max ?? move.to}
              unit={def?.unit ?? ''}
              step={def?.step ?? undefined}
              rank={i + 1}
              fromLabel={from}
            />
          </li>
        );
      })}
    </ol>
  );
}
