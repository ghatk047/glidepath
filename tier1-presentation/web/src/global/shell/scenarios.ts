import type { Scenario } from '@glidepath/api-contract';
import type { ScenarioMenuItem, ScenarioOption } from '@glidepath/ui/shell';

/**
 * The scenario bar's props from `GET /scenarios`, in the order tier 2 sent them. Presentation
 * only: presets (`kind: preset`) are the segmented letters; `user` and `blend` scenarios are the
 * Custom group, `solver` scenarios the Paths group (IA §3). Archived scenarios are left out,
 * except the one on screen.
 */
export interface ScenarioBarModel {
  scenarios: ScenarioOption[];
  customs: ScenarioMenuItem[];
  paths: ScenarioMenuItem[];
}

/** One letter for a preset: its key when it is one letter (`A`…`D`), else its initial (`rates` → `R`). */
export const presetLetter = (key: string): string =>
  [...key].length === 1 ? key : key.charAt(0).toUpperCase();

/** A preset's name without the key prefix tier 2 may carry (`A. Commercial` → `Commercial`). */
export function presetName(key: string, label: string): string {
  const prefix = `${key}.`;
  return label.startsWith(prefix) ? label.slice(prefix.length).trim() || label : label;
}

export function scenarioBarModel(list: readonly Scenario[], current: string): ScenarioBarModel {
  const model: ScenarioBarModel = { scenarios: [], customs: [], paths: [] };
  for (const s of list) {
    if (s.archived && s.id !== current) continue;
    if (s.kind === 'preset')
      model.scenarios.push({
        id: s.id,
        letter: presetLetter(s.key),
        name: presetName(s.key, s.label),
      });
    else if (s.kind === 'solver') model.paths.push({ id: s.id, name: s.label });
    else model.customs.push({ id: s.id, name: s.label });
  }
  return model;
}
