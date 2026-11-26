import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type Change,
  type DimKey,
  type MemberKey,
  type SourcingParam,
} from '@glidepath/api-contract';
import { Stepper } from '@glidepath/ui/inputs/controls';
import { parseNumber, parsePercent } from '@glidepath/ui/inputs/editable';
import { formatByUnit, snapToStep } from '@glidepath/ui/inputs/slider';
import { useBindContext } from '../../bind';

/** The tenant dimension the parameters are members of (SRC-02). */
export const PARAM_DIM = 'sourcing_param';

/** Units `formatByUnit` reads as a model unit; the rest show the plain number with the unit beside it. */
const FORMATTED_UNITS = new Set(['%', '$M']);

/** The value as the stepper shows it: `%` params are fractions (0.35 reads 35%), `$M` money. */
export const paramText = (p: Pick<SourcingParam, 'unit' | 'step'>, value: number): string =>
  formatByUnit(value, FORMATTED_UNITS.has(p.unit) ? p.unit : '', p.step);

/** Unit shown after the stepper when the number itself does not carry it. */
const unitSuffix = (unit: string) => (FORMATTED_UNITS.has(unit) ? '' : unit);

/**
 * The structural change that writes one parameter: the whole `sourcing_param` member row
 * (`{ label, attrs, sort, active }`, label being a column) with `attrs.value` replaced. The attributes
 * are the member's (`value`, `unit`, `min`, `max`, `step`, `group`), as `GET /sourcing/params` returns
 * them; `sort` is the member's place in that answer (tier 2 lists the members in `sort` order).
 */
export function paramChange(p: SourcingParam, place: number, value: number): Change {
  return {
    target: 'structural',
    key: PARAM_DIM as DimKey,
    member: p.key as MemberKey,
    value: {
      label: p.label,
      attrs: { value, unit: p.unit, min: p.min, max: p.max, step: p.step, group: p.group },
      sort: place,
      active: true,
    },
  };
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The edit was not saved';

export interface ParamStripProps {
  /** Every parameter, in tier 2's order. */
  params: readonly SourcingParam[];
  /** `group` of the parameters to show (seed groups: `renewals`, `benchmarks`, `consolidation`). */
  group: string;
  /** After tier 2 accepted an edit: read the views again. */
  onCommitted(): void;
}

/**
 * Compact steppers for one panel's parameters. An edit goes through the commit queue as a structural
 * change on `sourcing_param`; the stepper holds the typed value until tier 2 answers, then the panel
 * reads again. A refused edit shows tier 2's line and the stepper falls back to tier 2's value.
 */
export function ParamStrip({ params, group, onCommitted }: ParamStripProps) {
  const ctx = useBindContext();
  // Typed values per parameter until tier 2's next params read; `done`: the commit was accepted.
  const [held, setHeld] = useState<Readonly<Record<string, { value: number; done: boolean }>>>({});
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Record<string, number>>({});

  // A new params read from tier 2 replaces the values whose commit was accepted.
  useEffect(() => {
    setHeld((h) => {
      const kept = Object.entries(h).filter(([, v]) => !v.done);
      return kept.length === Object.keys(h).length ? h : Object.fromEntries(kept);
    });
  }, [params]);

  const edit = useCallback(
    (p: SourcingParam, place: number, typed: number) => {
      const commit = ctx.commit;
      if (!commit) return;
      const value = snapToStep(typed, p.min, p.max, p.step);
      const token = (latest.current[p.key] ?? 0) + 1;
      latest.current[p.key] = token;
      setHeld((h) => ({ ...h, [p.key]: { value, done: false } }));
      setError(null);
      const mine = () => latest.current[p.key] === token;
      commit(paramChange(p, place, value)).then(
        () => {
          // Only the last edit of a burst reads again (the queue posts them as one changeset).
          if (!mine()) return;
          setHeld((h) => ({ ...h, [p.key]: { value, done: true } }));
          onCommitted();
        },
        (e: unknown) => {
          setError(lineOf(e));
          if (!mine()) return;
          setHeld((h) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== p.key)));
        },
      );
    },
    [ctx.commit, onCommitted],
  );

  const shown = params
    .map((p, i) => ({ p, place: i + 1 }))
    .filter(({ p }) => p.group === group);
  if (shown.length === 0) return null;

  return (
    <>
      <ul className="gp-src-params" aria-label="Parameters">
        {shown.map(({ p, place }) => {
          const value = held[p.key]?.value ?? p.value;
          const suffix = unitSuffix(p.unit);
          return (
            <li
              key={p.key}
              className="gp-src-param"
              data-param={p.key}
              data-pending={held[p.key] === undefined ? undefined : ''}
            >
              <span className="gp-src-param-label" title={p.label}>
                {p.label}
              </span>
              <Stepper
                variableId={`${PARAM_DIM}[${p.key}]`}
                label={p.label}
                value={value}
                step={p.step}
                min={p.min}
                max={p.max}
                format={(v) => paramText(p, v)}
                parse={p.unit === '%' ? parsePercent('fraction') : parseNumber}
                onChange={(v) => edit(p, place, v)}
              />
              {suffix && <span className="gp-src-sub">{suffix}</span>}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="gp-src-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
