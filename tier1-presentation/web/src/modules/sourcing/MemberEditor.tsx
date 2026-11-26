import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  type Change,
  type DimKey,
  type SourcingMember,
  type SourcingMemberDim,
} from '@glidepath/api-contract';
import { Stepper } from '@glidepath/ui/inputs/controls';
import { parseNumber } from '@glidepath/ui/inputs/editable';
import { useBindContext } from '../../bind';

/** One numeric attribute of a member, edited with a stepper. Bounds and step are input granularity only. */
export interface MemberField {
  attr: string;
  label: string;
  step: number;
  min?: number;
  max?: number;
  format(v: number): string;
  parse?(text: string): number | null;
}

/**
 * The structural change that writes a member: its whole stored row (`{ label, attrs, sort, active }`,
 * as `GET /sourcing/members` returned it) with the edited attributes replaced by the typed values.
 */
export function memberChange(dim: SourcingMemberDim, m: SourcingMember, edits: Readonly<Record<string, number>>): Change {
  return {
    target: 'structural',
    key: dim as DimKey,
    member: m.key,
    value: { label: m.label, attrs: { ...m.attrs, ...edits }, sort: m.sort, active: m.active },
  };
}

const lineOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : 'The edit was not saved';

const numberOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface MemberEditorProps {
  dim: SourcingMemberDim;
  /** The stored row; `null` while `GET /sourcing/members` has not answered (or has no such member). */
  member: SourcingMember | null;
  fields: readonly MemberField[];
  /** After tier 2 accepted an edit: read the views and the rows again. */
  onCommitted(): void;
}

/**
 * Inline steppers for some attributes of one `contract` or `benchmark` member. Each edit commits the
 * member's whole row through the commit queue (edits of several fields of one member go together, the
 * queue keeping the latest row); the typed value stays until tier 2's next read of the rows.
 */
export function MemberEditor({ dim, member, fields, onCommitted }: MemberEditorProps) {
  const ctx = useBindContext();
  const [held, setHeld] = useState<Readonly<Record<string, number>>>({});
  const done = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // A new read of the row replaces the values tier 2 accepted.
  useEffect(() => {
    if (!done.current) return;
    done.current = false;
    setHeld({});
  }, [member]);

  const edit = useCallback(
    (attr: string, value: number) => {
      const commit = ctx.commit;
      if (!commit || !member) return;
      const edits = { ...held, [attr]: value };
      const token = latest.current + 1;
      latest.current = token;
      setHeld(edits);
      done.current = false;
      setError(null);
      commit(memberChange(dim, member, edits)).then(
        () => {
          if (latest.current !== token) return;
          done.current = true;
          onCommitted();
        },
        (e: unknown) => {
          setError(lineOf(e));
          if (latest.current === token) setHeld({});
        },
      );
    },
    [ctx.commit, dim, member, held, onCommitted],
  );

  if (!member) return <p className="gp-src-note">Loading the stored terms…</p>;
  return (
    <div data-member={member.key}>
      <ul className="gp-src-params" aria-label={`Edit ${member.label}`}>
        {fields.map((f) => {
          const value = held[f.attr] ?? numberOf(member.attrs[f.attr]);
          if (value === null) return null;
          return (
            <li key={f.attr} className="gp-src-param" data-attr={f.attr} data-pending={held[f.attr] === undefined ? undefined : ''}>
              <span className="gp-src-param-label" title={f.label}>
                {f.label}
              </span>
              <Stepper
                variableId={`${dim}[${member.key}].${f.attr}`}
                label={f.label}
                value={value}
                step={f.step}
                {...(f.min === undefined ? {} : { min: f.min })}
                {...(f.max === undefined ? {} : { max: f.max })}
                format={f.format}
                parse={f.parse ?? parseNumber}
                onChange={(v) => edit(f.attr, v)}
              />
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="gp-src-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
