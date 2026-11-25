// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { apiRoutes } from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { createDataClient, createServerState } from '../data';
import { createSessionClient } from '../session';
import { loadModule } from './modules';
import { createAppRouter } from './router';
import { viewStore } from './view-store';

/**
 * The real app tree (router -> DataProvider -> GlobalLayout -> module screen), the way `main.tsx`
 * builds it. The unit tests of each piece mount their own harness, which is how the unmounted
 * overlays and the missing tooltip went unnoticed (WEB-09, found by the E2E smoke).
 */

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const tenant = specFixtures.tenant;
const presets = specFixtures.scenarios.scenarios;
const SCENARIO = presetSnapshot('C').scenarioId;
const bundle = specFixtures.bundle;
const tenantRow = { ...fx.tenants.response.tenants[0]!, slug: tenant };

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined; // jsdom: the router restores scroll
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  viewStore.getState().closePanel?.('commandPalette');
});
afterAll(() => server.close());

async function mount() {
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () => HttpResponse.json({ tenants: [tenantRow] })),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(bundle)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => HttpResponse.json({ scenarios: presets })),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({
        scenarioId: String(params['id']),
        version: 0,
        inputs: [],
        overrides: [],
      }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({
        ...fx.scenarioCalc.response,
        scenarioId: String(params['id']),
        stale: false,
      }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json({ members: [] })),
    http.get(`${BASE}${apiRoutes.search.path}`, ({ request }) =>
      HttpResponse.json({ q: new URL(request.url).searchParams.get('q') ?? '', results: [] }),
    ),
  );
  const mock = createMockSession({ snapshots: presets.map((p) => presetSnapshot(p.key)) });
  const frames: (() => void)[] = [];
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/${tenant}/${SCENARIO}/levers`] }),
    {
      client: createDataClient({ baseUrl: BASE }),
      serverState: createServerState(),
      createSession: (t, s) =>
        createSessionClient({
          tenant: t,
          scenario: s,
          origin: 'ws://localhost:8080',
          connect: mock.connect,
          requestFrame: (cb) => void frames.push(cb),
          random: () => 0,
        }),
    },
  );
  await loadModule('levers');
  render(<RouterProvider router={router} />);
  const until = async (check: () => void) => {
    for (let i = 0; ; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
        await mock.flush();
      });
      act(() => {
        for (const cb of frames.splice(0)) cb();
      });
      try {
        check();
        return;
      } catch (e) {
        if (i > 60) throw e;
      }
    }
  };
  return { until };
}

describe('the app tree mounts the global overlays and the shared tooltip', () => {
  it('app_tree_cmdk_opens_the_palette', async () => {
    const t = await mount();
    await t.until(() =>
      expect(screen.getByRole('button', { name: /find any number/i })).toBeTruthy(),
    );
    expect(screen.queryByRole('dialog', { name: 'Find any number' })).toBeNull();

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await t.until(() =>
      expect(screen.getByRole('dialog', { name: 'Find any number' })).toBeTruthy(),
    );

    // and the shell's own button opens the same one
    fireEvent.keyDown(document, { key: 'Escape' });
    await t.until(() =>
      expect(screen.queryByRole('dialog', { name: 'Find any number' })).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: /find any number/i }));
    await t.until(() =>
      expect(screen.getByRole('dialog', { name: 'Find any number' })).toBeTruthy(),
    );
  });

  it('app_tree_mounts_exactly_one_tooltip', async () => {
    const t = await mount();
    await t.until(() =>
      expect(screen.getByRole('button', { name: /find any number/i })).toBeTruthy(),
    );
    expect(screen.getAllByRole('tooltip', { hidden: true })).toHaveLength(1);
  });
});

describe('fonts of the app tree (WEB-11)', () => {
  it('app_tree_every_control_resolves_to_the_token_font', async () => {
    const t = await mount();
    await t.until(() =>
      expect(screen.getByRole('button', { name: /find any number/i })).toBeTruthy(),
    );
    const css = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    const tokensCss = css('../../../ui/src/tokens/tokens.css');
    const fontsCss = css('./fonts.css');
    const appCss = css('./app.css');
    // the stylesheets the bundle ships: tokens, the self-hosted faces, the app base
    const style = document.createElement('style');
    style.textContent = [tokensCss, fontsCss, appCss].join('\n');
    document.head.append(style);
    const tokens = new Map(
      [...tokensCss.matchAll(/(--font-[a-z]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
    );
    // jsdom does not resolve `inherit` or `var()`, so the cascade is read here: the last matching
    // rule that sets `font-family` or the `font` shorthand wins (document order; the rules of
    // the shell are single-class, so specificity does not reorder them); no rule or `inherit`
    // = the parent's.
    const rules = [...document.styleSheets].flatMap((sheet) =>
      [...sheet.cssRules].filter((r): r is CSSStyleRule => 'selectorText' in r),
    );
    const familyOf = (el: Element | null): string => {
      if (!el) return '';
      let value: string | undefined;
      for (const r of rules) {
        if (!el.matches(r.selectorText)) continue;
        const text = r.cssText;
        const fam = /(?:^|[;{\s])font-family:\s*([^;}]+)/.exec(text);
        // shorthand: `weight size/line-height family`
        const short = /(?:^|[;{\s])font:\s*([^;}]+)/.exec(text);
        if (fam) value = fam[1]!.trim();
        else if (short) value = short[1]!.trim().replace(/^.*?\/[\d.]+\s+/, '');
      }
      // a control the page sets nothing on keeps the browser's own face (the serif fallback of WEB-11)
      if (value === undefined && el.matches('button, input, select, textarea')) return '(browser default)';
      if (value === undefined || /^inherit$/.test(value)) return familyOf(el.parentElement);
      return value.replace(/var\((--font-[a-z]+)\)/g, (_, k: string) => tokens.get(k) ?? '');
    };
    // one of each control kind with no class of its own: only the app base can give it the font
    for (const tag of ['button', 'input', 'select', 'textarea'])
      document.body.append(document.createElement(tag));
    const controls = [...document.querySelectorAll('button, input, select, textarea')];
    expect(controls.length).toBeGreaterThan(5);
    const bad = controls
      .map((el) => ({ el, family: familyOf(el) }))
      .filter(({ family }) => !/^Geist/.test(family))
      .map(({ el, family }) => `${el.tagName}.${el.className}: ${family || '(none)'}`);
    expect(bad).toEqual([]);
    style.remove();
  });
});
