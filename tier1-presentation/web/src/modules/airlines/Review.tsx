import type { DraftKind, ReconfigJob } from '@glidepath/api-contract';
import { fmt } from '@glidepath/ui/format';
import { COPY } from './copy';
import type { Reconfig } from './useReconfig';

/**
 * Review of one job (06 §2 step 7): plan, sources, open questions, calibration and the changeset
 * summary. Residuals, counts and impacts are tier 2's; nothing is added up here.
 */
export function Review({ r, job }: { r: Reconfig; job: ReconfigJob }) {
  const plan = job.plan;
  const cal = job.calibration;
  const canApply = job.status === 'review' && job.drafts.length > 0;
  const blocked = job.openQuestions.some((q) => q.blocking);
  const kinds: DraftKind[] = job.drafts.map((d) => d.kind);
  return (
    <section className="gp-airlines-review" aria-label={COPY.review} data-status={job.status}>
      {job.status === 'budget_exceeded' || job.status === 'failed' || job.status === 'cancelled' ? (
        <p className="gp-airlines-error" role="alert">
          {job.error?.detail ?? job.status.replace('_', ' ')}
        </p>
      ) : null}
      {plan ? (
        <div className="gp-airlines-block" data-block="plan">
          <h3>{COPY.plan}</h3>
          <p>
            <span className="gp-airlines-mono-sm" data-monogram="">
              {plan.tenant.monogram}
            </span>{' '}
            {plan.tenant.name} · {plan.tenant.currency} · {plan.baseYear} → {plan.targetYear}
          </p>
          <ul>
            {plan.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {job.sources.length > 0 || job.facts.length > 0 ? (
        <div className="gp-airlines-block" data-block="sources">
          <h3>{COPY.sources}</h3>
          <ul>
            {job.sources.map((s) => (
              <li key={s.id}>
                {s.title}
                {s.publisher ? ` · ${s.publisher}` : ''}
              </li>
            ))}
          </ul>
          <ul className="gp-airlines-facts-list">
            {job.facts.map((f) => (
              <li
                key={f.id}
                data-confidence={f.confidence}
                data-unsourced={f.sourceId === null || undefined}
              >
                {f.label}: {String(f.value)} {f.unit} · {f.confidence}
                {f.sourceId === null ? ` · ${COPY.noSource}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {job.openQuestions.length > 0 ? (
        <div className="gp-airlines-block" data-block="questions">
          <h3>{COPY.openQuestions}</h3>
          <ul>
            {job.openQuestions.map((q) => (
              <li key={q.id}>
                {q.question}
                {q.blocking ? ` (${COPY.blocking})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {cal ? (
        <div className="gp-airlines-block" data-block="calibration" data-passed={cal.passed}>
          <h3>
            {COPY.calibration} · FY{cal.fiscalYear}
          </h3>
          <p>
            {cal.passed ? COPY.calibrationPassed : COPY.calibrationFailed} · tolerance{' '}
            {fmt.pct(cal.tolerance)}
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Reported</th>
                <th scope="col">Model</th>
                <th scope="col">Residual</th>
              </tr>
            </thead>
            <tbody>
              {cal.lines.map((l) => (
                <tr key={l.metric} data-ok={l.ok}>
                  <th scope="row">{l.metric}</th>
                  <td>{fmt.money(l.reported)}</td>
                  <td>{fmt.money(l.model)}</td>
                  <td>{fmt.pct(l.residual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {job.drafts.length > 0 ? (
        <div className="gp-airlines-block" data-block="changesets">
          <h3>{COPY.changesets}</h3>
          <ul>
            {job.drafts.map((d) => (
              <li key={d.kind} data-kind={d.kind}>
                <strong>{d.title}</strong> · {d.changes} changes
                <br />
                {d.summary}
                <span className="gp-airlines-sections">
                  {d.sections.map((s) => `${s.section} ${s.changes}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canApply ? (
        <div className="gp-airlines-row">
          <button
            type="button"
            className="gp-airlines-primary"
            disabled={r.applying || blocked}
            onClick={() => void r.apply(kinds)}
          >
            {r.applying ? COPY.applying : COPY.apply}
          </button>
          {blocked ? (
            <span className="gp-airlines-sub">
              {COPY.openQuestions}: {COPY.blocking}
            </span>
          ) : null}
        </div>
      ) : null}
      {r.result ? (
        <p role="status" className="gp-airlines-applied">
          {COPY.applied} · {r.result.applied.map((a) => `${a.kind} ${a.editsCount}`).join(' · ')}
        </p>
      ) : null}
    </section>
  );
}
