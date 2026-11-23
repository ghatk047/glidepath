import { jsonPath, SpecValidationError, type SpecIssue } from './errors';
import { ModelBundleJsonSchema } from './schemas';
import type { DimensionDef, ModelBundle, ModelBundleJson, NodeDef, VariableDef } from './types';

type Root = 'variables' | 'formulaGraph';
type Path = (string | number)[];

/**
 * Validate the spec JSON and build the `ModelBundle`. Pure: takes parsed JSON, does no IO.
 * Throws `SpecValidationError` listing every problem with its JSON path
 * (`$.variables.variables[3].dims[0]`, `$.formulaGraph.nodes[40]`, ...).
 */
export function loadModelBundle(json: ModelBundleJson): ModelBundle {
  const parsed = ModelBundleJsonSchema.safeParse(json);
  if (!parsed.success) {
    throw new SpecValidationError(
      parsed.error.issues.map((i) => ({ path: jsonPath(i.path), message: i.message })),
    );
  }
  const { variables: vdoc, formulaGraph: gdoc } = parsed.data;

  const issues: SpecIssue[] = [];
  const at = (root: Root, path: Path, message: string): void => {
    issues.push({ path: jsonPath([root, ...path]), message });
  };

  if (vdoc.spec_version !== gdoc.spec_version) {
    at('variables', ['spec_version'], `spec_version '${vdoc.spec_version}' differs from formulaGraph '${gdoc.spec_version}'`);
  }
  if (vdoc.count !== undefined && vdoc.count !== vdoc.variables.length) {
    at('variables', ['count'], `count is ${vdoc.count} but variables has ${vdoc.variables.length} entries`);
  }

  // Dimensions: unique ids, unique attributes.
  const dimIds = new Set<string>();
  gdoc.dimensions.forEach((d, i) => {
    if (dimIds.has(d.id)) at('formulaGraph', ['dimensions', i, 'id'], `duplicate dimension id '${d.id}'`);
    dimIds.add(d.id);
    const seen = new Set<string>();
    d.attributes.forEach((a, j) => {
      if (seen.has(a)) at('formulaGraph', ['dimensions', i, 'attributes', j], `duplicate attribute '${a}' in dimension '${d.id}'`);
      seen.add(a);
    });
  });

  const checkDims = (root: Root, base: Path, dims: string[]): void => {
    const seen = new Set<string>();
    dims.forEach((d, j) => {
      if (!dimIds.has(d)) at(root, [...base, 'dims', j], `unknown dimension '${d}'`);
      else if (seen.has(d)) at(root, [...base, 'dims', j], `dimension '${d}' listed twice`);
      seen.add(d);
    });
  };

  // Variables.
  const varIds = new Set<string>();
  vdoc.variables.forEach((v, i) => {
    const base: Path = ['variables', i];
    if (varIds.has(v.id)) at('variables', [...base, 'id'], `duplicate variable id '${v.id}'`);
    varIds.add(v.id);
    checkDims('variables', base, v.dims);
    if (v.min !== null && v.max !== null && v.min > v.max) {
      at('variables', [...base, 'min'], `min ${v.min} is greater than max ${v.max}`);
    }
  });

  // Nodes.
  const layers = new Set(gdoc.layers);
  const nodeIds = new Set<string>();
  gdoc.nodes.forEach((n, i) => {
    const base: Path = ['nodes', i];
    if (nodeIds.has(n.id)) at('formulaGraph', [...base, 'id'], `duplicate node id '${n.id}'`);
    else if (varIds.has(n.id)) at('formulaGraph', [...base, 'id'], `node id '${n.id}' is also a variable id`);
    nodeIds.add(n.id);
    checkDims('formulaGraph', base, n.dims);
    if (!layers.has(n.layer)) at('formulaGraph', [...base, 'layer'], `unknown layer '${n.layer}'`);
    if (n.expr === undefined && n.cases === undefined) {
      at('formulaGraph', base, `node '${n.id}' has neither expr nor cases`);
    }
    const nodeDims = new Set(n.dims);
    n.cases?.forEach((c, k) => {
      for (const d of Object.keys(c.when ?? {})) {
        if (!nodeDims.has(d)) at('formulaGraph', [...base, 'cases', k, 'when', d], `dimension '${d}' is not a dim of node '${n.id}'`);
      }
    });
    for (const [d, ms] of Object.entries(n.members ?? {})) {
      if (!nodeDims.has(d)) at('formulaGraph', [...base, 'members', d], `dimension '${d}' is not a dim of node '${n.id}'`);
      if (new Set(ms).size !== ms.length) at('formulaGraph', [...base, 'members', d], `duplicate member in subset of '${d}'`);
    }
  });

  if (issues.length > 0) throw new SpecValidationError(issues);

  return {
    variables: vdoc.variables as VariableDef[],
    nodes: gdoc.nodes as NodeDef[],
    dimensions: gdoc.dimensions as DimensionDef[],
    specVersion: gdoc.spec_version,
    modelId: gdoc.model_id,
    units: gdoc.units,
    expressionLanguage: gdoc.expression_language,
    layers: gdoc.layers,
  };
}
