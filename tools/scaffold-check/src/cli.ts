import { resolve } from 'node:path';
import { checkScaffold } from './index';

const root = resolve(import.meta.dirname, '../../..');
const { missing, problems } = checkScaffold(root);
console.log(`scaffold-check: ${missing.length} missing, ${problems.length} problems`);
for (const m of missing) console.log(`  missing: ${m}`);
for (const p of problems) console.log(`  problem: ${p}`);
process.exit(missing.length + problems.length === 0 ? 0 : 1);
