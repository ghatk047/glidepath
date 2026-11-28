import { useCallback, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import { type Change, type MemberKey, type VarKey, type Violation } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { vpColour } from '@glidepath/ui/charts/gauge';
import { GlassPanel, Skeleton } from '@glidepath/ui/glass';
import { OwnershipBar, type OwnershipShare } from '@glidepath/ui/inputs/ownership';
import { useBindContext, useView } from '../../bind';
import { useCommitState } from '../../commit';
import type { SessionClient } from '../../session';
import { GlowText, useCells } from './Bound';
import type { VpMember } from './VpCard';

const VAR = 'org.dom_share';
const cellOf = (domain: string, vp: string) => `${domain},${vp}`;

type Message = Violation;

/** Rule results in tier 2's words: the session's latest (preview or commit), else the last commit's. */
export function useRuleMessages(): readonly Message[] {
  const { session } = useBindContext();
  const live = useStore(session.store, (s) => s.warnings?.violations);
  const committed = useCommitState((s) => s.warnings);
  return live ?? committed ?? [];
}

export function Warnings({ messages }: { messages: readonly Message[] }) {
  const error = messages.some((m) => m.severity === 'error');
  return (
    <div className="gp-vps-warns" role={error ? 'alert' : 'status'}>
      {messages.map((m, i) => (
        <p
          key={`${m.rule}-${i}`}
          className="gp-vps-warn"
          data-severity={m.severity}
          data-rule={m.rule}
        >
          {m.message}
        </p>
      ))}
    </div>
  );
}

function DomainRow({
  domain,
  vps,
  outlay,
  step,
  messages,
}: {
  domain: { key: string; label: string };
  vps: readonly VpMember[];
  outlay: number;
  step: number | undefined;
  messages: readonly Message[];
}) {
  const ctx = useBindContext();
  const values = useCells(
    VAR,
    vps.map((v) => cellOf(domain.key, v.key)),
  );
  const known = values.every((v) => typeof v === 'number');
  const shares: OwnershipShare[] = vps.map((v, i) => ({
    vp: v.key,
    label: v.label,
    share: typeof values[i] === 'number' ? (values[i] as number) : 0,
  }));

  // One preview frame carries every VP's share of the row (atomic on tier 2's scratch copy).
  const preview = useCallback(
    (_: string, next: readonly OwnershipShare[]) => {
      const full = ctx.session as Partial<Pick<SessionClient, 'previewChanges'>>;
      const changes = next.map((s) => ({
        var: VAR,
        member: cellOf(domain.key, s.vp),
        value: s.share,
      }));
      if (full.previewChanges) full.previewChanges(changes);
      else for (const c of changes) ctx.session.preview(c.var, c.member, c.value);
    },
    [ctx.session, domain.key],
  );
  const commit = useCallback(
    (_: string, next: readonly OwnershipShare[]) => {
      if (!ctx.commit) return;
      for (const s of next) {
        const change: Change = {
          target: 'variable',
          key: VAR as VarKey,
          member: cellOf(domain.key, s.vp) as MemberKey,
          value: s.share,
        };
        void ctx.commit(change).catch(() => undefined);
      }
    },
    [ctx, domain.key],
  );

  return (
    <li className="gp-vps-row" data-domain={domain.key}>
      <span className="gp-vps-row-name" title={domain.label}>
        {domain.label}
      </span>
      <span className="gp-vps-row-outlay">
        <GlowText value={outlay}>{fmt.money(outlay)}</GlowText>
      </span>
      {known ? (
        <OwnershipBar
          domainId={domain.key}
          label={domain.label}
          shares={shares}
          step={step}
          violations={messages}
          onPreview={preview}
          onCommit={commit}
        />
      ) : (
        <Skeleton />
      )}
    </li>
  );
}

/** "Who owns what": one draggable ownership bar per domain; drag previews, release commits. */
export function OwnershipPanel({
  vps,
  domains,
  step,
}: {
  vps: readonly VpMember[];
  domains: readonly { key: string; label: string }[];
  step: number | undefined;
}) {
  const view = useView('vps.domain_outlay', {});
  const messages = useRuleMessages();
  const outlay = new Map<string, number>(
    (view.payload?.domains ?? []).map((d) => [d.key, d.value]),
  );
  // Rows are the domains tier 2's view reports an outlay for (the memo domain has none).
  const rows = domains.filter((d) => outlay.has(d.key));
  const forRow = (key: string) =>
    messages.filter((m) => m.cells.some((c) => c.startsWith(`${VAR}[${key},`)));
  const unplaced = messages.filter(
    (m) => m.rule === 'VR01' && !rows.some((r) => forRow(r.key).includes(m)),
  );

  return (
    <GlassPanel
      level={1}
      span={7}
      className="gp-vps-own"
      header={{
        label: 'Who owns what · drag to reassign',
        status: (
          <span className="gp-vps-legend">
            {vps.map((v, i) => (
              <span key={v.key} style={{ '--vp-colour': vpColour(i) } as CSSProperties}>
                <i className="gp-vps-dot" aria-hidden="true" />
                {v.label}
              </span>
            ))}
          </span>
        ),
      }}
      loading={view.isLoading || vps.length === 0}
    >
      <Warnings messages={unplaced} />
      <ul className="gp-vps-rows">
        {rows.map((d) => (
          <DomainRow
            key={d.key}
            domain={d}
            vps={vps}
            outlay={outlay.get(d.key)!}
            step={step}
            messages={forRow(d.key)}
          />
        ))}
      </ul>
    </GlassPanel>
  );
}
