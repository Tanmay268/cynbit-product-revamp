import { describe, expect, it } from 'vitest';
import { createPageSpeedLoader, parse } from './pagespeed.js';

const validBody = { lighthouseResult: { categories: { performance: { score: 0.9 } }, audits: {} } };
const json = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createPageSpeedLoader', () => {
  it('reports missing-key without making any request', async () => {
    let called = false;
    const load = createPageSpeedLoader({ fetchImpl: (async () => { called = true; return new Response(); }) as typeof fetch });
    expect(await load('https://example.com/')).toMatchObject({ ok: false, reason: 'missing-key' });
    expect(called).toBe(false);
  });

  it('requests mobile performance + best-practices and returns parsed data', async () => {
    let seen = '';
    const load = createPageSpeedLoader({ apiKey: 'K', fetchImpl: (async (u: string) => { seen = u; return new Response(JSON.stringify(validBody), { status: 200 }); }) as unknown as typeof fetch });
    const r = await load('https://example.com/a b');
    expect(r.ok).toBe(true);
    const q = new URL(seen).searchParams;
    expect(q.get('strategy')).toBe('mobile');
    expect(q.getAll('category')).toEqual(['performance', 'best-practices']);
    expect(q.get('url')).toBe('https://example.com/a b');
  });

  it.each([
    [429, 'rate-limited'],
    [403, 'invalid-key'],
    [401, 'invalid-key'],
    [400, 'target-failed'],
    [404, 'unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const load = createPageSpeedLoader({ apiKey: 'K', fetchImpl: json(status) as unknown as typeof fetch });
    expect(await load('https://example.com/')).toMatchObject({ ok: false, reason });
  });

  it('retries once on 5xx and succeeds', async () => {
    let n = 0;
    const load = createPageSpeedLoader({
      apiKey: 'K',
      retryDelayMs: 1,
      fetchImpl: (async () => (++n === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify(validBody), { status: 200 }))) as unknown as typeof fetch,
    });
    expect((await load('https://example.com/')).ok).toBe(true);
    expect(n).toBe(2);
  });

  it('gives up after a second 5xx', async () => {
    let n = 0;
    const load = createPageSpeedLoader({ apiKey: 'K', retryDelayMs: 1, fetchImpl: (async () => { n++; return new Response('', { status: 500 }); }) as unknown as typeof fetch });
    expect(await load('https://example.com/')).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(n).toBe(2);
  });

  it('maps timeouts and network errors', async () => {
    const slow = createPageSpeedLoader({
      apiKey: 'K',
      timeoutMs: 30,
      fetchImpl: ((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'TimeoutError' }))))) as unknown as typeof fetch,
    });
    expect(await slow('https://example.com/')).toMatchObject({ ok: false, reason: 'timeout' });

    const down = createPageSpeedLoader({ apiKey: 'K', fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch });
    expect(await down('https://example.com/')).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('rejects unreadable and malformed bodies as bad-response', async () => {
    const garbage = createPageSpeedLoader({ apiKey: 'K', fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch });
    expect(await garbage('https://example.com/')).toMatchObject({ ok: false, reason: 'bad-response' });
    const wrong = createPageSpeedLoader({ apiKey: 'K', fetchImpl: json(200, { hello: 'world' }) as unknown as typeof fetch });
    expect(await wrong('https://example.com/')).toMatchObject({ ok: false, reason: 'bad-response' });
  });

  it('NEVER leaks the API key or request URL in any outcome', async () => {
    const SECRET = 'AIzaSyTOPSECRETKEY';
    for (const f of [json(429), json(403), json(500), json(400), async () => { throw new Error(`failed https://x?key=${SECRET}`); }]) {
      const load = createPageSpeedLoader({ apiKey: SECRET, retryDelayMs: 1, fetchImpl: f as unknown as typeof fetch });
      expect(JSON.stringify(await load('https://example.com/'))).not.toContain(SECRET);
    }
  });
});

describe('parse', () => {
  it('treats a response with no performance score as target-failed (Lighthouse run error)', () => {
    expect(parse({ lighthouseResult: { categories: { performance: { score: null } }, audits: {} } })).toMatchObject({ ok: false, reason: 'target-failed' });
  });
});
