# @glidepath/spec

Loads and validates the model spec JSON into a `ModelBundle`, hashes tenant dimension members, and holds the generated zod types (`src/generated`, produced by `pnpm gen:types`, never edited by hand).

The core is pure (no `fs`, no `node:*` imports, no IO). A thin node adapter reads files.

## Entry points

| Import | Contents |
|---|---|
| `@glidepath/spec` | Pure core: `loadModelBundle`, `membersHash`, `sha256Hex`, `SpecValidationError`, all types |
| `@glidepath/spec/node` | `loadModelBundleFromDir(specDir)`: reads `variables.json` and `formula_graph.json`, calls the core |
| `@glidepath/spec/generated` | Generated zod schemas for the spec and seed JSON |

## ModelBundle API

```ts
import { loadModelBundle, membersHash, SpecValidationError } from '@glidepath/spec';
import { loadModelBundleFromDir } from '@glidepath/spec/node';

// Node: from a spec directory (docs/spec, or a model_version exported to disk)
const bundle = await loadModelBundleFromDir('docs/spec');

// Pure: from already-parsed JSON (e.g. rows of model_version read by data-access)
const bundle2 = loadModelBundle({ variables: variablesJson, formulaGraph: formulaGraphJson });

const key = membersHash(tenantMembers); // 64-char lowercase hex
```

### `loadModelBundle(json: ModelBundleJson): ModelBundle`

`json` is `{ variables, formulaGraph }`: the parsed contents of `variables.json` and `formula_graph.json`. Returns:

```ts
interface ModelBundle {            // one model_version, as in docs/architecture/03 §1
  variables: readonly VariableDef[];
  nodes: readonly NodeDef[];       // expr and/or cases, optional members subset
  dimensions: readonly DimensionDef[];
  // additive metadata
  specVersion: string; modelId: string; units: string; expressionLanguage: string;
  layers: readonly string[];
}
```

Ids, field names and values are the spec's, verbatim. Unknown extra JSON fields are kept on the objects (so a newer spec minor version loads). Expressions are not parsed here; the engine parses them at compile time.

Validation (all problems collected, then one `SpecValidationError` thrown):

- structure and types of every field (zod);
- unknown dimension in a variable's or node's `dims`; dimension listed twice;
- duplicate dimension, variable or node id; a node id that is also a variable id; duplicate dimension attribute;
- node with neither `expr` nor `cases`;
- `cases[].when` or `members` naming a dim the node does not have; duplicate member in a subset;
- node `layer` not in `layers`; `min > max`; `variables.count` mismatch; differing `spec_version` between the two files.

`SpecValidationError.issues` is `{ path, message }[]` with a JSON path rooted at the input, e.g. `$.formulaGraph.nodes[40]` or `$.variables.variables[5].dims[1]`. `message` is `"<first path>: <first message> (and N more)"`.

### `membersHash(members: TenantMembers): string`

`TenantMembers = Record<DimId, Member[]>`, `Member = { id: string; [attr]: AttrValue }` (attributes are plain JSON). SHA-256 over dimensions sorted by id, members sorted by id and attributes sorted by name, under the prefix `glidepath.members.v1`. Independent of dim, member and attribute order; any change to a member id, attribute name or value (including array order inside a value) changes it. `undefined` attributes count as absent; duplicate member ids and non-finite numbers throw. This is the `members_hash` in the ModelCache key `(tenant, model_version, members_hash)`.

Note: the hash ignores member order, but evaluation sums run in member order. Callers that need evaluation order to be part of the cache key must add it themselves.

### `sha256Hex(text: string): string`

Synchronous pure-TS SHA-256 of a UTF-8 string, so the engine's `inputHash` can reuse it without `node:crypto`.

## Tenant seed

```ts
import { seedToTenantData } from '@glidepath/spec';
import { readTenantSeed, loadModelBundleFromDir } from '@glidepath/spec/node';

const seed = await readTenantSeed('docs/spec/seed/aa');          // the five seed files, zod-validated
const bundle = await loadModelBundleFromDir('docs/spec');
const data = seedToTenantData(seed, 'C', bundle);                  // { members, values, overrides }
```

- `readTenantSeed(dir)` (node adapter) reads `tenant.json`, `dimension_members.json`, `variable_values.json`, `scenarios.json`, `lever_library.json`; the pure `parseTenantSeed({ tenant, dimensionMembers, variableValues, scenarios, leverLibrary })` validates already-parsed JSON (e.g. rows from the database). Errors are `SpecValidationError` with JSON paths. The schemas are generic (any tenant), not the AA-pinned generated ones.
- `seedToTenantData(seed, scenarioId?, bundle?)` reproduces `Model.input_cells` of `docs/spec/reference/engine.py`: tenant defaults, then the scenario's `values` (last wins; a per-member dict overlays only its keys), plus the scenario's node `overrides`. Cell keys are `vid` or `vid[m1,m2]` (the comma-joined member key from the JSON, verbatim). No `scenarioId`: defaults only (`default_scenario` is not applied). `members` keeps every attribute of every member for where-filters.
- With `bundle`, each variable's `dims` decide the shape: a scalar for a dimensioned variable throws `needs per-member values` (as Python), and so do an unknown variable, a dict for a scalar variable (Python silently keeps the last entry) and a member key with the wrong arity. Without it the value's shape decides.

## Tests

`pnpm turbo run typecheck lint test --filter=@glidepath/spec...`. Acceptance tests load the real `docs/spec` (194 variables, 307 nodes), check JSON-path errors on invalid fixtures, the hash properties, and that `src/core` and `src/index.ts` import no node builtin.
