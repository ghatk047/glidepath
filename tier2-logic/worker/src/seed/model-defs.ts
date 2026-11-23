import { schema, sql, type Db } from '@glidepath/data-access';
import type { TenantSeed } from '@glidepath/spec';
import { seedIds } from './ids';
import type { GlobalSeed } from './files';

/** Rows inserted per global table by one run (0 everywhere on a rerun). */
export interface ModelDefsReport {
  readonly modelVersionId: string;
  readonly inserted: Readonly<Record<string, number>>;
  readonly total: number;
}

/** A model_version of this semver exists with other contents: published versions are frozen. */
export class ModelDefsChangedError extends Error {
  constructor(semver: string) {
    super(
      `seed: model_version ${semver} exists with different definitions; a published model is frozen, bump spec_version`,
    );
    this.name = 'ModelDefsChangedError';
  }
}

const CHUNK = 200;
const chunks = <T>(rows: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK));

const numeric = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));
const asJson = (v: unknown): never => v as never;

const notesOf = (g: GlobalSeed): string =>
  `Spec bundle ${g.bundle.modelId} ${g.bundle.specVersion}; content sha256:${g.contentHash}`;

/** The lever_template rows: lever members + the lever library of the seed (the default library). */
function leverTemplates(modelVersionId: string, seed: TenantSeed) {
  const library = new Map(seed.leverLibrary.levers.map((l) => [l.id, l]));
  const order = ['id', 'order', 'label', 'category', 'alloc_key'];
  return (seed.dimensionMembers.lever ?? []).map((m) => {
    const entry = library.get(m.id);
    const text = Object.fromEntries(Object.entries(entry ?? {}).filter(([k]) => !order.includes(k)));
    return {
      model_version_id: modelVersionId,
      code: m.id,
      label: String(m.label ?? entry?.label ?? m.id),
      category: String(m.category ?? entry?.category ?? ''),
      default_alloc_key: String(m.alloc_key ?? entry?.alloc_key ?? ''),
      node_keys: [] as string[],
      var_keys: [] as string[],
      library: text,
    };
  });
}

/**
 * Loads the global definitions: model_version, dimension_def, variable_def, node_def, lever_template,
 * canonical_pool and addr_tag. Inserts what is missing and never overwrites: a model_version that exists
 * with other contents is an error (`ModelDefsChangedError`). Runs as the owner role, in one transaction.
 */
export async function loadModelDefs(db: Db, global: GlobalSeed, seed: TenantSeed): Promise<ModelDefsReport> {
  const { bundle } = global;
  const semver = bundle.specVersion;
  const modelVersionId = seedIds.modelVersion(semver);
  const notes = notesOf(global);
  const inserted: Record<string, number> = {};

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('glidepath:seed:model-defs', 0))`);

    const existing = await tx
      .select({ id: schema.model_version.id, notes: schema.model_version.notes })
      .from(schema.model_version)
      .where(sql`${schema.model_version.semver} = ${semver}`);
    if (existing[0] !== undefined && (existing[0].id !== modelVersionId || existing[0].notes !== notes)) {
      throw new ModelDefsChangedError(semver);
    }

    const insert = async (name: string, run: () => Promise<number>): Promise<void> => {
      inserted[name] = await run();
    };

    await insert('model_version', async () =>
      (
        await tx
          .insert(schema.model_version)
          .values({ id: modelVersionId, semver, status: 'published', notes, created_at: new Date() })
          .onConflictDoNothing()
          .returning({ id: schema.model_version.id })
      ).length,
    );

    const dimensionRows = bundle.dimensions.map((d) => ({
      model_version_id: modelVersionId,
      dim_key: d.id,
      scope: d.scope as 'global' | 'tenant' | 'system' | 'global+tenant',
      attributes: [...d.attributes],
    }));
    await insert('dimension_def', async () =>
      (
        await tx
          .insert(schema.dimension_def)
          .values(dimensionRows)
          .onConflictDoNothing()
          .returning({ k: schema.dimension_def.dim_key })
      ).length,
    );

    const variableRows = global.variables.variables.map((v) => ({
      model_version_id: modelVersionId,
      var_key: v.id as string,
      dims: [...(v.dims as string[])],
      label: v.label as string,
      unit: v.unit as string,
      type: v.type as 'number' | 'int' | 'bool' | 'enum',
      min: numeric(v.min as number | null),
      max: numeric(v.max as number | null),
      step: numeric(v.step as number | null),
      group: (v.group as string | undefined) ?? '',
      layer: v.layer as string,
      role: v.role as 'driver' | 'calibration' | 'simulation',
      ui: asJson(v.ui),
      dist: asJson(v.dist ?? null),
      validation: asJson(v.validation ?? null),
      legacy: asJson(v.legacy ?? []),
    }));
    await insert('variable_def', async () => {
      let n = 0;
      for (const part of chunks(variableRows)) {
        n += (
          await tx
            .insert(schema.variable_def)
            .values(part)
            .onConflictDoNothing()
            .returning({ k: schema.variable_def.var_key })
        ).length;
      }
      return n;
    });

    const nodeRows = bundle.nodes.map((n) => ({
      model_version_id: modelVersionId,
      node_key: n.id,
      dims: [...n.dims],
      expr: n.expr ?? null,
      cases: n.cases === undefined ? null : asJson(n.cases),
      members: n.members === undefined ? null : asJson(n.members),
      unit: n.unit,
      label: n.label,
      layer: n.layer,
      output: n.output,
      overridable: (n as { overridable?: boolean }).overridable ?? true,
    }));
    await insert('node_def', async () => {
      let n = 0;
      for (const part of chunks(nodeRows)) {
        n += (
          await tx
            .insert(schema.node_def)
            .values(part)
            .onConflictDoNothing()
            .returning({ k: schema.node_def.node_key })
        ).length;
      }
      return n;
    });

    // lever_template: the nodes and inputs of a lever are the ones named `lev.<code>.*`.
    const templates = leverTemplates(modelVersionId, seed).map((t) => ({
      ...t,
      node_keys: bundle.nodes.filter((n) => n.id.startsWith(`lev.${t.code}.`)).map((n) => n.id),
      var_keys: bundle.variables.filter((v) => v.id.startsWith(`lev.${t.code}.`)).map((v) => v.id),
    }));
    await insert('lever_template', async () =>
      templates.length === 0
        ? 0
        : (
            await tx
              .insert(schema.lever_template)
              .values(templates)
              .onConflictDoNothing()
              .returning({ k: schema.lever_template.code })
          ).length,
    );

    const pools = (seed.dimensionMembers.pool ?? []).map((p, i) => ({
      id: p.id,
      label: String(p.label),
      third_party: Number(p.third_party) === 1,
      sort: typeof p.order === 'number' ? p.order : i + 1,
    }));
    await insert('canonical_pool', async () =>
      pools.length === 0
        ? 0
        : (
            await tx
              .insert(schema.canonical_pool)
              .values(pools)
              .onConflictDoNothing()
              .returning({ k: schema.canonical_pool.id })
          ).length,
    );

    const tags = (seed.dimensionMembers.addr_tag ?? []).map((t) => ({ id: t.id, label: String(t.label) }));
    await insert('addr_tag', async () =>
      tags.length === 0
        ? 0
        : (await tx.insert(schema.addr_tag).values(tags).onConflictDoNothing().returning({ k: schema.addr_tag.id }))
            .length,
    );
  });

  return { modelVersionId, inserted, total: Object.values(inserted).reduce((a, b) => a + b, 0) };
}
