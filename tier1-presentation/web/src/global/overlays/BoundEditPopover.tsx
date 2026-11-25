import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  toCellKey,
  type Change,
  type ChangesetResult,
  type MemberKey,
  type NodeKey,
  type Violation,
} from '@glidepath/api-contract';
import { EM_DASH } from '@glidepath/ui/format';
import { EditPopover } from '@glidepath/ui/inputs/editable';
import { formatFor, parseFor, useBindContext, useNode, useVariable } from '../../bind';
import { useCommitState } from '../../commit';
import { useApiClient, useInputs } from '../../data';
import type { PopoverTarget } from './controller';

/** Source chip of an output (a formula node has no registry source). */
export const OUTPUT_SOURCE = 'Calculated';

const num = (v: number | null | undefined) => (typeof v === 'number' ? v : Number.NaN);
/** No registry step: HTML reads a non-positive range step as its default; typing is unrestricted. */
const NO_STEP = 0;
const labelOf = (label: string, member: string) => (member ? `${label} · ${member}` : label);
const ignore = () => undefined; // the shell shows commit errors (queue error chip)

/**
 * Tier 2's rule warnings of the last commit, verbatim: those naming this cell (or no cell); after
 * a commit from this popover, every warning of that commit.
 */
function useWarnings(cell: string, committed: boolean): string[] {
  const warnings = useCommitState((s) => s.warnings);
  return useMemo(
    () =>
      warnings
        .filter(
          (w: Violation) => committed || w.cells.length === 0 || w.cells.includes(cell as never),
        )
        .map((w) => w.message),
    [warnings, committed, cell],
  );
}

/** Sends one change: the screen's commit queue, else a direct `POST /changesets`. */
function useSend(): (change: Change) => Promise<ChangesetResult> {
  const ctx = useBindContext();
  const client = useApiClient();
  const inputs = useInputs(ctx.tenant, ctx.scenarioId);
  const latest = useRef({ ctx, version: inputs.data?.version });
  latest.current = { ctx, version: inputs.data?.version };
  return (change) => {
    const { ctx: c, version } = latest.current;
    if (c.commit) return c.commit(change);
    const s = c.session.store.getState();
    const baseVersion = s.scenarioId === c.scenarioId && s.version !== null ? s.version : version;
    if (baseVersion === undefined) {
      return Promise.reject(new Error(`no version of scenario ${c.scenarioId} yet`));
    }
    return c.session.settleCommit(
      client.changesetApply({
        params: { tenant: c.tenant },
        body: { scenarioId: c.scenarioId, baseVersion, changes: [change] },
      }),
    );
  };
}

interface Common {
  member: string;
  anchor: HTMLElement | null | undefined;
  onClose: () => void;
}

/** Input: the definition `useVariable` returns; edits preview and commit, Reset clears the cell. */
function InputPopover({ variable, member, anchor, onClose }: Common & { variable: string }) {
  const v = useVariable(variable, member);
  const [committed, setCommitted] = useState(false);
  const warnings = useWarnings(v.cell, committed);
  const d = v.definition;
  if (!d) return null;
  const value = num(v.value);
  const parse = parseFor(d.unit, d.percentScale);
  return (
    <EditPopover
      mode="input"
      label={labelOf(d.label, member)}
      unit={d.unit}
      // no registry range: the slider sits on the value; the field still takes any number
      min={d.min ?? value}
      max={d.max ?? value}
      step={d.step ?? NO_STEP}
      source={d.source}
      confidence={d.confidence}
      defaultValue={num(d.default)}
      warnings={warnings}
      value={value}
      format={formatFor(undefined, d.unit, d.step, d.percentScale)}
      {...(parse ? { parse } : {})}
      onChange={(next) => {
        v.preview(next);
        setCommitted(true);
        void v.commit(next).catch(ignore);
      }}
      onReset={() => void v.commit(null).catch(ignore)}
      onClose={onClose}
      anchor={anchor}
    />
  );
}

/**
 * Output: the node's pushed value; "Pin with reason" posts an `override` change (the typed value,
 * the reason as its note). Reset removes the scenario's pin when there is one.
 */
function OutputPopover({ node, member, anchor, onClose }: Common & { node: string }) {
  const ctx = useBindContext();
  const bound = useNode(node, member);
  const inputs = useInputs(ctx.tenant, ctx.scenarioId);
  const send = useSend();
  const [draft, setDraft] = useState<number | null>(null);
  const [committed, setCommitted] = useState(false);
  const warnings = useWarnings(bound.cell, committed);
  const pin = inputs.data?.overrides.find((o) => o.node === node && o.member === member);
  const def = bound.def;
  if (!def || !def.overridable) return null;

  const value = draft ?? num(bound.value);
  const override = (v: number | null, note?: string): Change => ({
    target: 'override',
    key: node as NodeKey,
    member: member as MemberKey,
    value: v,
    ...(note !== undefined ? { note } : {}),
  });
  const parse = parseFor(def.unit, def.percentScale);
  return (
    <EditPopover
      mode="output"
      label={labelOf(def.label, member)}
      unit={def.unit}
      min={value}
      max={value}
      step={NO_STEP}
      source={OUTPUT_SOURCE}
      confidence={EM_DASH}
      defaultValue={Number.NaN}
      warnings={warnings}
      value={value}
      format={formatFor(undefined, def.unit, undefined, def.percentScale)}
      {...(parse ? { parse } : {})}
      onChange={setDraft}
      onPin={({ value: v, reason }) => {
        setCommitted(true);
        void send(override(v, reason)).catch(ignore);
      }}
      {...(pin ? { pinReason: pin.reason } : {})}
      onReset={() => {
        if (pin) void send(override(null)).catch(ignore);
        setDraft(null);
      }}
      onClose={onClose}
      anchor={anchor}
    />
  );
}

/** The edit popover for a controller target, portalled to `<body>` (above every module). */
export function BoundEditPopover({
  target,
  onClose,
}: {
  target: PopoverTarget;
  onClose: () => void;
}) {
  const member = target.member ?? '';
  const id = target.kind === 'input' ? target.variable : target.node;
  const el =
    target.kind === 'input' ? (
      <InputPopover
        key={toCellKey(id, member)}
        variable={id}
        member={member}
        anchor={target.anchor}
        onClose={onClose}
      />
    ) : (
      <OutputPopover
        key={toCellKey(id, member)}
        node={id}
        member={member}
        anchor={target.anchor}
        onClose={onClose}
      />
    );
  return typeof document === 'undefined' ? null : createPortal(el, document.body);
}
