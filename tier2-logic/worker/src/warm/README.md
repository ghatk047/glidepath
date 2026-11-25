# JOB-04: demo cache warmer (`src/warm`)

`pnpm warm --tenant aa` pre-runs the solver jobs the demo storyline asks for ("Before the day": odds appear instantly; 09 section 4: min-risk is cached) and files each result under the JOB-02 cache key, so the API answers them from `solver_run` without queuing a job.

Jobs (`WARM_JOBS`, parameters left to tier 2's defaults): `monte_carlo` from presets C and D, `min_risk_mix` and `vp_feasible` from C. Each runs through the worker's own handlers (`runJob` + `registerSolverHandlers`), with `save: false` so no scenario is added to the demo tenant. The key is `(problem, params hash, inputHash)` with `inputHash` from the start scenario's latest `calc_run` (what the API's `latestCalcInputHash` reads), stored in `solver_run.spec.cache`. A job whose key already has a `done` run is a hit and is not run again: a second warm is all hits. A job that fails is reported (exit code 1) and the others still run; a preset without a `calc_run` is skipped.

`migrate` runs the same step after the seed when `WARM=1` (demo profile; `seed/args.ts`, `seed/run.ts`). `pnpm warm` reads `DATABASE_URL` (app role) and `SPEC_DIR`.

`cache-key.ts` repeats the few lines that define the key (the worker does not depend on the server package); `warm.pg.test.ts` compares them with the server's `cacheKeyOf` / `paramsHash` and drives `createSolverSubmitter` to prove the hit path.
