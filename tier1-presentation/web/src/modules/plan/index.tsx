import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DimKey } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import { dataKeys, useApiClient, useBundle, useMembers, useServerState } from '../../data';
import { useShellNavigation, useToast } from '../../global/shell';
import { JobsProvider, solverRunCanceller } from '../../jobs';
import { terminal, useSolverRun } from '../path/useSolverRun';
import { sourcingCss } from '../sourcing/styles';
import { BreakevenPanel } from './BreakevenPanel';
import { BusinessCasePanel } from './BusinessCasePanel';
import { COPY, STRESS_PRESETS, breakevenSpec, stressSpec, waveSpec } from './copy';
import { StressPanel } from './StressPanel';
import { planCss } from './styles';
import { usePlanReads } from './usePlanReads';
import { usePlanRun } from './usePlanRun';
import { WavePanel } from './WavePanel';

/** Panels of the Plan screen, in reading order (features F1, F3, F9, F10 of docs/backlog/SRC.md). */
const PANELS = [
  { id: 'breakeven', label: COPY.breakeven },
  { id: 'stress', label: COPY.stress },
  { id: 'business-case', label: COPY.businessCase },
  { id: 'waves', label: COPY.waves },
] as const;

/** The lever dimension (spec id). */
const LEVER_DIM = 'lever' as DimKey;

/** Look-up key of the stress run: every shock of the spec (the contract needs at least one name). */
const STRESS_LOOKUP = JSON.stringify(stressSpec(STRESS_PRESETS).params);

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="gp-module" data-module="plan" aria-label={COPY.module}>
      <style href="glidepath-sourcing" precedence="glidepath">
        {sourcingCss}
      </style>
      <style href="glidepath-plan" precedence="glidepath">
        {planCss}
      </style>
      <div className="gp-src gp-plan" data-testid="plan-grid">
        {children}
      </div>
    </main>
  );
}

/** The four panels in their loading state: before the app's providers are there (a bare mount). */
function Skeletons() {
  return (
    <Frame>
      {PANELS.map((p) => (
        <GlassPanel key={p.id} level={1} loading data-testid={`plan-${p.id}`} header={{ label: p.label }} />
      ))}
    </Frame>
  );
}

/** Renders the skeleton grid when the screen is mounted without the session and data providers. */
class NeedsProviders extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // Only a missing provider (`... need a <XProvider> above them`) falls back; anything else goes up.
    if (error instanceof Error && /need a <\w+Provider/.test(error.message)) return <Skeletons />;
    throw error;
  }
}

function Screen() {
  const { tenant, scenarioId } = useBindContext();
  const bundle = useBundle(tenant);
  const members = useMembers(tenant);
  const serverState = useServerState();
  const nav = useShellNavigation();
  const toast = useToast();
  const reads = usePlanReads(tenant, scenarioId);
  const params = reads.params.data?.params ?? [];
  const levers = members.data?.dimensions[LEVER_DIM];

  const breakeven = usePlanRun(tenant, scenarioId, {
    problem: 'breakeven',
    ask: { quick: true, spec: breakevenSpec },
  });

  const [chosen, setChosen] = useState<readonly string[]>(STRESS_PRESETS);
  const stressAsk = useMemo(() => ({ quick: true as const, spec: stressSpec(chosen) }), [chosen]);
  const stress = usePlanRun(tenant, scenarioId, {
    problem: 'stress_presets',
    ask: stressAsk,
    lookupParams: STRESS_LOOKUP,
  });
  const choose = (next: readonly string[]) => {
    setChosen(next);
    void stress.start({ quick: true, spec: stressSpec(next) });
  };

  const wave = usePlanRun(tenant, scenarioId, {
    problem: 'wave_plan',
    ask: { quick: false, spec: waveSpec },
  });
  const { reload } = reads;
  const { start: rerunWave } = wave;
  // A wave-plan cap was committed: read the parameters again and ask tier 2 for a plan under the new caps.
  const waveCommitted = useCallback(() => {
    reload();
    void rerunWave();
  }, [reload, rerunWave]);

  // Open as scenario: the run already saved one, or the same question again with `save: true` (Path's way):
  // tier 2 writes the scenario (`kind = solver`) and the screen moves to it.
  const saver = useSolverRun(tenant, scenarioId);
  const open = () => {
    const run = wave.run;
    if (!run) return;
    if (run.resultScenarioId) {
      nav.toScenario(run.resultScenarioId);
      return;
    }
    if (run.spec.problem === 'wave_plan') void saver.start({ quick: false, spec: run.spec }, { save: true });
  };
  const saved = useRef<string | null>(null);
  const savedRun = saver.run;
  useEffect(() => {
    if (!savedRun || savedRun.status !== 'done' || !savedRun.resultScenarioId) return;
    if (saved.current === savedRun.id) return;
    saved.current = savedRun.id;
    const id = savedRun.resultScenarioId;
    void serverState.invalidate(dataKeys.scenarios(tenant), { exact: true }).then(() => {
      toast(COPY.saved);
      nav.toScenario(id);
    });
  }, [savedRun, serverState, tenant, toast, nav]);
  const openError =
    saver.error ??
    (saver.run && terminal(saver.run.status) && saver.run.status !== 'done'
      ? (saver.run.error?.detail ?? COPY.failed)
      : null);

  return (
    <Frame>
      <BreakevenPanel tile={breakeven} variables={bundle.data?.variables} levers={levers} />
      <StressPanel tile={stress} nodes={bundle.data?.nodes} chosen={chosen} onChoose={choose} />
      <BusinessCasePanel read={reads.businessCase} params={params} onCommitted={reload} />
      <WavePanel
        tile={wave}
        params={params}
        levers={levers}
        onCommitted={waveCommitted}
        onOpen={open}
        opening={saver.busy}
        openError={openError}
      />
    </Frame>
  );
}

function WithJobs() {
  const { tenant, session } = useBindContext();
  const api = useApiClient();
  const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);
  return (
    <JobsProvider session={session} cancel={cancel}>
      <Screen />
    </JobsProvider>
  );
}

/**
 * Plan · "Plan & business case" (SRC-18; features F1, F3, F9, F10): breakeven by lever, stress tests, the
 * lever business case and the wave planner, each read from tier 2 (the `breakeven`, `stress_presets` and
 * `wave_plan` solver runs and `GET /plan/business-case`). The business-case and wave-plan parameters are
 * edited in place (steppers → commit queue → structural change on `sourcing_param`) and the panel reads or
 * runs again. Nothing is computed here.
 */
export default function Plan() {
  return (
    <NeedsProviders>
      <WithJobs />
    </NeedsProviders>
  );
}
