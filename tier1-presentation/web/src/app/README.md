# app

SPA scaffold (WEB-01): Vite + React 19, TanStack Router, Zustand view store, one chunk per module.

- `main.tsx`: entry. Imports `tokens.css`, mounts the router, then preloads Cockpit, Levers and Path when idle.
- `router.tsx`: `/:tenant/:scenario/:module` with `?lever ?group ?key ?node`. `/:tenant/:scenario` goes to `cockpit`; an unknown module is not-found. Search values are spec ids, kept as strings (`search.ts`).
- `modules.ts`: the 8 module ids (from `AppModule` in `@glidepath/api-contract`), one dynamic import each (`src/modules/<id>/index.tsx`, default export), `PRELOADED_MODULES`.
- `view-store/`: Zustand store `selection` (mirrors the URL), `openPanels`, `drag`, `theme`, `editsCount` (stored as tier 2 reports it, never computed). `useViewStore(selector)` in components.
- Imports only `@glidepath/api-contract` and `@glidepath/ui` (G13). `ui` is imported by module sub-path (`@glidepath/ui/tokens`, `@glidepath/ui/motion`, `@glidepath/ui/tokens.css`).
- Build: `pnpm --filter @glidepath/web build` writes `dist/` with `.vite/manifest.json`; `build.test.ts` checks the 8 module chunks.
- Search sync: the module screen pushes the URL's selection into the store; the URL stays the source of truth.
- Global overlays (WEB-09): `ModuleScreen` mounts `<GlobalOverlays tenant scenarioId/>` as a child of `GlobalLayout` (it needs the layout's commit and bind providers) and passes `overlayController.openTrace` as `onTrace`; `Root` mounts the one shared `<Tooltip />`. `app-tree.test.tsx` drives ⌘K in this real tree.
