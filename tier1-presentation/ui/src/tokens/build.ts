import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateCss, generateTs, type TokensJson } from './generate';

export const tokensJsonPath = fileURLToPath(
  new URL('../../../../docs/ux/tokens.json', import.meta.url),
);

export function readTokens(): TokensJson {
  return JSON.parse(readFileSync(tokensJsonPath, 'utf8')) as TokensJson;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const t = readTokens();
  writeFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), generateCss(t));
  writeFileSync(fileURLToPath(new URL('./tokens.generated.ts', import.meta.url)), generateTs(t));
  console.log('tokens: wrote tokens.css and tokens.generated.ts');
}
