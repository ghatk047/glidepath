export const packageName = '@glidepath/testkit';

export { withTestDatabase } from './db';
export type { TestDatabase, TestDatabaseOptions, TestSeed } from './db';

export { golden, goldenEntries, goldenScenarios, goldenDeltaV03, goldenFile, closeToGolden } from './golden';
export type { GoldenFile } from './golden';

export { aaSeed, aaTenantData, aaScenarioIds, aaDefaultScenario, aaMembers, specBundle } from './seed';

export {
  fixturesDir,
  fixtureIndex,
  listFixtures,
  fixtureFilesOnDisk,
  fixturePath,
  readFixture,
} from './fixtures';
export type { FixtureEntry, FixtureIndex } from './fixtures';

export { fictitiousUsers, insertFictitiousUsers, FICTITIOUS_EMAIL_DOMAIN } from './users';
export type { FictitiousUser } from './users';

export { repoRoot, specDir, aaSeedDir, goldenResultsPath, excelFixturesDir } from './paths';
