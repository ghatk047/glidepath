/**
 * `explain(cell, at?)` (03 §1 Modes, Explain): what a number is. Expression, the resolved cells it reads
 * with their values, the formula in words from spec labels, and its top drivers by local sensitivity
 * (rerun). Structure comes from the compiled model (inputs from the CSR); values and drivers need an
 * evaluation, so `at` is optional (PORTING.md §5).
 */
import type { Cell } from '../expand';
import { EngineError } from '../errors';
import type { CellKey, Evaluation, ExplainDriver, ExplainRef, Explanation } from '../types';
import { catalogOf, type Catalog } from './catalog';
import { localSensitivities, type SensitivityModel } from './drivers';
import { isUnreadInputCell, type QueryModel } from './queries';
import { formulaInWords } from './words';

/** What explain needs of a compiled model. */
export interface ExplainableModel extends QueryModel, SensitivityModel {
  /** Node cells in topological order (index = key id = slot). */
  readonly cells: readonly Cell[];
}

/** Spec id, kind, label and unit of `cell`, with its value when `at` holds it. */
function refOf(catalog: Catalog, cell: CellKey, at: Evaluation | undefined): ExplainRef {
  const { id, kind, label, unit } = catalog.symbol(cell);
  return at?.has(cell)
    ? { cell, id, kind, label, unit, value: at.get(cell) }
    : { cell, id, kind, label, unit };
}

/**
 * Drivers with a non-zero, finite sensitivity, by |sensitivity| descending; ties keep upstream order
 * (nearest first).
 */
function driversOf(
  model: ExplainableModel,
  catalog: Catalog,
  cell: CellKey,
  at: Evaluation,
): ExplainDriver[] {
  const y = at.get(cell);
  const out: ExplainDriver[] = [];
  for (const s of localSensitivities(model, cell, at)) {
    const sensitivity = s.derivative * s.value;
    if (sensitivity === 0 || !Number.isFinite(sensitivity)) continue;
    const { id, kind, label, unit } = catalog.symbol(s.cell);
    out.push({
      cell: s.cell,
      id,
      kind,
      label,
      unit,
      value: s.value,
      derivative: s.derivative,
      sensitivity,
      elasticity: y !== 0 && Number.isFinite(y) ? sensitivity / y : null,
    });
  }
  // Array.prototype.sort is stable, so equal magnitudes keep upstream order.
  return out.sort((a, b) => Math.abs(b.sensitivity) - Math.abs(a.sensitivity));
}

/**
 * Explains a node cell or an input cell (also one no formula reads). UNKNOWN_CELL for any other key,
 * a dangling key included (it names no cell).
 */
export function explainCell(model: ExplainableModel, cell: CellKey, at?: Evaluation): Explanation {
  const catalog = catalogOf(model);
  const g = model.graph;
  const nCells = model.program.nCells;
  const id = g.index.get(cell);
  const self = refOf(catalog, cell, at);

  if (id === undefined || id >= nCells) {
    const input =
      (id !== undefined && id < nCells + model.program.nInputs) || isUnreadInputCell(model, cell);
    if (!input) {
      const what = id === undefined ? 'unknown cell' : 'no cell (dangling key)';
      throw new EngineError('UNKNOWN_CELL', `${what} ${cell}`, cell);
    }
    return {
      ...self,
      kind: 'input',
      expression: null,
      pinned: false,
      inputs: [],
      words: `Input: ${self.label}`,
      drivers: [],
    };
  }

  const c = model.cells[id]!;
  const inputs: ExplainRef[] = [];
  for (let o = g.depOff[id]!; o < g.depOff[id + 1]!; o++) {
    inputs.push(refOf(catalog, g.keys[g.depIds[o]!]!, at));
  }
  return {
    ...self,
    kind: 'node',
    expression: c.expr,
    pinned: at?.overrides.has(cell) ?? false,
    inputs,
    words: formulaInWords(c.ast, catalog, c.node.dims ?? []),
    drivers: at ? driversOf(model, catalog, cell, at) : [],
  };
}
