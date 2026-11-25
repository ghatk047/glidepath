export const packageName = '@glidepath/tier-check';

export { deriveDenylist, exportedValueNames, listPackages } from './denylist';
export type { Denylist, PackageInfo } from './denylist';
export { scanBundle, scanText } from './scan';
export type { Finding, FindingKind, ScanResult } from './scan';
export { runTierCheck, DEFAULT_BUNDLE_DIR, EXIT_CLEAN, EXIT_LEAK, EXIT_ERROR } from './check';
export type { CheckOptions, CheckResult } from './check';
