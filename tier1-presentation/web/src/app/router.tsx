import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  notFound,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { ScenarioId, TenantSlug, type ApiClient } from '@glidepath/api-contract';
import { DataProvider, createDataClient, createServerState, type ServerState } from '../data';
import { GlobalLayout } from '../global/shell';
import { createSessionClient, type SessionClient } from '../session';
import { MODULE_IDS, isModuleId, loadModule, type ModuleId } from './modules';
import { parseViewSearch } from './search';
import { viewStore } from './view-store';

/**
 * Routes (07 §1, IA §1): `/:tenant/:scenario/:module` with `?lever ?group ?key ?node`.
 * Tenant, scenario and module live only in the URL, so a link is a shareable view.
 */

const lazyModules = Object.fromEntries(
  MODULE_IDS.map((id) => [id, lazy(() => loadModule(id))]),
) as Record<ModuleId, ReturnType<typeof lazy>>;

/**
 * What the screens talk to: the REST client and server-state cache (WEB-02) and the factory of
 * the one WS session per tenant (WEB-03). Tests pass doubles; the app uses the defaults.
 */
export interface AppServices {
  client: ApiClient;
  serverState: ServerState;
  createSession(tenant: string, scenario: string): SessionClient;
}

export const defaultAppServices = (): AppServices => ({
  client: createDataClient(),
  serverState: createServerState(),
  createSession: (tenant, scenario) => createSessionClient({ tenant, scenario }),
});

interface RouterContext {
  services: AppServices;
}

/**
 * The screen's one session client: created for the tenant (on the URL's scenario at that time),
 * closed on unmount or a tenant change. Scenario switches go through `open` (GlobalLayout).
 */
function useTenantSession(
  create: AppServices['createSession'],
  tenant: string,
  scenario: string,
): SessionClient | null {
  const [state, setState] = useState<{ tenant: string; session: SessionClient } | null>(null);
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  useEffect(() => {
    const session = create(tenant, scenarioRef.current);
    setState({ tenant, session });
    return () => session.close();
  }, [create, tenant]);
  return state?.tenant === tenant ? state.session : null;
}

function Root() {
  const { services } = rootRoute.useRouteContext();
  return (
    <DataProvider client={services.client} serverState={services.serverState}>
      <Outlet />
    </DataProvider>
  );
}

function ModuleScreen() {
  const { services } = rootRoute.useRouteContext();
  const { tenant, scenario, module } = moduleRoute.useParams();
  const search = moduleRoute.useSearch();
  const { lever, group, key, node } = search;
  useEffect(() => {
    viewStore.getState().syncSelection({ lever, group, key, node });
  }, [lever, group, key, node]);
  const session = useTenantSession(services.createSession, tenant, scenario);
  const Screen = lazyModules[module];
  const loading = <div className="gp-module-loading" aria-busy="true" />;
  if (!session) return loading;
  return (
    <GlobalLayout
      tenant={TenantSlug.parse(tenant)}
      scenarioId={ScenarioId.parse(scenario)}
      module={module}
      session={session}
    >
      <Suspense fallback={loading}>
        <Screen />
      </Suspense>
    </GlobalLayout>
  );
}

function NotFound() {
  return <p role="alert">Page not found.</p>;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
  validateSearch: parseViewSearch,
});

/** `/` has no tenant yet: tier 2 names the viewer's tenants (`/api/me`), a later item redirects. */
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });

const scenarioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$tenant/$scenario',
});

const scenarioIndexRoute = createRoute({
  getParentRoute: () => scenarioRoute,
  path: '/',
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/$tenant/$scenario/$module',
      params: { ...params, module: 'cockpit' },
      search,
      replace: true,
    });
  },
});

const moduleRoute = createRoute({
  getParentRoute: () => scenarioRoute,
  path: '$module',
  params: {
    parse: ({ module }) => {
      if (!isModuleId(module)) throw notFound();
      return { module };
    },
    stringify: ({ module }) => ({ module }),
  },
  component: ModuleScreen,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  scenarioRoute.addChildren([scenarioIndexRoute, moduleRoute]),
]);

export function createAppRouter(
  history?: RouterHistory,
  services: AppServices = defaultAppServices(),
) {
  return createRouter({
    routeTree,
    history,
    context: { services },
    // Only lever, group, key and node survive in the URL; anything else is dropped.
    search: { strict: true },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
