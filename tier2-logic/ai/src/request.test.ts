import { describe, expect, it } from 'vitest';
import { DEFAULT_LIGHT_MODEL, DEFAULT_MODEL } from './config';
import { defineStep } from './step';
import { loadExchanges } from './testing/fake-transport';
import {
  forbidNetwork,
  harness,
  PlanSchema,
  researchStep,
  scopeStep,
  SYSTEM_PROMPT,
} from './testing/harness';

forbidNetwork();

describe('AC1 @anthropic-ai/sdk, claude-opus-5-5, adaptive thinking, explicit effort per step', () => {
  it('records a request body with claude-opus-5-5, adaptive thinking and the step effort, sent by the SDK', async () => {
    const h = harness(loadExchanges('scope-end-turn'));
    await h.client.run(scopeStep, { request: 'set up Example Air' });

    expect(h.requests).toHaveLength(1);
    const req = h.requests[0]!;
    expect(req.method).toBe('POST');
    expect(new URL(req.url).pathname).toBe('/v1/messages');
    expect(req.headers['user-agent']).toMatch(/^Anthropic\/JS /);
    expect(req.headers['anthropic-version']).toBeTruthy();
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.thinking).toEqual({ type: 'adaptive' });
    expect(req.body.output_config.effort).toBe('medium');
    // No sampling parameters and no thinking budget: both are rejected on this model.
    for (const k of ['temperature', 'top_p', 'top_k']) expect(req.body).not.toHaveProperty(k);
    expect(req.body.thinking).not.toHaveProperty('budget_tokens');
  });

  it('sends each step its own effort, never relying on the model default', async () => {
    const h = harness([
      ...loadExchanges('scope-end-turn'),
      ...loadExchanges('research-pause-turn'),
    ]);
    await h.client.run(scopeStep, { request: 'x' });
    await h.client.run(researchStep, { tenant: 'Example Air' });
    expect(h.requests.map((r) => r.body.output_config.effort)).toEqual(['medium', 'high', 'high']);
  });

  it('takes model ids from config: AI_MODEL overrides the default, light steps use AI_MODEL_LIGHT', async () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(DEFAULT_LIGHT_MODEL).toBe('claude-sonnet-5-5');
    const light = defineStep({ ...scopeStep, id: 'light', model: 'light' as const });

    const d = harness([...loadExchanges('scope-end-turn'), ...loadExchanges('scope-end-turn')]);
    await d.client.run(light, { request: 'x' });
    await d.client.run(scopeStep, { request: 'x' });
    expect(d.requests.map((r) => r.body.model)).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5']);

    const o = harness(loadExchanges('scope-end-turn'), { env: { AI_MODEL: 'claude-opus-5' } });
    await o.client.run(scopeStep, { request: 'x' });
    expect(o.requests[0]!.body.model).toBe('claude-opus-5');
  });

  it('puts the system prompt in the request exactly as the step defines it', async () => {
    const h = harness(loadExchanges('scope-end-turn'));
    await h.client.run(scopeStep, { request: 'x' });
    expect(h.requests[0]!.body.system[0]).toEqual({ type: 'text', text: SYSTEM_PROMPT });
  });

  it('rejects a step without a stable system prefix or with a bad id', async () => {
    const h = harness([]);
    await expect(h.client.run({ ...scopeStep, system: [] }, { request: 'x' })).rejects.toThrow(
      /system prefix/,
    );
    await expect(
      h.client.run({ ...scopeStep, id: 'Scope Step' }, { request: 'x' }),
    ).rejects.toThrow(/slug/);
    expect(h.requests).toHaveLength(0);
  });

  it('keeps the plan schema strict (sanity for the fixtures)', () => {
    expect(PlanSchema.safeParse({}).success).toBe(false);
  });
});
