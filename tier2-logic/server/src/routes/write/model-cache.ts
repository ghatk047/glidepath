import type { ModelCache, ModelCacheKey } from '@glidepath/domain';
import type { CompiledModel } from '@glidepath/engine';

/** Compiled models kept at once (one per tenant, model version and members set in use). */
const KEEP = 16;

/** The server's ModelCache port (ADR-019): compiled models shared across requests, least recently used out. */
export class LruModelCache implements ModelCache<CompiledModel> {
  private readonly models = new Map<string, CompiledModel>();

  getOrCompile(key: ModelCacheKey, compile: () => CompiledModel): CompiledModel {
    const k = `${key.tenant_id}:${key.model_version_id}:${key.members_hash}`;
    const hit = this.models.get(k);
    if (hit) {
      this.models.delete(k);
      this.models.set(k, hit);
      return hit;
    }
    const model = compile();
    this.models.set(k, model);
    while (this.models.size > KEEP) this.models.delete(this.models.keys().next().value as string);
    return model;
  }
}
