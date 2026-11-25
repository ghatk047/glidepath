/** `pnpm warm --tenant aa` (also `--tenant=aa`). */
export function parseWarmArgs(argv: readonly string[]): { tenant: string } {
  let tenant: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const m = /^--tenant(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`warm: unknown argument ${arg} (usage: warm --tenant <slug>)`);
    const value = m[1] ?? argv[++i];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error('warm: --tenant needs a tenant slug');
    tenant = value;
  }
  if (tenant === undefined) throw new Error('warm: --tenant <slug> is required (usage: warm --tenant aa)');
  return { tenant };
}
