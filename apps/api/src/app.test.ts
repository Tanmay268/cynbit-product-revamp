import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from './config/env.js';
import { baseEnv, healthyDeps, startTestApp } from './test-utils.js';

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

async function boot(...args: Parameters<typeof startTestApp>) {
  const t = await startTestApp(...args);
  closer = t.close;
  return t;
}

describe('health', () => {
  it('returns 200 when dependencies are up', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; checks: Record<string, string> } };
    expect(body.data.status).toBe('ok');
    expect(body.data.checks).toEqual({ database: 'up', redis: 'up' });
  });

  it('returns 503 and does not leak the error when a dependency is down', async () => {
    const { base } = await boot({
      health: {
        ...healthyDeps,
        checkDatabase: async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret');
        },
      },
    });
    const res = await fetch(`${base}/api/v1/health`);
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(JSON.parse(text).data.checks).toEqual({ database: 'down', redis: 'up' });
    expect(text).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5/);
  });
});

describe('error handling', () => {
  it('returns the standard envelope for unknown routes', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/v1/nope`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('returns 400 for malformed JSON', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/v1/anything`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"broken":',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('returns 413 for oversized bodies', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/v1/anything`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ x: 'a'.repeat(20_000) }),
    });
    expect(res.status).toBe(413);
  });

});

describe('security middleware', () => {
  it('sets Helmet headers and hides x-powered-by', async () => {
    const { base } = await boot();
    const res = await fetch(`${base}/api/v1/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('allows configured CORS origins only', async () => {
    const { base } = await boot();
    const ok = await fetch(`${base}/api/v1/health`, { headers: { Origin: 'http://localhost:5173' } });
    const bad = await fetch(`${base}/api/v1/health`, { headers: { Origin: 'https://evil.example' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rate limits /api/v1 but not health', async () => {
    const { base } = await boot({ env: { ...baseEnv, RATE_LIMIT_MAX: 2 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/api/v1/nope`)).status);
    expect(codes).toEqual([404, 404, 429, 429]);
    const limited = await fetch(`${base}/api/v1/nope`);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    expect((await fetch(`${base}/api/v1/health`)).status).toBe(200);
  });
});

describe('env', () => {
  const valid = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', REDIS_URL: 'redis://localhost:6379' };

  it('parses valid config and splits CORS origins', () => {
    const env = loadEnv({ ...valid, CORS_ORIGINS: 'http://a.com, http://b.com' } as NodeJS.ProcessEnv);
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
    expect(env.API_PORT).toBe(4000);
  });

  it('rejects missing/invalid values without echoing them', () => {
    expect(() => loadEnv({ DATABASE_URL: 'hunter2-not-a-url' } as NodeJS.ProcessEnv)).toThrow(
      /Invalid API environment/,
    );
    try {
      loadEnv({ DATABASE_URL: 'hunter2-not-a-url' } as NodeJS.ProcessEnv);
    } catch (e) {
      expect(String(e)).not.toContain('hunter2');
    }
  });
});
