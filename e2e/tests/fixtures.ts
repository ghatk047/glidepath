import './trust-ca';
import { test as base, expect, type Page } from '@playwright/test';
import { apiAs, config, readRepoJson, signIn } from '@glidepath/int';
import type { Scenario } from '@glidepath/api-contract';
import type { GoldenFile } from '@glidepath/parity';

/**
 * Shared set-up of the G9 smoke: the INT sign-in (magic link caught by mailpit, ADR-014) handed to
 * the browser as cookies, the tenant's presets by letter, and the golden values by preset.
 */

export const golden = readRepoJson<GoldenFile>('docs', 'spec', 'reference', 'golden_results.json');
/** Cockpit headline cells (20_orchestrator Loop step 6), spec ids verbatim. */
export const HEADLINE = ['res.net', 'res.gap', 'res.risk', 'br.eps27'] as const;
export type Headline = (typeof HEADLINE)[number];

/** Golden value of `cell` (a spec id, verbatim) in preset `letter`. */
export function goldenOf(letter: string, cell: string): number {
  const scenario = golden.scenarios[letter] as Record<string, unknown> | undefined;
  const v = scenario?.[cell];
  if (typeof v !== 'number') throw new Error(`golden_results.json has no ${letter}.${cell}`);
  return v;
}

export interface Stack {
  /** Preset scenarios by letter (`A`..`D`). */
  presets: Map<string, Scenario>;
  /** Signs `page`'s context in as the seed's owner. */
  signInPage(page: Page): Promise<void>;
}

export const test = base.extend<object, { stack: Stack }>({
  stack: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const browser = await signIn();
      const { scenarios } = await apiAs(browser).scenarios({ params: { tenant: config.tenant } });
      const presets = new Map(scenarios.filter((s) => s.kind === 'preset').map((s) => [s.key, s]));
      // The cookies include the readable `gp_csrf`: the SPA itself echoes it as `x-csrf-token` (WEB-09).
      const cookies = browser.cookie.split('; ').map((pair) => {
        const at = pair.indexOf('=');
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: config.baseUrl };
      });
      await use({
        presets,
        signInPage: async (page) => {
          await page.context().addCookies(cookies);
        },
      });
    },
    { scope: 'worker' },
  ],
});

export { expect };
