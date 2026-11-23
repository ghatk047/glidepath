import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Grid } from '@glidepath/ui/glass';
import { useBindContext } from '../../bind';
import {
  dataKeys,
  useApiClient,
  useBundle,
  useScenarios,
  useServerState,
  useTenants,
} from '../../data';
import { presetLetter, useShellNavigation, useToast } from '../../global/shell';
import { JobsProvider, solverRunCanceller } from '../../jobs';
import { BLEND_PAIR, COPY, cy } from './copy';
import { GoalPanel, usePathChoice } from './GoalPanel';
import { blendSpec, pathSpec, type PathChoice } from './params';
import { ResultPanel } from './ResultPanel';
import { PathStyles } from './styles';
import { terminal, useSolverRun } from './useSolverRun';

/**
 * Path · "Find a path" (MOD-06; 03_screens, solver-*-1440 renders): Goal (4) beside Result (8).
 * The Goal panel collects the user's choices; `pathSpec` / `blendSpec` turn them into the
 * contract's solver specs; tier 2 runs them (`POST /solver-runs`, `POST /solver-runs/quick`) and
 * every number shown is its answer or a session cell. Savings vs risk, Odds and the tornado
 * follow in MOD-07.
 */
function PathScreen() {
  const { tenant, scenarioId } = useBindContext();
  const tenants = useTenants();
  const scenarios = useScenarios(tenant);
  const bundle = useBundle(tenant);
  const serverState = useServerState();
  const nav = useShellNavigation();
  const toast = useToast();
  const choice = usePathChoice();
  const runner = useSolverRun(tenant, scenarioId);
  const saver = useSolverRun(tenant, scenarioId);

  const row = tenants.data?.tenants.find((t) => t.slug === tenant);
  const list = scenarios.data?.scenarios ?? [];
  const nameOf = (s: (typeof list)[number]) =>
    s.kind === 'preset' ? presetLetter(s.key) : s.label;
  const current = list.find((s) => s.id === scenarioId);
  const from = current ? nameOf(current) : COPY.result;
  const preset = (key: string) => list.find((s) => s.kind === 'preset' && s.key === key);
  const blendFrom = preset(BLEND_PAIR.from);
  const blendTo = preset(BLEND_PAIR.to);
  const blendNames = blendFrom && blendTo ? { from: nameOf(blendFrom), to: nameOf(blendTo) } : null;

  const find = useCallback(
    (c: PathChoice) => void runner.start({ quick: false, spec: pathSpec(c) }),
    [runner],
  );
  const runBlend = () => {
    if (blendFrom && blendTo)
      void runner.start({ quick: true, spec: blendSpec(blendFrom.id, blendTo.id) });
  };
  // Save as scenario: the same question again with `save: true`; tier 2 answers it from its
  // `(problem, params, inputHash)` cache and writes the scenario (`kind = solver`).
  const save = () => {
    if (runner.ask) void saver.start(runner.ask, { save: true });
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

  const saveError =
    saver.error ??
    (saver.run && terminal(saver.run.status) && saver.run.status !== 'done'
      ? (saver.run.error?.detail ?? COPY.failed)
      : null);

  return (
    <main className="gp-module gp-path" aria-label={COPY.module}>
      <PathStyles />
      <Grid data-testid="path-grid">
        <GoalPanel
          state={choice}
          year={row ? cy(row.targetYear) : null}
          blendLabel={blendNames ? COPY.blendAction(blendNames.from, blendNames.to) : null}
          finding={runner.busy}
          blending={runner.busy}
          onFind={find}
          onBlend={runBlend}
        />
        <ResultPanel
          run={runner.run}
          jobId={runner.jobId}
          busy={runner.busy}
          error={runner.error}
          from={from}
          pair={blendNames}
          variables={bundle.data?.variables}
          onFind={() => {
            if (choice.choice) find(choice.choice);
          }}
          onSave={save}
          saving={saver.busy}
          saveError={saveError}
        />
      </Grid>
    </main>
  );
}

export default function Path() {
  const { tenant, session } = useBindContext();
  const api = useApiClient();
  const cancel = useMemo(() => solverRunCanceller(api, tenant), [api, tenant]);
  return (
    <JobsProvider session={session} cancel={cancel}>
      <PathScreen />
    </JobsProvider>
  );
}
