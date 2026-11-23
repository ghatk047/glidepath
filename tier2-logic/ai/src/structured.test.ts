import { describe, expect, expectTypeOf, it } from 'vitest';
import { outputFormat } from './client';
import { ModelOutputError } from './errors';
import { defineStep } from './step';
import { loadExchanges } from './testing/fake-transport';
import {
  FactBaseSchema,
  forbidNetwork,
  harness,
  PlanSchema,
  researchStep,
  scopeStep,
} from './testing/harness';

forbidNetwork();

describe('AC2 structured outputs via output_config.format from zod; tool_choice auto only', () => {
  it('sends output_config.format as the JSON schema derived from the step zod schema', async () => {
    const h = harness(loadExchanges('scope-end-turn'));
    await h.client.run(scopeStep, { request: 'x' });
    const format = h.requests[0]!.body.output_config.format;
    expect(format).toEqual(outputFormat(PlanSchema));
    expect(format.type).toBe('json_schema');
    expect(Object.keys(format.schema.properties)).toEqual([
      'tenant',
      'baseYear',
      'targetYear',
      'produce',
    ]);
    expect(format.schema.additionalProperties).toBe(false);
    expect(h.requests[0]!.body).not.toHaveProperty('output_format'); // deprecated parameter
  });

  it('returns the reply parsed and validated as the typed output', async () => {
    const h = harness(loadExchanges('scope-end-turn'));
    const run = await h.client.run(scopeStep, { request: 'x' });
    expectTypeOf(run.output.baseYear).toEqualTypeOf<number>();
    expect(run.output).toEqual({
      tenant: { name: 'Example Air', iata: 'ZZ' },
      baseYear: 2025,
      targetYear: 2028,
      produce: ['seed', 'lever_tuning'],
    });
  });

  it('rejects a reply that does not match the schema with ModelOutputError', async () => {
    const h = harness(loadExchanges('bad-output'));
    const err = await h.client.run(scopeStep, { request: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as ModelOutputError).issues.map((i) => i.path.join('.'))).toEqual(
      expect.arrayContaining(['baseYear', 'produce']),
    );
  });

  it('sends tool_choice auto with server tools, and no tool_choice at all without tools', async () => {
    const h = harness([
      ...loadExchanges('scope-end-turn'),
      ...loadExchanges('research-pause-turn'),
    ]);
    await h.client.run(scopeStep, { request: 'x' });
    const research = await h.client.run(researchStep, { tenant: 'Example Air' });
    expect(research.output).toEqual(FactBaseSchema.parse(research.output));

    const [scope, ...withTools] = h.requests;
    expect(scope!.body).not.toHaveProperty('tools');
    expect(scope!.body).not.toHaveProperty('tool_choice');
    for (const r of withTools) {
      expect(r.body.tool_choice).toEqual({ type: 'auto' });
      expect(r.body.tools.map((t: { type: string }) => t.type)).toEqual([
        'web_search_20260209',
        'web_fetch_20260209',
      ]);
    }
    // Forced choice (any / tool) is rejected on this model: no request may ever carry it.
    for (const r of h.requests) expect([undefined, 'auto']).toContain(r.body.tool_choice?.type);
  });

  it('has no way to ask for a forced tool_choice or a client tool in a step definition', () => {
    const compileOnly = () =>
      defineStep({
        ...scopeStep,
        // @ts-expect-error steps cannot set tool_choice
        tool_choice: { type: 'any' },
      });
    const clientTool = () =>
      defineStep({
        ...scopeStep,
        // @ts-expect-error only server tools (web search / web fetch) are allowed
        tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
      });
    expect(typeof compileOnly).toBe('function');
    expect(typeof clientTool).toBe('function');
  });
});
