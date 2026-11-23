import { lazy, Suspense, useEffect } from 'react';
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
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

function ModuleScreen() {
  const { module } = moduleRoute.useParams();
  const search = moduleRoute.useSearch();
  const { lever, group, key, node } = search;
  useEffect(() => {
    viewStore.getState().syncSelection({ lever, group, key, node });
  }, [lever, group, key, node]);
  const Screen = lazyModules[module];
  return (
    <Suspense fallback={<div className="gp-module-loading" aria-busy="true" />}>
      <Screen />
    </Suspense>
  );
}

function NotFound() {
  return <p role="alert">Page not found.</p>;
}

const rootRoute = createRootRoute({
  component: Outlet,
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

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
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
