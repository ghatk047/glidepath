import { checkMigrations, writeMigrations } from './generate';

const mode = process.argv[2] ?? 'generate';
if (mode === 'check') {
  const r = checkMigrations();
  if (!r.ok) {
    for (const p of r.problems) console.error(`gen-schema: ${p}`);
    process.exit(1);
  }
  console.log('gen-schema: tier3-data/migrations is up to date with schema.json');
} else if (mode === 'generate') {
  for (const f of writeMigrations()) console.log(`gen-schema: wrote tier3-data/migrations/${f}`);
} else {
  console.error('usage: cli.ts [generate|check]');
  process.exit(2);
}
