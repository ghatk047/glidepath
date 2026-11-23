import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODULE_IDS,
  PRELOADED_MODULES,
  isModuleId,
  moduleLoaders,
  schedulePreload,
} from './modules';

afterEach(() => vi.restoreAllMocks());

describe('module registry', () => {
  it('knows the 8 module ids and nothing else', () => {
    expect(MODULE_IDS.every(isModuleId)).toBe(true);
    expect(isModuleId('settings')).toBe(false);
    expect(Object.keys(moduleLoaders).sort()).toEqual([...MODULE_IDS].sort());
  });

  it('preloads only cockpit, levers and path, once the scheduler fires', async () => {
    const spies = MODULE_IDS.map((id) => [id, vi.spyOn(moduleLoaders, id)] as const);
    const called = () => spies.filter(([, s]) => s.mock.calls.length > 0).map(([id]) => id);
    let run: (() => void) | undefined;
    schedulePreload((cb) => (run = cb));
    expect(called()).toEqual([]);
    run!();
    expect([...called()].sort()).toEqual([...PRELOADED_MODULES].sort());
  });
});
