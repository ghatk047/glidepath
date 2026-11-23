import { useCallback, useMemo, useRef } from 'react';
import type {
  Change,
  ChangesetResult,
  Confidence,
  MemberKey,
  ResolvedFrom,
  VariableDef,
  VariableKind,
  VarKey,
} from '@glidepath/api-contract';
import { useApiClient, useBundle, useInputs } from '../data';
import { useBindContext, type CommitChange } from './context';
import { useCell } from './useNode';

/** What the edit controls show about a variable; every field is what tier 2 sent. */
export interface VariableDefinition {
  readonly label: string;
  readonly unit: string;
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
  readonly kind: VariableKind;
  /** Registry source (`levers`, `spec`, ...). */
  readonly source: string;
  /** The scenario's own confidence for the cell when it has one, else the registry's. */
  readonly confidence: Confidence;
  /**
   * Tenant default of the cell. The bundle carries no default, so this is the resolved value when
   * tier 2 says it comes from the tenant layer (`from: 'tenant'`); `null` when not known.
   */
  readonly default: number | null;
}

export interface BoundVariable {
  readonly id: string;
  readonly member: string;
  readonly cell: string;
  /** The registry definition as the bundle sent it; `undefined` while loading or unknown id. */
  readonly def: VariableDef | undefined;
  readonly definition: VariableDefinition | undefined;
  /**
   * Current value: the session's cell (follows previews and commits), else the scenario's
   * resolved input. `null` = no layer sets it; `undefined` = not loaded yet.
   */
  readonly value: number | null | undefined;
  /** Layer the resolved value comes from. */
  readonly from: ResolvedFrom | null | undefined;
  readonly stale: boolean;
  /** Try `v` while dragging (session `preview`, throttled there). */
  preview(v: number): void;
  /** Write `v` (`null` clears the scenario's own value so it inherits again). */
  commit(v: number | null, note?: string): Promise<ChangesetResult>;
}

/**
 * `useVariable(id, member?)`: the bundle's definition, the current value and the two intents.
 * Nothing is computed: min, max, step, kind, source and confidence come from tier 2 as sent.
 */
export function useVariable(id: string, member = ''): BoundVariable {
  const ctx = useBindContext();
  const { tenant, scenarioId, session } = ctx;
  const cell = useCell(id, member);
  const bundle = useBundle(tenant);
  const inputs = useInputs(tenant, scenarioId);
  const client = useApiClient();

  const def = useMemo(() => bundle.data?.variables.find((v) => v.id === id), [bundle.data, id]);
  const resolved = useMemo(
    () => inputs.data?.inputs.find((i) => i.var === id && i.member === member),
    [inputs.data, id, member],
  );

  const definition = useMemo<VariableDefinition | undefined>(
    () =>
      def && {
        label: def.label,
        unit: def.unit,
        min: def.min,
        max: def.max,
        step: def.step,
        kind: def.kind,
        source: def.source,
        confidence: resolved?.confidence ?? def.confidence,
        default: resolved?.from === 'tenant' ? resolved.value : null,
      },
    [def, resolved],
  );

  // Read at call time, so a commit right after a new version arrives uses that version.
  const latest = useRef({ inputsVersion: inputs.data?.version, ctx });
  latest.current = { inputsVersion: inputs.data?.version, ctx };

  const directCommit = useCallback<CommitChange>(
    (change) => {
      const { ctx: c, inputsVersion } = latest.current;
      const state = c.session.store.getState();
      const baseVersion =
        state.scenarioId === c.scenarioId && state.version !== null ? state.version : inputsVersion;
      if (baseVersion === undefined) {
        return Promise.reject(new Error(`no version of scenario ${c.scenarioId} yet`));
      }
      return c.session.settleCommit(
        client.changesetApply({
          params: { tenant: c.tenant },
          body: { scenarioId: c.scenarioId, baseVersion, changes: [change] },
        }),
      );
    },
    [client],
  );

  const preview = useCallback((v: number) => session.preview(id, member, v), [session, id, member]);
  const commit = useCallback(
    (v: number | null, note?: string) => {
      const send = latest.current.ctx.commit ?? directCommit;
      const change: Change = {
        target: 'variable',
        key: id as VarKey,
        member: member as MemberKey,
        value: v,
        ...(note !== undefined ? { note } : {}),
      };
      return send(change);
    },
    [directCommit, id, member],
  );

  return {
    id,
    member,
    cell: cell.cell,
    def,
    definition,
    value: cell.value !== undefined ? cell.value : resolved?.value,
    from: resolved?.from,
    stale: cell.stale,
    preview,
    commit,
  };
}
