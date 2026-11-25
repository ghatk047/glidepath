import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTestDatabase } from '@glidepath/testkit';
import type { TestDatabase } from '@glidepath/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const manualDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlFiles = readdirSync(manualDir).filter((f) => f.endsWith('.sql')).sort();

let db: TestDatabase;

beforeAll(async () => {
  db = await withTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.close();
});

interface Col {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function columns(table: string): Promise<Record<string, Col>> {
  const r = await db.query<Col>(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
}

describe('manual migrations (ADR-023)', () => {
  it('catalog: solver_run gains progress, progress_note, cancel_requested, updated_at; scenario gains archived', async () => {
    const s = await columns('solver_run');
    expect(s.progress).toMatchObject({ data_type: 'real' });
    expect(s.progress_note).toMatchObject({ data_type: 'text' });
    expect(s.cancel_requested).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' });
    expect(s.updated_at).toMatchObject({ data_type: 'timestamp with time zone', is_nullable: 'NO' });
    const sc = await columns('scenario');
    expect(sc.archived).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' });
  });

  it('solver_run keeps progress in 0..1 (check constraint) and updated_at by trigger', async () => {
    const chk = await db.query(`SELECT 1 FROM pg_constraint WHERE conname = 'solver_run_progress_range' AND contype = 'c'`);
    expect(chk.rowCount).toBe(1);
    const trg = await db.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'solver_run_updated_at' AND tgrelid = 'solver_run'::regclass AND NOT tgisinternal`,
    );
    expect(trg.rowCount).toBe(1);
  });

  it('auth tables exist, are global (no tenant_id, no RLS) and have the contracted columns', async () => {
    const t = await columns('auth_token');
    expect(t).toHaveProperty('token_hash');
    expect(t.expires_at).toMatchObject({ is_nullable: 'NO' });
    expect(t).toHaveProperty('consumed_at');
    const s = await columns('auth_session');
    for (const k of ['id', 'user_id', 'expires_at']) expect(s).toHaveProperty(k);
    const p = await columns('passkey');
    expect(p.credential_id).toMatchObject({ data_type: 'text' });
    expect(p.public_key).toMatchObject({ data_type: 'bytea' });
    expect(p).toHaveProperty('user_id');
    for (const name of ['auth_token', 'auth_session', 'passkey']) {
      expect((await columns(name)).tenant_id).toBeUndefined();
      const rls = await db.query<{ relrowsecurity: boolean }>(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [name]);
      expect(rls.rows[0]?.relrowsecurity).toBe(false);
    }
  });

  it('grants: glidepath_app has select/insert/update/delete on the auth tables', async () => {
    for (const name of ['auth_token', 'auth_session', 'passkey']) {
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const r = await db.query<{ ok: boolean }>(`SELECT has_table_privilege('glidepath_app', $1, $2) AS ok`, [name, priv]);
        expect(r.rows[0]?.ok, `${priv} on ${name}`).toBe(true);
      }
    }
    for (const priv of ['TRUNCATE', 'REFERENCES']) {
      const r = await db.query<{ ok: boolean }>(`SELECT has_table_privilege('glidepath_app', 'auth_token', $1) AS ok`, [priv]);
      expect(r.rows[0]?.ok).toBe(false);
    }
  });

  it('DATA-12: same-tenant references are composite (tenant_id, x) FKs, deferrable initially deferred, or restrictive same-tenant policies', async () => {
    const fks = await db.query<{ name: string; cols: string; ref: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.conname AS name, c.condeferrable AS deferrable, c.condeferred AS deferred, c.confrelid::regclass::text AS ref,
              (SELECT string_agg(a.attname, ',' ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(n, ord)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS cols
         FROM pg_constraint c WHERE c.contype = 'f' AND c.condeferrable ORDER BY 1`,
    );
    const byName = Object.fromEntries(fks.rows.map((r) => [r.name, r]));
    const expected: [string, string, string][] = [
      ['scenario_parent_id_fkey', 'tenant_id,parent_id', 'scenario'],
      ['changeset_scenario_id_fkey', 'tenant_id,scenario_id', 'scenario'],
      ['changeset_reverts_id_fkey', 'tenant_id,reverts_id', 'changeset'],
      ['variable_value_changeset_id_fkey', 'tenant_id,changeset_id', 'changeset'],
      ['scenario_value_scenario_id_fkey', 'tenant_id,scenario_id', 'scenario'],
      ['scenario_value_changeset_id_fkey', 'tenant_id,changeset_id', 'changeset'],
      ['node_override_scenario_id_fkey', 'tenant_id,scenario_id', 'scenario'],
      ['market_snapshot_applied_changeset_id_fkey', 'tenant_id,applied_changeset_id', 'changeset'],
      ['import_job_changeset_id_fkey', 'tenant_id,changeset_id', 'changeset'],
      ['calc_run_scenario_id_fkey', 'tenant_id,scenario_id', 'scenario'],
      ['solver_run_scenario_id_fkey', 'tenant_id,scenario_id', 'scenario'],
      ['solver_run_result_scenario_id_fkey', 'tenant_id,result_scenario_id', 'scenario'],
      ['ai_reconfig_job_changeset_id_fkey', 'tenant_id,changeset_id', 'changeset'],
    ];
    for (const [name, cols, ref] of expected) expect(byName[name], name).toMatchObject({ cols, ref, deferrable: true, deferred: true });
    const keys = await db.query(`SELECT conname FROM pg_constraint WHERE contype = 'u' AND conname IN ('scenario_tenant_id_id_key', 'changeset_tenant_id_id_key')`);
    expect(keys.rowCount).toBe(2);
    const pol = await db.query<{ polname: string; permissive: boolean; cmd: string }>(
      `SELECT polname, polpermissive AS permissive, polcmd::text AS cmd FROM pg_policy WHERE polname LIKE '%\\_same\\_tenant' ORDER BY 1`,
    );
    for (const name of ['variable_value_source_id_same_tenant', 'market_snapshot_source_id_same_tenant', 'import_job_export_job_id_same_tenant', 'export_job_scenario_ids_same_tenant']) {
      expect(pol.rows.find((p) => p.polname === name), name).toMatchObject({ permissive: false, cmd: '*' });
    }
  });

  it('grep: each manual migration file names ADR-023 in a header comment', () => {
    expect(sqlFiles.length).toBeGreaterThanOrEqual(2);
    for (const f of sqlFiles) {
      const header = readFileSync(join(manualDir, f), 'utf8').split('\n').slice(0, 5);
      expect(header.every((l) => l.startsWith('--')) || header[0]?.startsWith('--'), f).toBe(true);
      expect(header.filter((l) => l.startsWith('--')).join('\n'), f).toContain('ADR-023');
    }
  });
});
