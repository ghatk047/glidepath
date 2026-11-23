// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import axe from 'axe-core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ExcelSheet,
  ScenarioId,
  TenantSlug,
  apiRoutes,
  type ExportRequest,
  type ImportApplyRequest,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  deltaReportFixture,
  jobRouteFixtures,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { viewStore } from '../../app/view-store';
import { DataProvider, createDataClient, createServerState } from '../../data';
import { GlobalLayout } from '../../global/shell';
import { createSessionClient } from '../../session';
import Excel from './index';

const BASE = 'http://tier2.test';
const fx = coreRouteFixtures;
const jx = jobRouteFixtures;
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const PRESET_C = ScenarioId.parse(C.scenarioId);
const presets = specFixtures.scenarios.scenarios.filter((s) => s.kind === 'preset');
const idOf = (key: string) => presets.find((s) => s.key === key)!.id;

const server = setupServer();
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.scrollTo = () => undefined;
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  viewStore.getState().setTheme('cruise');
});
afterAll(() => server.close());

/** A report with every row kind: conflict, changed, new line, removal, invalid. */
const report = {
  ...deltaReportFixture,
  summary: { ...deltaReportFixture.summary, new_rows: 1, deleted_rows: 1, invalid: 0 },
  changes: [
    ...deltaReportFixture.changes.slice().reverse(), // conflict first in the file, changed second
    {
      sheet: 'Line_Items',
      key: '',
      member: '',
      scenario: null,
      export: null,
      workbook: 1.2,
      current: null,
      status: 'new_row',
      messages: [],
    },
    {
      sheet: 'Line_Items',
      key: 'line.amount',
      member: '',
      scenario: null,
      export: 4,
      workbook: null,
      current: 4,
      status: 'deleted_row',
      messages: [],
    },
    {
      sheet: 'Levers',
      key: 'lev.L05.nb',
      member: '',
      scenario: 'D',
      export: 1,
      workbook: 1,
      current: 1,
      status: 'unchanged',
      messages: [],
    },
  ],
} as unknown as typeof deltaReportFixture;
// Put the plain change ahead of the conflict so "conflicts first" is the view's doing.
report.changes = [
  report.changes.find((c) => c.status === 'changed_in_excel')!,
  ...report.changes.filter((c) => c.status !== 'changed_in_excel'),
];

const exportResult = {
  ...jx.exportCreate.response,
  scenarioIds: [idOf('C'), idOf('D')],
  file: { ...jx.exportCreate.response.file, filename: 'zz_it_savings_C-D_20261204-0930.xlsx' },
  createdAt: '2026-12-04T09:30:00.000Z',
};
const job = (over: object = {}) => ({
  ...jx.importGet.response,
  exportId: exportResult.id,
  report,
  ...over,
});

interface Served {
  exportBodies: ExportRequest[];
  uploads: { filename: string | null; bytes: Uint8Array }[];
  applies: ImportApplyRequest[];
  downloads: string[];
}

function serve(importResponses: object[] = [job()]): Served {
  const served: Served = { exportBodies: [], uploads: [], applies: [], downloads: [] };
  let polls = 0;
  server.use(
    http.get(`${BASE}${apiRoutes.me.path}`, () => HttpResponse.json(fx.me.response)),
    http.get(`${BASE}${apiRoutes.tenants.path}`, () =>
      HttpResponse.json({ tenants: [{ ...fx.tenants.response.tenants[0]!, slug: tenant }] }),
    ),
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => HttpResponse.json(specFixtures.bundle)),
    http.get(`${BASE}${apiRoutes.members.path}`, () => HttpResponse.json(specFixtures.members)),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () =>
      HttpResponse.json({ scenarios: specFixtures.scenarios.scenarios }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) =>
      HttpResponse.json({
        scenarioId: String(params['id']),
        version: 0,
        inputs: [],
        overrides: [],
      }),
    ),
    http.get(`${BASE}${apiRoutes.scenarioCalc.path}`, ({ params }) =>
      HttpResponse.json({ ...fx.scenarioCalc.response, scenarioId: String(params['id']) }),
    ),
    http.get(`${BASE}${apiRoutes.changesetHistory.path}`, ({ params }) =>
      HttpResponse.json({ scenarioId: String(params['id']), changesets: [], nextCursor: null }),
    ),
    http.post(`${BASE}${apiRoutes.exportCreate.path}`, async ({ request }) => {
      served.exportBodies.push((await request.json()) as ExportRequest);
      return HttpResponse.json(exportResult, { status: 201 });
    }),
    http.get(`${BASE}${apiRoutes.fileDownload.path}`, ({ params }) => {
      served.downloads.push(String(params['id']));
      return new HttpResponse(jx.fileDownload.response.bytes as BodyInit, {
        headers: {
          'content-type': jx.fileDownload.response.contentType,
          'content-disposition': `attachment; filename="${exportResult.file.filename}"`,
        },
      });
    }),
    http.post(`${BASE}${apiRoutes.importCreate.path}`, async ({ request }) => {
      served.uploads.push({
        filename: new URL(request.url).searchParams.get('filename'),
        bytes: new Uint8Array(await request.arrayBuffer()),
      });
      return HttpResponse.json(
        { ...job(), status: null, progress: 0, report: null, ignored: { sheets: [], columns: [] } },
        { status: 201 },
      );
    }),
    http.get(`${BASE}${apiRoutes.importGet.path}`, () => {
      const next = importResponses[Math.min(polls, importResponses.length - 1)];
      polls += 1;
      return HttpResponse.json(next);
    }),
    http.post(`${BASE}${apiRoutes.importApply.path}`, async ({ request }) => {
      served.applies.push((await request.json()) as ImportApplyRequest);
      return HttpResponse.json(jx.importApply.response);
    }),
  );
  return served;
}

async function mount(importResponses?: object[]) {
  const served = serve(importResponses);
  const mock = createMockSession({ views: [] });
  const frames: (() => void)[] = [];
  const session = createSessionClient({
    tenant,
    scenario: PRESET_C,
    origin: 'ws://localhost:8080',
    connect: mock.connect,
    requestFrame: (cb) => void frames.push(cb),
    random: () => 0,
  });
  function Screen() {
    return (
      <GlobalLayout
        tenant={tenant}
        scenarioId={PRESET_C}
        module="excel"
        session={session}
        glass={{ frameSampling: false }}
      >
        <Excel />
      </GlobalLayout>
    );
  }
  const rootRoute = createRootRoute({ component: Outlet });
  const moduleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '$tenant/$scenario/$module',
    component: Screen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([moduleRoute]),
    history: createMemoryHistory({ initialEntries: [`/${tenant}/${PRESET_C}/excel`] }),
  });
  const view = render(
    <DataProvider client={createDataClient({ baseUrl: BASE })} serverState={createServerState()}>
      <RouterProvider router={router as never} />
    </DataProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await mock.flush();
  });
  await screen.findByRole('button', { name: 'Export workbook' });
  // Wait for the scenario list so the export choice resolves to ids.
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Export workbook' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  return { ...served, view };
}

const file = (name = exportResult.file.filename) =>
  new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
    type: 'application/octet-stream',
  });

async function upload(name?: string) {
  const input = screen.getByLabelText('Workbook file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file(name)] } });
  await screen.findByRole('table', { name: 'Import review' }, { timeout: 4000 });
}

describe('AC1: export', () => {
  it('scenario choice C, D, C + D, all five; the 11 editable sheets as chips; file name preview; Export workbook posts and downloads via the files route', async () => {
    const created = vi.fn(() => 'blob:xl');
    URL.createObjectURL = created;
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    const t = await mount();

    const group = screen.getByRole('group', { name: 'Scenarios to export' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['C', 'D', 'C + D', 'All five']);
    const chips = within(screen.getByRole('group', { name: 'Sheets to export' })).getAllByRole(
      'button',
    );
    expect(chips).toHaveLength(11);
    expect(chips.map((c) => c.textContent)).toEqual(
      ExcelSheet.options.filter((s) => !s.startsWith('_')),
    );

    // file name preview follows the scenario choice
    expect(screen.getByTestId('export-filename').textContent).toBe(
      `${tenant}_it_savings_C-D_{yyyymmdd-hhmm}.xlsx`,
    );
    fireEvent.click(within(group).getByRole('button', { name: 'D' }));
    expect(screen.getByTestId('export-filename').textContent).toContain('_it_savings_D_');
    fireEvent.click(within(group).getByRole('button', { name: 'All five' }));
    expect(screen.getByTestId('export-filename').textContent).toContain(
      `_it_savings_${presets.map((p) => p.key).join('-')}_`,
    );
    fireEvent.click(within(group).getByRole('button', { name: 'C + D' }));

    fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }));
    await waitFor(() => expect(clicks).toEqual([exportResult.file.filename]));
    expect(t.exportBodies).toEqual([{ scenarioIds: [idOf('C'), idOf('D')] }]);
    expect(t.downloads).toEqual([exportResult.file.id]);
    expect(created).toHaveBeenCalledTimes(1);
    // tier 2's name and template version replace the preview
    expect(screen.getByTestId('export-filename').textContent).toBe(exportResult.file.filename);
    expect(screen.getByTestId('template-version').textContent).toBe(
      `template v${exportResult.templateVersion}`,
    );
  });

  it('a sheet subset and all five scenarios go in the request', async () => {
    URL.createObjectURL = () => 'blob:xl';
    URL.revokeObjectURL = () => undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const t = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'All five' }));
    fireEvent.click(screen.getByRole('button', { name: 'Outputs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export workbook' }));
    await waitFor(() => expect(t.exportBodies).toHaveLength(1));
    expect(t.exportBodies[0]!.scenarioIds).toEqual(presets.map((p) => p.id));
    expect(t.exportBodies[0]!.sheets).toEqual(
      ExcelSheet.options.filter((s) => !s.startsWith('_') && s !== 'Outputs'),
    );
  });
});

describe('AC2: import review', () => {
  it('drop file posts imports, polls, then shows the file card, summary chips and conflicts first', async () => {
    const t = await mount([{ ...job(), status: null, report: null, progress: 0 }, job()]);
    const zone = screen.getByTestId('drop-zone');
    const dropped = file();
    fireEvent.drop(zone, { dataTransfer: { files: [dropped] } });
    await screen.findByRole('table', { name: 'Import review' }, { timeout: 4000 });

    expect(t.uploads).toHaveLength(1);
    expect(t.uploads[0]!.filename).toBe(dropped.name);
    expect([...t.uploads[0]!.bytes]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const header = screen.getByRole('heading', { level: 2, name: /Import review/ }).parentElement!;
    // 4 rows to review (conflict, changed, new, removed); 1 conflict; 0 errors
    expect(header.textContent).toContain('4 changes');
    expect(header.textContent).toContain('1 conflict');
    expect(header.textContent).toContain('0 errors');
    expect(screen.getByText(/compared three ways: export, file, app now/)).toBeTruthy();

    const body = screen.getByRole('table', { name: 'Import review' }).querySelector('tbody')!;
    const statuses = [...body.querySelectorAll('tr')].map((r) => r.getAttribute('data-status'));
    expect(statuses).toEqual(['conflict', 'new', 'removed', 'ok']);
    const conflict = body.querySelector('tr')!;
    expect(within(conflict).getByText('Targets')).toBeTruthy();
    // exported, in file and app now values come from the report
    const cells = [...conflict.querySelectorAll('td')].map((c) => c.textContent);
    expect(cells[0]).toBe('Targets');
    expect(cells[2]).toContain('140');
    expect(cells[3]).toContain('150');
    expect(cells[4]).toContain('145');
  });

  it('a foreign file says so on the card', async () => {
    await mount([
      job({
        exportId: null,
        report: {
          ...report,
          mode: 'foreign',
          export_job_id: null,
          changes: report.changes.map((c) => ({ ...c, export: null })),
        },
      }),
    ]);
    await upload('someone_else.xlsx');
    expect(screen.getByText(/Foreign file/)).toBeTruthy();
    expect(screen.queryByText(/compared three ways/)).toBeNull();
  });
});

describe('AC3: take, new line, removals, validation, impact, apply', () => {
  it('File / App per conflict, new line chip, DELETE removal, validation line, Preview impact, Apply as changeset', async () => {
    const t = await mount([
      job({
        violations: [],
      }),
    ]);
    await upload();

    const conflict = document.querySelector<HTMLElement>('tr[data-status="conflict"]')!;
    const seg = within(conflict).getByRole('group', { name: /Take for/ });
    expect(within(seg).getByRole('button', { name: 'File' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(within(seg).getByRole('button', { name: 'App' }));
    expect(within(seg).getByRole('button', { name: 'App' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    const added = document.querySelector<HTMLElement>('tr[data-status="new"]')!;
    expect(within(added).getByText('new line')).toBeTruthy();
    const removed = document.querySelector<HTMLElement>('tr[data-status="removed"]')!;
    expect(within(removed).getByText(/removed/)).toBeTruthy();
    expect(removed.querySelector('del')).not.toBeNull();
    // switch the plain change off: it is kept as the app value
    const plain = document.querySelector<HTMLElement>('tr[data-status="ok"]')!;
    fireEvent.click(within(plain).getByRole('switch'));

    expect(screen.getByTestId('validation-line').textContent).toBe('Validation VR01–VR10 passed');

    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }));
    const impact = screen.getByTestId('impact');
    for (const id of ['res.net', 'res.gap', 'br.eps27']) {
      expect(impact.querySelector(`[data-node="${id}"]`)).not.toBeNull();
    }

    fireEvent.click(screen.getByRole('button', { name: /Apply as changeset/ }));
    await waitFor(() => expect(t.applies).toHaveLength(1));
    const body = t.applies[0]!;
    expect(body.accept).toBe('all');
    const conflictChange = report.changes.find((c) => c.status === 'conflict')!;
    const plainChange = report.changes.find((c) => c.status === 'changed_in_excel')!;
    expect(body.decisions).toEqual([
      {
        sheet: conflictChange.sheet,
        key: conflictChange.key,
        member: conflictChange.member,
        scenario: conflictChange.scenario,
        take: 'app',
      },
      {
        sheet: plainChange.sheet,
        key: plainChange.key,
        member: plainChange.member,
        scenario: plainChange.scenario,
        take: 'app',
      },
    ]);
    await screen.findByText(/Applied as changeset/);
  });

  it('a conflict left on File is sent as take excel; rule violations replace the validation line', async () => {
    const violation = {
      rule: 'VR03',
      cells: [],
      severity: 'warning',
      message: 'Org_Map rows for one domain do not sum to 100%.',
    };
    const t = await mount([job({ violations: [violation] })]);
    await upload();
    expect(screen.getByTestId('validation-line').textContent).toContain(violation.message);
    fireEvent.click(screen.getByRole('button', { name: /Apply as changeset/ }));
    await waitFor(() => expect(t.applies).toHaveLength(1));
    expect(t.applies[0]!.decisions).toEqual([
      expect.objectContaining({ key: 'g.target_net', take: 'excel' }),
    ]);
  });

  it('error rows block Apply and show the report messages', async () => {
    const bad = {
      sheet: 'Levers',
      key: 'lev.L05.nb',
      member: '',
      scenario: 'C',
      export: 0.6,
      workbook: 'abc',
      current: 0.6,
      status: 'invalid',
      messages: ['Not a number.'],
    };
    await mount([
      job({
        report: {
          ...report,
          summary: { ...report.summary, invalid: 1 },
          changes: [...report.changes, bad],
        },
      }),
    ]);
    await upload();
    expect(screen.getByRole('list', { name: 'Rows with errors' }).textContent).toContain(
      'Not a number.',
    );
    expect(screen.getByText('1 error')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Apply as changeset/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('AC4: no parsing or diffing in tier 1', () => {
  it('sources import no workbook library and compute nothing', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.'));
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/exceljs|xlsx['"]|sheetjs|jszip/i);
      expect(src, f).not.toMatch(/Math\.|toFixed|toLocaleString|Intl\.|\.reduce\(/);
    }
  });
});

describe('G12: accessibility', () => {
  it('has no serious or critical axe violations in the review state', async () => {
    const t = await mount();
    await upload();
    expect(t.uploads).toHaveLength(1);
    const result = await axe.run(t.view.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    const bad = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });
});
