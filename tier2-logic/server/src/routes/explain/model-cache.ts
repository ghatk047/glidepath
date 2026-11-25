import { compile } from '@glidepath/engine';
import type { CompiledModel } from '@glidepath/engine';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';

/** Compiled models kept at once (one per model version and members set in use). */
const KEEP = 8;

/**
 * Compiled models by (model version, members hash): the engine's compile output is immutable and
 * shareable, so every request of the tenant reuses it until its members change.
 */
export class ModelCache {
  private readonly models = new Map<string, CompiledModel>();

  get(modelVersionId: string, membersHash: string, bundle: ModelBundle, members: TenantMembers): CompiledModel {
    const key = `${modelVersionId}:${membersHash}`;
    const hit = this.models.get(key);
    if (hit) {
      this.models.delete(key);
      this.models.set(key, hit);
      return hit;
    }
    const model = compile(bundle, members);
    this.models.set(key, model);
    while (this.models.size > KEEP) this.models.delete(this.models.keys().next().value as string);
    return model;
  }
}
