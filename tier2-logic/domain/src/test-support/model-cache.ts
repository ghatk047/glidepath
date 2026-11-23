// Test support only (never exported by the package): an in-memory ModelCache (the server owns the
// real one) that counts compiles and the evaluations of the models it hands out.
import type { CompiledModel, Evaluation } from '@glidepath/engine';
import type { ModelCache, ModelCacheKey } from '../ports';

export class CountingModelCache implements ModelCache<CompiledModel> {
  readonly keys: ModelCacheKey[] = [];
  compiles = 0;
  evaluations = 0;
  private readonly models = new Map<string, CompiledModel>();

  /** `wrap` may replace a compiled model's evaluations (e.g. a faulty engine for VR08). */
  constructor(private readonly wrap?: (ev: Evaluation) => Evaluation) {}

  getOrCompile(key: ModelCacheKey, compile: () => CompiledModel): CompiledModel {
    this.keys.push(key);
    const id = `${key.tenant_id}|${key.model_version_id}|${key.members_hash}`;
    let model = this.models.get(id);
    if (!model) {
      this.compiles++;
      model = this.counting(compile());
      this.models.set(id, model);
    }
    return model;
  }

  private counting(model: CompiledModel): CompiledModel {
    const evaluate: CompiledModel['evaluate'] = (values, overrides) => {
      this.evaluations++;
      const ev = model.evaluate(values, overrides);
      return this.wrap ? this.wrap(ev) : ev;
    };
    return new Proxy(model, {
      get(target, prop) {
        if (prop === 'evaluate') return evaluate;
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  }
}
