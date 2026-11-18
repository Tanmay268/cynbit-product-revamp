import { afterEach, describe, expect, it } from 'vitest';
import { LeadService } from '../services/lead-service.js';
import { InMemoryLeadRepository, baseEnv, createTestAuditService, startTestApp } from '../test-utils.js';

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

async function boot(opts: Parameters<typeof createTestAuditService>[0] = {}, env = baseEnv) {
  const ctx = createTestAuditService(opts);
  const { createApp } = await import('../app.js');
  const { healthyDeps } = await import('../test-utils.js');
  const app = createApp({ env, health: healthyDeps, audits: ctx.service, leads: new LeadService({ repo: new InMemoryLeadRepository() }), logger: { error: () => undefined } });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as import('node:net').AddressInfo).port;
  closer = () => new Promise<void>((r) => server.close(() => r()));
  const base = `http://127.0.0.1:${port}/api/v1`;
  const post = (body: unknown) =>
    fetch(`${base}/audits`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ...ctx, base, post };
}

type Json = { data?: Record<string, unknown>; error?: { code: string; message: string; details?: { path: string }[] } };

describe('POST /audits', () => {
  it('accepts a valid URL: 202, persisted as queued, job enqueued', async () => {
    const { post, repo, queue } = await boot();
    const res = await post({ url: 'Example.com' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as Json;
    const id = body.data!.id as string;
    expect(body.data!.status).toBe('queued');
    expect(queue.jobs).toEqual([id]);
    const stored = repo.audits.get(id)!;
    expect(stored.targetUrl).toBe('Example.com'); // exactly what the user typed
    expect(stored.normalizedUrl).toBe('https://example.com'); // canonical key
    expect(stored.categories).toHaveLength(5);
    expect(stored.categories.every((c) => c.status === 'pending')).toBe(true);
  });

  it.each([
    ['http://localhost', 'HOST_NOT_ALLOWED'],
    ['http://169.254.169.254/latest/meta-data/', 'HOST_NOT_ALLOWED'],
    ['http://127.0.0.1:8080', 'HOST_NOT_ALLOWED'],
    ['http://[::1]/', 'HOST_NOT_ALLOWED'],
    ['file:///etc/passwd', 'UNSUPPORTED_SCHEME'],
    ['javascript:alert(1)', 'UNSUPPORTED_SCHEME'],
    ['https://user:pw@example.com', 'CREDENTIALS_NOT_ALLOWED'],
    ['https://example.com:6379', 'PORT_NOT_ALLOWED'],
  ])('rejects %s with 422 %s and queues nothing', async (url, code) => {
    const { post, repo, queue } = await boot();
    const res = await post({ url });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error!.code).toBe(code);
    expect(repo.audits.size).toBe(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it('rejects hostnames that resolve to private addresses (DNS check at submission)', async () => {
    const { resolvePublicAddresses } = await import('@wi/net-guard');
    const { post, queue } = await boot({
      resolveHost: (h) => resolvePublicAddresses(h, { lookup: async () => [{ address: '10.1.1.1', family: 4 }] }),
    });
    const res = await post({ url: 'looks-public.example' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as Json).error!.code).toBe('HOST_NOT_ALLOWED');
    expect(queue.jobs).toHaveLength(0);
  });

  it('returns 400 with field details for malformed bodies', async () => {
    const { post } = await boot();
    for (const body of [{}, { url: '' }, { url: 123 }, { url: 'example.com', extra: true }, { url: 'a'.repeat(3000) }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as Json;
      expect(json.error!.code).toBe('BAD_REQUEST');
      expect(json.error!.details!.some((d) => d.path.startsWith('body'))).toBe(true);
    }
  });

  it('marks the audit failed and returns 503 when the queue is down, without leaking why', async () => {
    const { post, queue, repo } = await boot();
    queue.failWith = new Error('ECONNREFUSED redis://10.0.0.9:6379 password=hunter2');
    const res = await post({ url: 'example.com' });
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.9/);
    const [audit] = [...repo.audits.values()];
    expect(audit!.status).toBe('failed');
  });

  it('applies the stricter audit rate limit', async () => {
    const { post } = await boot({}, { ...baseEnv, AUDIT_RATE_LIMIT_MAX: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await post({ url: 'example.com' })).status);
    expect(codes).toEqual([202, 202, 429]);
  });
});

describe('GET /audits/:id[/status|/report]', () => {
  it('returns status with real progress derived from category states', async () => {
    const { post, base, repo } = await boot();
    const id = (((await (await post({ url: 'example.com' })).json()) as Json).data!.id as string);

    let status = ((await (await fetch(`${base}/audits/${id}/status`)).json()) as Json).data!;
    expect(status.progress).toEqual({ finished: 0, total: 5 });

    const audit = repo.audits.get(id)!;
    audit.status = 'running';
    audit.categories[0]!.status = 'completed';
    audit.categories[0]!.score = 88;
    audit.categories[1]!.status = 'unavailable';
    audit.categories[1]!.reason = 'PageSpeed API key not configured';
    audit.categories[2]!.status = 'running';

    status = ((await (await fetch(`${base}/audits/${id}/status`)).json()) as Json).data!;
    expect(status.progress).toEqual({ finished: 2, total: 5 }); // running does NOT count as finished
    const cats = status.categories as { category: string; status: string; score: number | null }[];
    expect(cats.find((c) => c.status === 'unavailable')!.score).toBeNull();
  });

  it('GET /audits/:id and /report return the audit; unknown ids are 404; bad ids are 400', async () => {
    const { post, base } = await boot();
    const id = (((await (await post({ url: 'example.com' })).json()) as Json).data!.id as string);
    expect((await fetch(`${base}/audits/${id}`)).status).toBe(200);
    const report = (await (await fetch(`${base}/audits/${id}/report`)).json()) as Json;
    expect(report.data!.targetUrl).toBe('example.com');
    expect((report.data!.categories as unknown[]).length).toBe(5);

    expect((await fetch(`${base}/audits/3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10/status`)).status).toBe(404);
    const bad = await fetch(`${base}/audits/not-a-uuid/report`);
    expect(bad.status).toBe(400);
  });
});

describe('GET /audits (history is capability-based)', () => {
  const mk = async (post: (b: unknown) => Promise<Response>, urls: string[]) => {
    const ids: string[] = [];
    for (const u of urls) ids.push((((await (await post({ url: u })).json()) as Json).data!.id as string));
    return ids;
  };

  it('refuses to list without ids, so nobody can enumerate other visitors audits', async () => {
    const { post, base } = await boot();
    await post({ url: 'secret-client.example.com' });
    const res = await fetch(`${base}/audits`);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('secret-client');
    expect((await fetch(`${base}/audits?ids=`)).status).toBe(400);
    expect((await fetch(`${base}/audits?ids=not-a-uuid`)).status).toBe(400);
  });

  it('returns only the requested audits, newest first, and ignores unknown ids', async () => {
    const { post, base } = await boot();
    const ids = await mk(post, ['a.example.com', 'b.example.com', 'c.example.com']);
    const unknown = '3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10';
    const res = ((await (await fetch(`${base}/audits?ids=${ids[0]},${ids[2]},${unknown}`)).json()) as Json).data!;
    const items = res.items as { id: string }[];
    expect(res.total).toBe(2);
    expect(items.map((i) => i.id).sort()).toEqual([ids[0], ids[2]].sort());
    expect(items.some((i) => i.id === ids[1])).toBe(false);
  });

  it('can narrow the given ids to one site (all spellings share a key) and paginates', async () => {
    const { post, base } = await boot();
    const ids = await mk(post, ['a.example.com', 'A.example.com/', 'https://a.example.com#x', 'b.example.com']);
    const q = (extra: string) => fetch(`${base}/audits?ids=${ids.join(',')}${extra}`).then((r) => r.json() as Promise<Json>);
    expect(((await q(`&url=${encodeURIComponent('a.example.com')}`)).data!).total).toBe(3);
    const page = (await q('&pageSize=2')).data!;
    expect((page.items as unknown[]).length).toBe(2);
    expect(page.total).toBe(4);
  });

  it('validates bounds', async () => {
    const { base } = await boot();
    const id = '3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10';
    expect((await fetch(`${base}/audits?ids=${id}&pageSize=500`)).status).toBe(400);
    expect((await fetch(`${base}/audits?ids=${id}&page=0`)).status).toBe(400);
    const many = Array.from({ length: 51 }, () => id).join(',');
    expect((await fetch(`${base}/audits?ids=${many}`)).status).toBe(400);
  });
});

describe('GET /audits/compare/:firstId/:secondId', () => {
  async function finished(ctx: Awaited<ReturnType<typeof boot>>, url: string, scores: Record<string, number | null>, overall: number | null) {
    const id = (((await (await ctx.post({ url })).json()) as Json).data!.id as string);
    const a = ctx.repo.audits.get(id)!;
    a.status = 'completed';
    a.overallScore = overall;
    for (const c of a.categories) {
      const s = scores[c.category];
      c.status = s === undefined || s === null ? 'unavailable' : 'completed';
      c.score = s ?? null;
    }
    return id;
  }

  it('returns per-category deltas, treating unavailable as null (never 0)', async () => {
    const ctx = await boot();
    const a = await finished(ctx, 'example.com', { performance: 60, seo: 80, security: 40, accessibility: 70, 'best-practices': null }, 62);
    const b = await finished(ctx, 'example.com/', { performance: 75, seo: 80, security: 30, accessibility: null, 'best-practices': 90 }, 70);
    const res = ((await (await fetch(`${ctx.base}/audits/compare/${a}/${b}`)).json()) as Json).data!;
    expect(res.sameSite).toBe(true);
    expect(res.overallDelta).toBe(8);
    type Row = { category: string; delta: number | null; first: number | null };
    const by = Object.fromEntries((res.categories as Row[]).map((c) => [c.category, c])) as Record<string, Row>;
    expect(by.performance!.delta).toBe(15); // improved
    expect(by.seo!.delta).toBe(0); // unchanged
    expect(by.security!.delta).toBe(-10); // regressed
    expect(by.accessibility!.delta).toBeNull(); // became unavailable: not a regression to 0
    expect(by['best-practices']!.delta).toBeNull(); // was unavailable
    expect(by['best-practices']!.first).toBeNull();
  });

  it('flags audits of different sites', async () => {
    const ctx = await boot();
    const a = await finished(ctx, 'one.example.com', { seo: 50 }, 50);
    const b = await finished(ctx, 'two.example.com', { seo: 60 }, 60);
    expect((((await (await fetch(`${ctx.base}/audits/compare/${a}/${b}`)).json()) as Json).data!).sameSite).toBe(false);
  });

  it('409 when an audit has not finished, 404 when unknown, 400 for bad ids', async () => {
    const ctx = await boot();
    const done = await finished(ctx, 'example.com', { seo: 50 }, 50);
    const pending = (((await (await ctx.post({ url: 'example.org' })).json()) as Json).data!.id as string);
    const r409 = await fetch(`${ctx.base}/audits/compare/${done}/${pending}`);
    expect(r409.status).toBe(409);
    expect(((await r409.json()) as Json).error!.code).toBe('AUDIT_NOT_FINISHED');
    expect((await fetch(`${ctx.base}/audits/compare/${done}/3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10`)).status).toBe(404);
    expect((await fetch(`${ctx.base}/audits/compare/${done}/nope`)).status).toBe(400);
  });
});

void startTestApp;
