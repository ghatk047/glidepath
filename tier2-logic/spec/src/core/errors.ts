/** One validation problem, located by a JSON path such as `$.formulaGraph.nodes[12].dims[0]`. */
export interface SpecIssue {
  readonly path: string;
  readonly message: string;
}

/** Thrown by `loadModelBundle` when the spec JSON is invalid. `issues` lists every problem found. */
export class SpecValidationError extends Error {
  readonly issues: readonly SpecIssue[];

  constructor(issues: readonly SpecIssue[]) {
    const first = issues[0];
    const head = first ? `${first.path}: ${first.message}` : 'invalid spec';
    super(issues.length > 1 ? `${head} (and ${issues.length - 1} more)` : head);
    this.name = 'SpecValidationError';
    this.issues = issues;
  }
}

/** Format a path array as a JSON path: `['a', 0, 'b']` becomes `$.a[0].b`. */
export function jsonPath(segments: readonly PropertyKey[]): string {
  let out = '$';
  for (const s of segments) {
    out += typeof s === 'number' ? `[${s}]` : `.${String(s)}`;
  }
  return out;
}
