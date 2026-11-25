// OPS-03: the glidepath/web image definition and its multi-arch bake target
// (docs/architecture/11_docker_deployment.md sections 1, 2 and 5).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeConfigFromYaml, REPO_ROOT, writeTestEnvFile } from '../src/index';
import { BAKE_FILE, bakePrint, caddyImage, DOCKERFILE, read, WEB_DIR } from './web-helpers';

const dockerfile = read(DOCKERFILE);
const instructions = dockerfile
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

describe('bake target glidepath/web', () => {
  it('prints a web target with linux/arm64 and linux/amd64 for glidepath/web', () => {
    const plan = bakePrint('web');
    expect(plan.target.web.platforms.sort()).toEqual(['linux/amd64', 'linux/arm64']);
    expect(plan.target.web.tags).toEqual(['glidepath/web:dev']);
    expect(plan.target.web.dockerfile).toBe('ops/docker/web/Dockerfile');
    expect(plan.target.web.context).toBe('.');
  });

  it('tags follow TAG and an optional registry prefix, like compose', () => {
    const plan = bakePrint('web', { TAG: '1.2.3', REGISTRY: 'ghcr.io/acme/' });
    expect(plan.target.web.tags).toEqual(['ghcr.io/acme/glidepath/web:1.2.3']);
  });

  it('is the default bake group target', () => {
    expect(bakePrint('default').group.default.targets).toEqual(['web']);
  });

  it('builds what docker-compose.yml builds: same image name and Dockerfile', () => {
    const web = composeConfigFromYaml({ envFile: writeTestEnvFile() }).services.web!;
    expect(web.image).toBe(bakePrint('web').target.web.tags[0]);
    expect(read(join(REPO_ROOT, 'docker-compose.yml'))).toMatch(
      /dockerfile: ops\/docker\/web\/Dockerfile/,
    );
    expect(existsSync(join(REPO_ROOT, 'ops/docker/web/Dockerfile'))).toBe(true);
    expect(existsSync(BAKE_FILE)).toBe(true);
  });
});

describe('web Dockerfile', () => {
  it('builds the SPA in a pinned node stage and serves from a pinned caddy image', () => {
    const from = instructions.filter((l) => l.startsWith('FROM '));
    expect(from).toHaveLength(2);
    expect(from[0]).toMatch(/^FROM node:22\.\d+\.\d+-\S+ AS spa$/);
    expect(from[1]).toMatch(/^FROM caddy:2\.\d+\.\d+-alpine$/);
    expect(caddyImage()).toMatch(/^caddy:2\.\d+\.\d+-alpine$/);
    expect(dockerfile).not.toMatch(/:latest\b/);
  });

  it('runs Caddy as a non-root user', () => {
    const user = instructions.filter((l) => l.startsWith('USER '));
    expect(user).toEqual(['USER glidepath']);
  });

  it('copies the Caddyfile and the SPA, and nothing from tier 2 or tier 3', () => {
    expect(dockerfile).toMatch(/COPY .*ops\/docker\/web\/Caddyfile \/etc\/caddy\/Caddyfile/);
    expect(dockerfile).toMatch(/COPY --from=spa .* \/out \/srv/);
    expect(dockerfile).not.toMatch(/tier2-logic|tier3-data/);
  });

  it('bakes in no setting, secret or credential (config is environment only)', () => {
    expect(instructions.filter((l) => /^ARG\s/.test(l))).toEqual([]);
    const envs = instructions.filter((l) => /^ENV\s/.test(l)).join('\n');
    expect(envs).not.toMatch(/SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL/i);
  });

  it('has a healthcheck against the loopback listener of the Caddyfile', () => {
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*http:\/\/127\.0\.0\.1:2020\/healthz/);
    expect(read(join(WEB_DIR, 'Caddyfile'))).toMatch(/http:\/\/127\.0\.0\.1:2020 \{/);
  });

  it('keeps the SPA build ready for Vite: build-spa.sh builds the web package when it has a build script', () => {
    const script = read(join(WEB_DIR, 'build-spa.sh'));
    expect(script).toMatch(/pnpm --filter "\$pkg\.\.\." --if-present run build/);
    expect(script).toMatch(/dist\/index\.html/);
    expect(existsSync(join(WEB_DIR, 'placeholder/index.html'))).toBe(true);
    expect(read(join(WEB_DIR, 'placeholder/index.html'))).not.toMatch(/<script|https?:\/\//);
  });
});

describe('web Dockerfile.dockerignore', () => {
  const ignore = read(join(WEB_DIR, 'Dockerfile.dockerignore'))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it.each(['.env', '.env.*', 'tier2-logic', 'tier3-data', 'docs', '**/node_modules', '.git'])(
    'excludes %s from the build context',
    (entry) => {
      expect(ignore).toContain(entry);
    },
  );

  it('keeps .env.example (a template, no secrets)', () => {
    expect(ignore).toContain('!.env.example');
  });
});
