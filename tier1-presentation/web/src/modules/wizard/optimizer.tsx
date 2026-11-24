import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { RankedMove, SolverObjective, SolverResult, SolverRun } from '@glidepath/api-contract';
import { useBindContext } from '../../bind';
import { dataKeys, useServerState } from '../../data';
import { useShellNavigation, useToast } from '../../global/shell';
import { DEFAULT_OBJECTIVE } from '../path/copy';
import { pathSpec } from '../path/params';
import { terminal, useSolverRun } from '../path/useSolverRun';
import { COPY } from './copyResult';
import { wizardStore } from './store';

export interface WizardOptimizer {
  objective: SolverObjective;
  setObjective(objective: SolverObjective): void;
  perVp: boolean;
  setPerVp(on: boolean): void;
  /** A run is starting or running. */
  busy: boolean;
  /** Active job id (for JobHeader); null before the first job message and after the end. */
  jobId: string | null;
  /** The run on the current scenario as tier 2 last reported it. */
  run: SolverRun | null;
  /** Result of the last finished run; kept across `apply()`'s scenario switch. */
  result: SolverResult | null;
  /** `result.ranked`, tier 2's order; kept across `apply()`. */
  moves: readonly RankedMove[];
  /** Variable ids (cell key without `[member]`) of `moves`, for accent dots. */
  moved: ReadonlySet<string>;
  error: string | null;
  find(): void;
  applying: boolean;
  apply(): void;
  discard(): void;
}

const INERT: WizardOptimizer = {
  objective: 'min_risk_exposure',
  setObjective: () => undefined,
  perVp: false,
  setPerVp: () => undefined,
  busy: false,
  jobId: null,
  run: null,
  result: null,
  moves: [],
  moved: new Set(),
  error: null,
  find: () => undefined,
  applying: false,
  apply: () => undefined,
  discard: () => undefined,
};

const NO_MOVES: readonly RankedMove[] = [];
const NO_MOVED: ReadonlySet<string> = new Set();

const OptimizerContext = createContext<WizardOptimizer>(INERT);

const idOf = (cell: string): string => /^(.*)\[.*\]$/.exec(cell)?.[1] ?? cell;

interface Kept {
  result: SolverResult;
  moves: readonly RankedMove[];
  moved: ReadonlySet<string>;
}

/**
 * The optimizer of the wizard (07_wizard_tour_plan §3.6). "Find a path" asks tier 2's existing
 * `min_risk_mix` solver (`pathSpec`, the Path module's request) on the current scenario and takes
 * the wizard to step 4. "Use this path" asks the same question again with `save: true` (tier 2
 * answers from its run cache and writes the `solver` scenario), then switches to it. The result,
 * moves and moved variable ids are kept across the switch so steps 2 and 3 can mark what moved.
 * Needs a `JobsProvider` above it.
 */
export function OptimizerProvider({ children }: { children: ReactNode }) {
  const { tenant, scenarioId } = useBindContext();
  const serverState = useServerState();
  const nav = useShellNavigation();
  const toast = useToast();
  const runner = useSolverRun(tenant, scenarioId);
  const saver = useSolverRun(tenant, scenarioId);
  const [objective, setObjective] = useState<SolverObjective>(DEFAULT_OBJECTIVE);
  const [perVp, setPerVp] = useState(false);
  const [kept, setKept] = useState<Kept | null>(null);
  const [switching, setSwitching] = useState(false);
  const dropped = useRef<string | null>(null);
  const taken = useRef<string | null>(null);

  const run = runner.run;
  // Keep the finished Path run's result; it outlives the scenario switch (the runner is per scenario).
  useEffect(() => {
    if (!run || run.status !== 'done' || !run.result) return;
    if (run.result.problem !== 'min_risk_mix' || dropped.current === run.id) return;
    const result = run.result;
    setKept((k) =>
      k?.result === result
        ? k
        : {
            result,
            moves: result.ranked,
            moved: new Set(result.ranked.map((m) => idOf(m.cell))),
          },
    );
  }, [run]);

  const find = useCallback(() => {
    wizardStore.getState().setStep(4);
    if (run) dropped.current = run.id;
    setKept(null);
    void runner.start({
      quick: false,
      spec: pathSpec({ objective, perVp, usFloor: null, oneTimeCap: null, gccHiring: null }),
    });
  }, [runner, run, objective, perVp]);

  const apply = useCallback(() => {
    if (runner.ask) void saver.start(runner.ask, { save: true });
  }, [runner.ask, saver]);

  const discard = useCallback(() => {
    if (run) dropped.current = run.id;
    setKept(null);
  }, [run]);

  const saved = saver.run;
  useEffect(() => {
    if (!saved || saved.status !== 'done' || !saved.resultScenarioId) return;
    if (taken.current === saved.id) return;
    taken.current = saved.id;
    const id = saved.resultScenarioId;
    setSwitching(true);
    void serverState
      .invalidate(dataKeys.scenarios(tenant), { exact: true })
      .then(() => {
        toast(COPY.applied);
        nav.toScenario(id);
      })
      .finally(() => setSwitching(false));
  }, [saved, serverState, tenant, toast, nav]);

  const failure = (r: SolverRun | null) =>
    r && terminal(r.status) && r.status !== 'done' ? (r.error?.detail ?? COPY.failed) : null;
  const error = runner.error ?? failure(runner.run) ?? saver.error ?? failure(saver.run);

  const value = useMemo<WizardOptimizer>(
    () => ({
      objective,
      setObjective,
      perVp,
      setPerVp,
      busy: runner.busy,
      jobId: runner.jobId,
      run,
      result: kept?.result ?? null,
      moves: kept?.moves ?? NO_MOVES,
      moved: kept?.moved ?? NO_MOVED,
      error,
      find,
      applying: saver.busy || switching,
      apply,
      discard,
    }),
    [objective, perVp, runner.busy, runner.jobId, run, kept, error, find, saver.busy, switching, apply, discard],
  );
  return <OptimizerContext value={value}>{children}</OptimizerContext>;
}

export const useWizardOptimizer = (): WizardOptimizer => useContext(OptimizerContext);
