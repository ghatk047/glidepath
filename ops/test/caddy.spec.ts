/* eslint-disable @typescript-eslint/no-explicit-any -- parsed Caddy JSON is untyped */
// OPS-03: the web tier's Caddyfile (docs/architecture/11_docker_deployment.md section 1).
// Acceptance lines: Caddyfile serves the SPA with history fallback and proxies /api/* and
// /ws/* to logic:8080 with local TLS via the internal CA (`caddy validate` + adapted config);
// CSP without unsafe-eval and with no external origins.
import { describe, expect, it } from 'vitest';
import { adapt, adaptedCsp, CADDYFILE, caddy, findAll, parseCsp, read } from './web-helpers';

/** Routes (flattened out of Caddy's nested subroutes) that match `path`. */
function routesFor(config: unknown, path: string) {
  return findAll(
    config,
    (o) => Array.isArray(o.match) && o.match.some((m: any) => m.path?.includes(path)),
  );
}

describe('web Caddyfile: caddy validate', () => {
  it('is a valid configuration with the default site address', () => {
    const r = caddy('validate');
    expect(r.status, r.stderr).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Valid configuration/);
  });

  it('is valid for a cloud hostname in PUBLIC_BASE_URL', () => {
    const r = caddy('validate', { PUBLIC_BASE_URL: 'https://glidepath.example.test' });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('web Caddyfile: routing', () => {
  const config = adapt();

  it('serves the site address from PUBLIC_BASE_URL, default https://localhost', () => {
    expect(read(CADDYFILE)).toMatch(/^\{\$PUBLIC_BASE_URL:https:\/\/localhost\} \{/m);
    const hosts = findAll(config, (o) => Array.isArray(o.host)).flatMap((o) => o.host as string[]);
    expect(hosts).toContain('localhost');
    const other = adapt({ PUBLIC_BASE_URL: 'https://glidepath.example.test' });
    expect(
      findAll(other, (o) => Array.isArray(o.host)).flatMap((o) => o.host as string[]),
    ).toContain('glidepath.example.test');
  });

  it.each(['/api/*', '/ws/*'])('proxies %s to logic:8080 and nothing else', (path) => {
    const routes = routesFor(config, path);
    expect(routes, path).toHaveLength(1);
    const proxies = findAll(routes[0], (o) => o.handler === 'reverse_proxy');
    expect(proxies).toHaveLength(1);
    expect(proxies[0]!.upstreams).toEqual([{ dial: 'logic:8080' }]);
    // No file serving under a proxied prefix.
    expect(findAll(routes[0], (o) => o.handler === 'file_server')).toHaveLength(0);
  });

  it('upgrades WebSocket: reverse_proxy has no transport that would block the handshake', () => {
    // Caddy's reverse_proxy forwards Connection/Upgrade itself; a custom transport or
    // header_up rewrite of them would break it, so the route must not carry either.
    const text = read(CADDYFILE);
    expect(text).not.toMatch(/header_up\s+(Connection|Upgrade)/i);
    expect(text).not.toMatch(/^\s*transport\s/m);
  });

  it('serves the SPA with history fallback to /index.html from /srv', () => {
    const tryFiles = findAll(config, (o) => !!o.file?.try_files).map((o) => o.file.try_files);
    expect(tryFiles).toEqual([['{http.request.uri.path}', '/index.html']]);
    const roots = findAll(config, (o) => o.handler === 'vars' && o.root).map((o) => o.root);
    expect(new Set(roots)).toEqual(new Set(['/srv']));
    expect(findAll(config, (o) => o.handler === 'file_server').length).toBeGreaterThanOrEqual(2);
  });

  it('answers a missing hashed asset with a 404, never index.html', () => {
    const routes = routesFor(config, '/assets/*');
    expect(routes).toHaveLength(1);
    expect(findAll(routes[0], (o) => !!o.file?.try_files)).toHaveLength(0);
    expect(findAll(routes[0], (o) => o.handler === 'file_server')).toHaveLength(1);
  });

  it('keeps index.html uncached and hashed assets immutable', () => {
    const text = read(CADDYFILE);
    expect(text).toMatch(/Cache-Control "no-cache"/);
    expect(text).toMatch(/Cache-Control "public, max-age=31536000, immutable"/);
  });

  it('exposes a loopback-only health listener that is not the public site', () => {
    const servers = (config as any).apps.http.servers as Record<string, { listen: string[] }>;
    const loopback = Object.values(servers).filter((s) =>
      s.listen.every((l) => l.startsWith('127.0.0.1:')),
    );
    expect(loopback.map((s) => s.listen)).toEqual([['127.0.0.1:2020']]);
    expect(
      findAll(loopback[0], (o) => o.handler === 'static_response' && o.status_code === 200),
    ).toHaveLength(1);
  });
});

describe('web Caddyfile: local TLS via the internal CA', () => {
  it('issues the site certificate from Caddy internal CA (`tls internal`)', () => {
    expect(read(CADDYFILE)).toMatch(/^\s*tls internal$/m);
    const config = adapt();
    const issuers = findAll(config, (o) => o.module === 'internal');
    expect(issuers.length).toBeGreaterThanOrEqual(1);
    const subjects = findAll(config, (o) => Array.isArray(o.subjects)).flatMap(
      (o) => o.subjects as string[],
    );
    expect(subjects).toContain('localhost');
  });

  it('never asks a public CA (no acme or email directive)', () => {
    const text = read(CADDYFILE);
    expect(text).not.toMatch(/^\s*(acme_ca|email)\b/m);
    expect(findAll(adapt(), (o) => o.module === 'acme')).toHaveLength(0);
  });
});

describe('web Caddyfile: security headers and CSP', () => {
  const config = adapt();
  const [csp = ''] = adaptedCsp(config);
  const directives = parseCsp(csp);

  it('sets exactly one Content-Security-Policy for the site', () => {
    expect(adaptedCsp(config)).toHaveLength(1);
  });

  it('has no unsafe-eval, no wildcard and no inline script', () => {
    expect(csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
    expect(csp).not.toContain('*');
    expect(directives.get('script-src')).toEqual(["'self'"]);
  });

  it('allows no external origin: every source is self, data:, blob: or the page own ws(s) host', () => {
    const allowed = new Set(["'self'", "'none'", 'data:', 'blob:']);
    const own = /^wss?:\/\/\{http\.request\.hostport\}$/;
    for (const [name, sources] of directives) {
      for (const s of sources) {
        // Inline styles only (Radix and Motion set style attributes/elements); never scripts.
        const inlineStyle = name === 'style-src' && s === "'unsafe-inline'";
        expect(allowed.has(s) || own.test(s) || inlineStyle, `${name}: ${s}`).toBe(true);
      }
    }
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it('locks down defaults', () => {
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'self'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('connect-src')).toContain("'self'");
  });

  it('sets the standard hardening headers and hides the server banner', () => {
    const [h] = findAll(
      config,
      (o) => o.handler === 'headers' && !!o.response?.set?.['Content-Security-Policy'],
    );
    expect(h!.response.set['X-Content-Type-Options']).toEqual(['nosniff']);
    expect(h!.response.set['X-Frame-Options']).toEqual(['DENY']);
    expect(h!.response.set['Referrer-Policy']).toEqual(['no-referrer']);
    expect(h!.response.delete).toEqual(['Server']);
  });

  it('references no external host anywhere in the Caddyfile', () => {
    const text = read(CADDYFILE)
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    const urls = [...text.matchAll(/https?:\/\/[^\s"']+/g)].map((m) => m[0]);
    expect(urls.sort()).toEqual(['http://127.0.0.1:2020', 'https://localhost}'].sort());
  });
});
