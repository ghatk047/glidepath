/**
 * `@glidepath/api-contract/testing`: fixtures and the mock session, for tests only.
 * Kept off the main entry so application bundles never carry the fixture JSON.
 */
export * from './specFixtures';
export * from './mockSession';
export { coreRouteFixtures, type CoreRouteFixtures } from '../fixtures/core';
export {
  clientMessageFixtures,
  coalescingFixture,
  serverMessageFixtures,
  sessionQueryFixture,
  viewMessageFixtures,
  viewProblemFixture,
} from '../fixtures/ws';
