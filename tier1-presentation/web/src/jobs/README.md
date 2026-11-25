# jobs

Job progress and empty-state plumbing (WEB-08, 02 §6 "Job running" and "Empty").

- `JobsProvider session cancel?`: gives `useJob` / `JobHeader` the session client (its store holds
  the `job` messages; no second socket) and the cancel call. `solverRunCanceller(api, tenant)`
  builds it from the contract client: `DELETE /api/t/:tenant/solver-runs/:id` (`solverRunCancel`).
- `useJob(id)` → `{ status, kind, progress, note, active, cancelRequested, canCancel, cancelError, cancel() }`.
  Values are the last `job` message as sent (`kind` absent = `solver`, `progress` 0..1). `cancelRequested`
  is tier 2's flag, or our own `DELETE` in flight / accepted. Only `solver` jobs are cancellable: the
  contract has no cancel route for imports or AI reconfiguration, so no link is offered for them.
- `JobHeader id`: pass as `GlassPanel` `header.status`. Note ("Searching 1,634 combinations…") +
  thin bar + "Cancel" link while queued / running; "Cancelling…" once asked. A failed or cancelled
  job leaves a one-line end state, a done job renders nothing. Inline only: the panel body is
  not blocked. Screen readers hear state changes (Running, Cancelling), not every tick.
- `ComputeFlow` (WIZ-08): `JobHeader` draws `<ComputeFlow active variant="inline" progress>` before the
  note while the job is queued, running or cancelling (decorative; the progressbar stays the signal).
- `RunIndicator { busy, jobId, note? }`: `JobHeader` when `jobId`; else, while `busy` (POST in flight,
  before the first `job` message), the inline ComputeFlow and "Starting…"; else nothing.
- `EmptyState line action`: one line and one action, supplied by the screen.
- Imports `@glidepath/api-contract`, `@glidepath/ui`, `../session`. No arithmetic on received values.
