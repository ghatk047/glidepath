import type { ReactNode } from 'react';
import { fmt } from '@glidepath/ui/format';

/** A KPI tile row: label over value, values exactly as formatted from tier 2's numbers. */
export function Kpis({ items, label }: { items: readonly { id: string; label: string; value: ReactNode }[]; label: string }) {
  return (
    <dl className="gp-src-kpis" aria-label={label}>
      {items.map((k) => (
        <div key={k.id} className="gp-src-kpi" data-kpi={k.id}>
          <dt title={k.label}>{k.label}</dt>
          <dd>{k.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Tone = 'pos' | 'warn' | 'neg' | 'accent' | undefined;

export function Tag({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <em className="gp-src-tag" data-tone={tone} title={title}>
      {children}
    </em>
  );
}

/** Tier 2's one line for a failed read. */
export function ReadError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="gp-src-error" role="alert">
      {error}
    </p>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** `2027-03` → `Mar 27` (display only; the month string is tier 2's). */
export const monthLabel = (month: string): string => {
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  return `${name} ${month.slice(2, 4)}`;
};

/** Months to recover a one-time cost, as tier 2 sent them: null = never. */
export const paybackText = (months: number | null): string =>
  months === null ? 'never' : `${fmt.fte(months)} mo`;

/** $ per unit (benchmarks): whole dollars, cents under $10. */
export const usd = (v: number): string => fmt.eps(v, { digits: v < 10 && v > -10 ? 2 : 0 });
