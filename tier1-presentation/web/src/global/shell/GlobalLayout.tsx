import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';
import {
  toCellKey,
  ApiError,
  type ChangesetResult,
  type ScenarioId,
  type ServerMessage,
  type TenantSlug,
} from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { Aurora, GlassProvider, Skeleton, type GlassProviderProps } from '@glidepath/ui/glass';
import { EditsTray } from '@glidepath/ui/overlays/palette';
import { Rail, ScenarioBar, type TenantStatus } from '@glidepath/ui/shell';
import { themeNames, type ThemeName } from '@glidepath/ui/tokens';
import type { ModuleId } from '../../app/modules';
import { useViewStore } from '../../app/view-store';
import { useRouter } from '@tanstack/react-router';
import { BindProvider } from '../../bind';
import { CommitProvider, useCommit, useCommitState, useForkNavigation } from '../../commit';
import {
  dataKeys,
  useApiClient,
  useBundle,
  useCalc,
  useChangesetInvalidation,
  useHistory,
  useMe,
  useScenarios,
  useServerState,
  useTenants,
  type ServerMessageSource,
} from '../../data';
import type { SessionClient } from '../../session';
import { TourButton, TourHost, tourStore } from '../tour';
import { editChanges } from './changes';
import { Icon, MODULE_COPY, TOOL_ICONS, railItems } from './modules';
import { useShellNavigation } from './navigation';
import { scenarioBarModel } from './scenarios';
import { StateChips, type ShellState } from './StateChips';
import { BoundFlightStrip, HUD_NODES } from './BoundFlightStrip';
import { layoutCss } from './styles';
import { ToastProvider, useToast } from './toast';

/** The session parts the global layer uses (`createSessionClient()` satisfies it). */
export type ShellSession = Pick<
  SessionClient,
  'store' | 'subscribe' | 'subscribeView' | 'preview' | 'settleCommit' | 'open'
>;

export interface GlobalLayoutProps {
  /** The URL's tenant, scenario and module (`/:tenant/:scenario/:module`). */
  tenant: TenantSlug;
  scenarioId: ScenarioId;
  module: ModuleId;
  /** The screen's one session client (WEB-03), created for the tenant. */
  session: ShellSession;
  /** Opens the trace drawer for a cell (WEB-07). */
  onTrace?: ((cell: string) => void) | undefined;
  /** Passed to `GlassProvider` (frame sampling off in tests). */
  glass?: Pick<GlassProviderProps, 'frameSampling' | 'forceLow'>;
  /** The module screen. */
  children?: ReactNode;
}

/**
 * Global layer I (IA §2, §6; inventory Shell): rail, scenario bar, edits counter and changeset
 * tray, theme, flight strip, toast and the screen-state chips, around the module screen. Mounts
 * the commit queue (`CommitProvider`) and the bindings (`BindProvider commit={useCommit().commit}`)
 * for everything below it. Every value comes from tier 2; this layer only sends intent.
 * Needs `DataProvider` and the router above it.
 */
export function GlobalLayout(props: GlobalLayoutProps) {
  const { tenant, scenarioId, session, glass } = props;
  const onFork = useForkNavigation();
  return (
    <GlassProvider {...glass}>
      <style href="glidepath-shell-layout" precedence="glidepath">
        {layoutCss}
      </style>
      <Aurora />
      <ToastProvider>
        <CommitProvider tenant={tenant} scenarioId={scenarioId} session={session} onFork={onFork}>
          <ShellBody {...props} />
        </CommitProvider>
      </ToastProvider>
    </GlassProvider>
  );
}

const NET_CELL = toCellKey(HUD_NODES.net, '');

const THEME_LABEL: Readonly<Record<ThemeName, string>> = { cruise: 'Cruise', daylight: 'Daylight' };

/** Two-digit calendar year label (`2027` → `CY27`). Text only. */
const cy = (year: number) => `CY${String(year).slice(-2)}`;

const detailOf = (e: unknown): string =>
  e instanceof ApiError ? e.problem.detail : e instanceof Error ? e.message : String(e);

function ShellBody({ tenant, scenarioId, module, session, onTrace, children }: GlobalLayoutProps) {
  const queue = useCommit();
  const nav = useShellNavigation();
  const toast = useToast();
  const api = useApiClient();
  const serverState = useServerState();

  // ---- presenter deep link `?tour=<chapter|stepId>`: opens the walkthrough there, once.
  // Read raw from the router location (the module route's own search parser drops unknown keys).
  const router = useRouter();
  const tourLink = useRef(false);
  useEffect(() => {
    if (tourLink.current) return;
    tourLink.current = true;
    const target = new URLSearchParams(router.state.location.searchStr ?? '').get('tour');
    if (target) tourStore.getState().startAt(target);
  }, [router]);

  // ---- server state (tier 2's answers, as sent)
  const tenants = useTenants();
  const scenarios = useScenarios(tenant);
  const bundle = useBundle(tenant);
  const me = useMe();
  const calc = useCalc(tenant, scenarioId);
  const history = useHistory(tenant, scenarioId);
  const tenantRow = tenants.data?.tenants.find((t) => t.slug === tenant);
  const list = useMemo(() => scenarios.data?.scenarios ?? [], [scenarios.data]);
  const current = list.find((s) => s.id === scenarioId);
  const bar = useMemo(() => scenarioBarModel(list, scenarioId), [list, scenarioId]);

  // ---- session: switch on a scenario change (a fork is followed by the session itself)
  const shown = useRef(scenarioId);
  useEffect(() => {
    if (shown.current === scenarioId) return;
    shown.current = scenarioId;
    const s = session.store.getState();
    if (s.scenarioId !== scenarioId && s.opening !== scenarioId) session.open(scenarioId);
  }, [session, scenarioId]);
  const status = useStore(session.store, (s) => s.status);
  const sessionError = useStore(session.store, (s) => s.lastError);

  // `changeset` messages (anyone's commit) refetch the list, history, calc and inputs
  const source = useMemo<ServerMessageSource>(
    () => (listener) =>
      session.store.subscribe((s, prev) => {
        if (s.changeset && s.changeset !== prev.changeset) listener(s.changeset as ServerMessage);
      }),
    [session],
  );
  useChangesetInvalidation(tenant, source);

  // ---- commit queue: edits count, undo / redo, errors, toast after each answer
  const commitScenario = useCommitState((s) => s.scenarioId);
  const commitCount = useCommitState((s) => s.editsCount);
  const canUndo = useCommitState((s) => s.canUndo);
  const canRedo = useCommitState((s) => s.canRedo);
  const commitError = useCommitState((s) => s.error);
  const warnings = useCommitState((s) => s.warnings);
  const count = (commitScenario === scenarioId ? commitCount : null) ?? current?.editsCount ?? 0;

  const cause = useRef<string | null>(null);
  useEffect(
    () =>
      queue.store.subscribe((s, prev) => {
        const r: ChangesetResult | null = s.lastResult;
        if (!r || r === prev.lastResult) return;
        const what = cause.current ?? 'Change saved';
        cause.current = null;
        const net = r.outputs[NET_CELL];
        toast(net === undefined ? what : `${what} · net ${fmt.money(net)}`);
        void serverState.invalidate(dataKeys.history(tenant, r.scenarioId));
      }),
    [queue, toast, serverState, tenant],
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const run = (job: () => Promise<unknown>) => {
    setActionError(null);
    job().catch((e: unknown) => setActionError(detailOf(e)));
  };
  const undo = () =>
    run(async () => {
      cause.current = 'Undone';
      if ((await queue.undo()) === null) cause.current = null;
    });
  const redo = () =>
    run(async () => {
      cause.current = 'Redone';
      if ((await queue.redo()) === null) cause.current = null;
    });
  const saveAs = () =>
    run(async () => {
      await queue.flush();
      const created = await api.scenarioCreate({
        params: { tenant },
        body: { mode: 'copy', from: scenarioId },
      });
      await serverState.invalidate(dataKeys.scenarios(tenant), { exact: true });
      nav.toScenario(created.id);
      toast(`Saved as ${created.label}`);
    });
  const discard = () =>
    run(async () => {
      await queue.flush();
      if (!current || current.kind === 'preset') return;
      await api.scenarioPatch({
        params: { tenant, id: scenarioId },
        body: { archived: true },
      });
      await serverState.invalidate(dataKeys.scenarios(tenant), { exact: true });
      const back = current.parentId ?? bar.scenarios[0]?.id;
      if (back) nav.toScenario(back, { replace: true });
      toast('Edits discarded');
    });

  const changes = useMemo(
    () =>
      editChanges(history.data?.pages, {
        bundle: bundle.data,
        me: me.data?.user.id,
      }),
    [history.data, bundle.data, me.data],
  );

  // ---- theme and panels (view store)
  const theme = useViewStore((s) => s.theme);
  const toggleTheme = useViewStore((s) => s.toggleTheme);
  const openPanel = useViewStore((s) => s.openPanel);
  const nextTheme = themeNames[(themeNames.indexOf(theme) + 1) % themeNames.length]!;

  // ---- screen states (IA §6)
  const states: ShellState[] = [];
  const errors = [
    commitError ? { detail: commitError.detail, onDismiss: () => queue.clearError() } : null,
    actionError ? { detail: actionError, onDismiss: () => setActionError(null) } : null,
    sessionError ? { detail: sessionError.detail } : null,
    scenarios.isError ? { detail: detailOf(scenarios.error) } : null,
  ];
  for (const e of errors) if (e) states.push({ kind: 'error', ...e });
  for (const w of warnings)
    states.push({ kind: w.severity === 'error' ? 'error' : 'warning', detail: w.message });
  if (status === 'reconnecting') states.push({ kind: 'reconnecting' });
  if (calc.data?.stale) states.push({ kind: 'stale' });

  const tenantStatus: TenantStatus =
    tenantRow?.status === 'archived' ? 'unavailable' : tenants.isLoading ? 'switching' : 'ready';
  const onRail = (id: string, e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    nav.toModule(id as ModuleId);
  };

  return (
    <BindProvider
      tenant={tenant}
      scenarioId={scenarioId}
      session={session}
      commit={queue.commit}
      onTrace={onTrace}
    >
      <div className="gp-app" data-module={module}>
        <Rail
          items={railItems(tenant, scenarioId)}
          current={module}
          tenantCode={tenant}
          tenantName={tenantRow?.name}
          tenantStatus={tenantStatus}
          onTenant={() => nav.toModule('airlines')}
          onSelect={onRail}
        />
        <div className="gp-main">
          <header className="gp-topbar">
            <div className="gp-topbar-title">
              {tenantRow ? (
                <span className="gp-eyebrow">
                  {`${tenantRow.name} · ${cy(tenantRow.targetYear)} vs ${cy(tenantRow.baseYear)}`}
                </span>
              ) : (
                <Skeleton size="label" width="40%" />
              )}
              <h1>{MODULE_COPY[module].title}</h1>
            </div>
            <div className="gp-tools">
              <StateChips states={states} />
              {scenarios.data ? (
                <ScenarioBar
                  scenarios={bar.scenarios}
                  customs={bar.customs}
                  paths={bar.paths}
                  current={scenarioId}
                  onSelect={(id) => nav.toScenario(id)}
                />
              ) : (
                <span className="gp-bar-skeleton" aria-busy="true" aria-label="Scenarios">
                  <Skeleton size="block" width="100%" />
                </span>
              )}
              <EditsTray
                count={count}
                changes={changes}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onSaveAsScenario={saveAs}
                onDiscard={discard}
                title={current ? `Changeset · ${current.label}` : 'Changeset'}
              />
              <TourButton />
              <button
                type="button"
                className="gp-search"
                aria-keyshortcuts="Meta+K Control+K"
                onClick={() => openPanel('commandPalette')}
              >
                <Icon paths={TOOL_ICONS.search} />
                <span>Find any number</span>
                <span className="gp-kbd" aria-hidden="true">
                  ⌘K
                </span>
              </button>
              <button
                type="button"
                className="gp-iconbtn"
                title="Switch light / dark"
                aria-label={`Theme ${THEME_LABEL[theme]}: switch to ${THEME_LABEL[nextTheme]}`}
                data-theme-toggle={theme}
                onClick={toggleTheme}
              >
                <Icon paths={TOOL_ICONS.sun} />
              </button>
            </div>
          </header>
          <div className="gp-content">{children}</div>
        </div>
      </div>
      <BoundFlightStrip hidden={module === 'cockpit'} />
      <TourHost module={module} />
    </BindProvider>
  );
}
