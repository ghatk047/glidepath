import { z } from 'zod';
import { ChangesetId, TenantSlug } from './ids';
import {
  ChangesetConflict,
  ChangesetHistoryQuery,
  ChangesetHistoryResponse,
  ChangesetRequest,
  ChangesetResult,
  RevertRequest,
  RevertResult,
} from './changeset';
import {
  BundleResponse,
  CalcResponse,
  CreateScenarioRequest,
  ExplainParams,
  ExplainQuery,
  ExplainResponse,
  InputsResponse,
  MeResponse,
  MembersResponse,
  PatchScenarioRequest,
  Scenario,
  ScenarioParams,
  ScenariosResponse,
  SearchQuery,
  SearchResponse,
  TenantParams,
  TenantsResponse,
} from './core';
import { QuickSolverRunRequest, SolverRun, SolverRunParams, SolverRunRequest } from './solvers';
import {
  ExportRequest,
  ExportResult,
  FileDownload,
  FileParams,
  Bytes,
  ImportApplyRequest,
  ImportApplyResult,
  ImportJob,
  ImportParams,
  ImportUploadQuery,
} from './excel';
import {
  ReconfigApplyRequest,
  ReconfigApplyResult,
  ReconfigJob,
  ReconfigParams,
  ReconfigRequest,
} from './ai';
import { MarketRefreshRequest, MarketRefreshResult } from './market';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * One REST route. Every non-2xx answer is a `Problem` (application/problem+json);
 * `errors` lists routes whose problem carries extra members.
 */
export interface RouteDef {
  method: HttpMethod;
  path: string;
  /** Status of a successful answer. */
  status: 200 | 201;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  errors?: Partial<Record<number, z.ZodType>>;
  /**
   * `bytes` (CON-03): the request body is a raw file upload (`application/octet-stream`),
   * `body` is `Bytes`. Absent = JSON.
   */
  requestType?: 'json' | 'bytes';
  /**
   * `bytes` (CON-03): the success body is a byte stream (the file, with its own content type),
   * `response` is `FileDownload`, built from the bytes and headers. Absent = JSON.
   */
  responseType?: 'json' | 'bytes';
}

const RevertParams = z.object({ tenant: TenantSlug, id: ChangesetId });

/** Core routes of 04 §3 (CON-01). Solver, export, import, AI and market routes: `jobRoutes`. */
export const coreRoutes = {
  me: { method: 'GET', path: '/api/me', status: 200, response: MeResponse },
  tenants: { method: 'GET', path: '/api/tenants', status: 200, response: TenantsResponse },
  bundle: {
    method: 'GET',
    path: '/api/t/:tenant/bundle',
    status: 200,
    params: TenantParams,
    response: BundleResponse,
  },
  members: {
    method: 'GET',
    path: '/api/t/:tenant/members',
    status: 200,
    params: TenantParams,
    response: MembersResponse,
  },
  scenarios: {
    method: 'GET',
    path: '/api/t/:tenant/scenarios',
    status: 200,
    params: TenantParams,
    response: ScenariosResponse,
  },
  scenarioCreate: {
    method: 'POST',
    path: '/api/t/:tenant/scenarios',
    status: 201,
    params: TenantParams,
    body: CreateScenarioRequest,
    response: Scenario,
  },
  scenarioPatch: {
    method: 'PATCH',
    path: '/api/t/:tenant/scenarios/:id',
    status: 200,
    params: ScenarioParams,
    body: PatchScenarioRequest,
    response: Scenario,
  },
  scenarioInputs: {
    method: 'GET',
    path: '/api/t/:tenant/scenarios/:id/inputs',
    status: 200,
    params: ScenarioParams,
    response: InputsResponse,
  },
  changesetApply: {
    method: 'POST',
    path: '/api/t/:tenant/changesets',
    status: 200,
    params: TenantParams,
    body: ChangesetRequest,
    response: ChangesetResult,
    errors: { 409: ChangesetConflict },
  },
  changesetRevert: {
    method: 'POST',
    path: '/api/t/:tenant/changesets/:id/revert',
    status: 200,
    params: RevertParams,
    body: RevertRequest,
    response: RevertResult,
    errors: { 409: ChangesetConflict },
  },
  changesetHistory: {
    method: 'GET',
    path: '/api/t/:tenant/scenarios/:id/changesets',
    status: 200,
    params: ScenarioParams,
    query: ChangesetHistoryQuery,
    response: ChangesetHistoryResponse,
  },
  scenarioCalc: {
    method: 'GET',
    path: '/api/t/:tenant/scenarios/:id/calc',
    status: 200,
    params: ScenarioParams,
    response: CalcResponse,
  },
  nodeExplain: {
    method: 'GET',
    path: '/api/t/:tenant/nodes/:cell/explain',
    status: 200,
    params: ExplainParams,
    query: ExplainQuery,
    response: ExplainResponse,
  },
  search: {
    method: 'GET',
    path: '/api/t/:tenant/search',
    status: 200,
    params: TenantParams,
    query: SearchQuery,
    response: SearchResponse,
  },
} as const satisfies Record<string, RouteDef>;

export type CoreRouteId = keyof typeof coreRoutes;
export type CoreRoute<Id extends CoreRouteId> = (typeof coreRoutes)[Id];

/**
 * Job, solver, Excel, AI and market routes of 04 §3 (CON-03), plus the file download of 04 §5.
 * Starting a job answers 201 with the job resource; progress then comes as WS `job` messages
 * (and from the `GET` route).
 */
export const jobRoutes = {
  solverRunStart: {
    method: 'POST',
    path: '/api/t/:tenant/solver-runs',
    status: 201,
    params: TenantParams,
    body: SolverRunRequest,
    response: SolverRun,
  },
  solverRunQuick: {
    method: 'POST',
    path: '/api/t/:tenant/solver-runs/quick',
    status: 200,
    params: TenantParams,
    body: QuickSolverRunRequest,
    response: SolverRun,
  },
  solverRunGet: {
    method: 'GET',
    path: '/api/t/:tenant/solver-runs/:id',
    status: 200,
    params: SolverRunParams,
    response: SolverRun,
  },
  solverRunCancel: {
    method: 'DELETE',
    path: '/api/t/:tenant/solver-runs/:id',
    status: 200,
    params: SolverRunParams,
    response: SolverRun,
  },
  exportCreate: {
    method: 'POST',
    path: '/api/t/:tenant/exports',
    status: 201,
    params: TenantParams,
    body: ExportRequest,
    response: ExportResult,
  },
  fileDownload: {
    method: 'GET',
    path: '/api/t/:tenant/files/:id',
    status: 200,
    params: FileParams,
    response: FileDownload,
    responseType: 'bytes',
  },
  importCreate: {
    method: 'POST',
    path: '/api/t/:tenant/imports',
    status: 201,
    params: TenantParams,
    query: ImportUploadQuery,
    body: Bytes,
    requestType: 'bytes',
    response: ImportJob,
  },
  importGet: {
    method: 'GET',
    path: '/api/t/:tenant/imports/:id',
    status: 200,
    params: ImportParams,
    response: ImportJob,
  },
  importApply: {
    method: 'POST',
    path: '/api/t/:tenant/imports/:id/apply',
    status: 200,
    params: ImportParams,
    body: ImportApplyRequest,
    response: ImportApplyResult,
  },
  aiReconfigStart: {
    method: 'POST',
    path: '/api/ai/reconfig',
    status: 201,
    body: ReconfigRequest,
    response: ReconfigJob,
  },
  aiReconfigGet: {
    method: 'GET',
    path: '/api/ai/reconfig/:id',
    status: 200,
    params: ReconfigParams,
    response: ReconfigJob,
  },
  aiReconfigApply: {
    method: 'POST',
    path: '/api/ai/reconfig/:id/apply',
    status: 200,
    params: ReconfigParams,
    body: ReconfigApplyRequest,
    response: ReconfigApplyResult,
  },
  marketRefresh: {
    method: 'POST',
    path: '/api/t/:tenant/market/refresh',
    status: 201,
    params: TenantParams,
    body: MarketRefreshRequest,
    response: MarketRefreshResult,
  },
} as const satisfies Record<string, RouteDef>;

export type JobRouteId = keyof typeof jobRoutes;
export type JobRoute<Id extends JobRouteId> = (typeof jobRoutes)[Id];

/**
 * Every REST route of the contract, by id: what `createClient()` and `assertContract()` cover:
 * the CON-01 core routes and the CON-03 job routes.
 */
export const apiRoutes = { ...coreRoutes, ...jobRoutes } as const satisfies Record<
  string,
  RouteDef
>;

export type ApiRouteId = keyof typeof apiRoutes;
export type ApiRoute<Id extends ApiRouteId> = (typeof apiRoutes)[Id];
