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
}

const RevertParams = z.object({ tenant: TenantSlug, id: ChangesetId });

/** Core routes of 04 §3 (CON-01). Solver, export, import, AI and market routes are CON-03. */
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
