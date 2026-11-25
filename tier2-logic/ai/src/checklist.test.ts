import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import checklistJson from './onboarding/checklist.json';
import {
  ChecklistStepId,
  checklistStepForDim,
  checklistStepForVariable,
  ONBOARDING_CHECKLIST,
  parseChecklist,
  renderChecklist,
} from './onboarding/checklist';
import { systemBlocks } from './prompts/system';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../docs/spec');

/** The bold item labels of spec 07 §2, in order. */
function specChecklistTitles(): string[] {
  const md = readFileSync(join(specDir, '07_multitenancy_reconfiguration.md'), 'utf8');
  const section = md.split(/^## /m).find((s) => s.startsWith('2. Tenant onboarding checklist'));
  if (!section) throw new Error('spec 07 §2 not found');
  return [...section.matchAll(/^\d+\. \*\*(.+?):\*\*/gm)].map((m) => m[1]!);
}

/** Every non-test TypeScript source of this package. */
function codeFiles(dir = here): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return codeFiles(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('AC3 the nine onboarding steps are data, not prose in code', () => {
  it('checklist.json holds the nine steps of spec 07 §2, in order', () => {
    const titles = specChecklistTitles();
    expect(titles).toHaveLength(9);
    expect(ONBOARDING_CHECKLIST.steps.map((s) => s.title)).toEqual(titles);
    expect(ONBOARDING_CHECKLIST.steps.map((s) => s.n)).toEqual(titles.map((_, i) => i + 1));
    expect(ChecklistStepId.options).toEqual(ONBOARDING_CHECKLIST.steps.map((s) => s.id));
  });

  it('no TypeScript source spells out a step: titles, requirements and research topics live only in the data', () => {
    const phrases = ONBOARDING_CHECKLIST.steps.flatMap((s) => [s.produce, ...s.research, `**${s.title}:**`, `${s.n}. ${s.title}`]);
    const offenders = codeFiles().flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      return phrases.filter((p) => src.includes(p)).map((p) => `${relative(here, f)}: ${p}`);
    });
    expect(offenders).toEqual([]);
  });

  it('prompts render the checklist from the data: changing the data changes the prompt', () => {
    const rendered = renderChecklist();
    for (const s of ONBOARDING_CHECKLIST.steps) expect(rendered).toContain(`${s.n}. ${s.title} (\`${s.id}\`): ${s.produce}`);
    for (const step of ['scope', 'research', 'seed_draft', 'lever_tuning'] as const) expect(systemBlocks(step)).toContain(rendered);

    const edited = structuredClone(checklistJson);
    edited.steps[3]!.produce = 'Changed in the data only.';
    const custom = parseChecklist(edited);
    expect(renderChecklist(custom)).toContain('4. Workforce (`workforce`): Changed in the data only.');
    expect(systemBlocks('scope', { checklist: custom })[2]).toBe(renderChecklist(custom));
  });

  it('the data is validated: steps numbered in order, unique ids, known seed files', () => {
    const swapped = structuredClone(checklistJson);
    [swapped.steps[0], swapped.steps[1]] = [swapped.steps[1]!, swapped.steps[0]!];
    expect(() => parseChecklist(swapped)).toThrow(/out of order/);
    const dup = structuredClone(checklistJson);
    dup.steps[1]!.id = dup.steps[0]!.id;
    expect(() => parseChecklist(dup)).toThrow(/duplicate step id/);
    const file = structuredClone(checklistJson);
    file.steps[0]!.seed.files = ['tenant.yaml'];
    expect(() => parseChecklist(file)).toThrow();
    const from = structuredClone(checklistJson);
    from.steps[0]!.seed.from = 'guess';
    expect(() => parseChecklist(from)).toThrow();
  });

  it('seed.from says which steps the seed draft copies from the global presets (07 §2 step 8) and which it drafts', () => {
    const presets = ONBOARDING_CHECKLIST.steps.filter((s) => s.seed.from === 'presets');
    expect(presets.map((s) => s.id)).toEqual(['scenarios']);
    expect(presets.every((s) => s.research.length === 0)).toBe(true);
  });

  it('every registry variable, model dimension and seed file belongs to exactly one checklist step', async () => {
    const bundle = await loadModelBundleFromDir(specDir);
    const steps = ONBOARDING_CHECKLIST.steps;

    const unowned = bundle.variables.filter((v) => checklistStepForVariable(v) === undefined).map((v) => v.id);
    expect(unowned).toEqual([]);
    const groups = steps.flatMap((s) => s.seed.groups);
    expect(new Set(groups).size).toBe(groups.length);
    const named = steps.flatMap((s) => s.seed.variables);
    expect(new Set(named).size).toBe(named.length);
    const ids = new Set(bundle.variables.map((v) => v.id));
    expect(named.filter((v) => !ids.has(v))).toEqual([]);

    const dims = steps.flatMap((s) => s.seed.dims);
    expect(new Set(dims).size).toBe(dims.length);
    expect(bundle.dimensions.map((d) => d.id).filter((d) => checklistStepForDim(d) === undefined)).toEqual([]);
    expect([...dims].sort()).toEqual(bundle.dimensions.map((d) => d.id).sort());

    expect(new Set(steps.flatMap((s) => s.seed.files))).toEqual(
      new Set(['tenant.json', 'dimension_members.json', 'variable_values.json', 'scenarios.json', 'lever_library.json']),
    );
  });
});
