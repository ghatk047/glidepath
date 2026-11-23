/** One thing the palette can jump to. Everything arrives as props: the index is built by tier 2 / web. */
export interface PaletteItem {
  /** Node, variable, lever or screen id, verbatim (e.g. "g.target_net", "L10", "#levers"). */
  id: string;
  /** Display label, e.g. "Net target · CY27". */
  label: string;
  /** Kind shown on the right, e.g. "input", "lever", "node", "line", "screen". */
  kind: string;
  /** Unit shown after the kind, e.g. "$M", "%/yr". Optional. */
  unit?: string;
}

/** Most results shown at once (04_component_inventory #4). */
export const MAX_RESULTS = 9;

/** Words the empty state suggests (04_component_inventory #4). */
export const DEFAULT_SUGGESTIONS: readonly string[] = ['COLA', 'cloud', 'headcount'];

/**
 * Text match only: case-insensitive, every typed word must appear in the label, id or kind.
 * Items keep the order they arrived in; an empty query lists the first ones.
 */
export function searchItems(
  items: readonly PaletteItem[],
  query: string,
  limit: number = MAX_RESULTS,
): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: PaletteItem[] = [];
  for (const item of items) {
    const hay = `${item.label} ${item.id} ${item.kind}`.toLowerCase();
    if (words.every((w) => hay.includes(w))) hits.push(item);
    if (hits.length >= limit) break;
  }
  return hits;
}
