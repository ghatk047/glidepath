/**
 * `@glidepath/api-contract/testing`: fixtures and the mock session, for tests only.
 * Kept off the main entry so application bundles never carry the fixture JSON.
 */
export * from './specFixtures';
export * from './mockSession';
export {
  changesetConflictFixture,
  coreRouteFixtures,
  type CoreRouteFixtures,
} from '../fixtures/core';
export {
  clientMessageFixtures,
  coalescingFixture,
  frameErrorFixture,
  legacyPreviewFixture,
  normalisedLegacyPreviewFixture,
  openFixture,
  scratchLifecycleFixtures,
  serverMessageFixtures,
  sessionQueryFixture,
  viewMessageFixtures,
  viewProblemFixture,
} from '../fixtures/ws';
export {
  apiRouteFixtures,
  deltaReportFixture,
  jobRouteFixtures,
  solverProblemFixtures,
  solverRunFixtures,
  type ApiRouteFixtures,
  type JobRouteFixtures,
} from '../fixtures/jobs';
