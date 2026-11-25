import type { ReactNode } from 'react';
import { Value, type FormatName } from '../../bind';

const FORMATS: readonly string[] = ['money', 'pct', 'fte', 'mult', 'eps', 'cents'];
const TOKEN = /\{([^{}]+)\}/g;

/** `res.net`, `base.locked_share|pct`, `vp.net[vp_x]|money` parsed into node, member, format. */
export function parsePlaceholder(raw: string): {
  node: string;
  member: string;
  format: FormatName | undefined;
} {
  const [head = '', fmt] = raw.split('|');
  const m = /^([^[\]]+)(?:\[([^\]]*)\])?$/.exec(head.trim());
  return {
    node: m?.[1] ?? head.trim(),
    member: m?.[2] ?? '',
    format: fmt !== undefined && FORMATS.includes(fmt.trim()) ? (fmt.trim() as FormatName) : undefined,
  };
}

/**
 * Renders a step body: text stays text, `{node}` becomes a bound `<Value>` (tier 2's number,
 * never computed here) and `{tenant}` the tenant name tier 2 sent.
 */
export function TourBody({ text, tenantName }: { text: string; tenantName: string }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[1]!;
    if (raw.trim() === 'tenant') {
      out.push(<span key={key++}>{tenantName}</span>);
    } else {
      const { node, member, format } = parsePlaceholder(raw);
      out.push(<Value key={key++} node={node} member={member} format={format} />);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
