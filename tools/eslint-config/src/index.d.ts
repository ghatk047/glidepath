import type { Linter } from 'eslint';

export const SOURCE_GLOB: string;
export const TEST_GLOBS: string[];
export const dependencyMatrix: Record<string, string[]>;
export const dbPackages: string[];
export const airlineWords: string[];
export const airlineExemptGlobs: string[];
export function createConfig(options?: { magicNumberAllow?: number[] }): Linter.Config[];
declare const config: Linter.Config[];
export default config;
