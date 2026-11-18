import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { LeadService } from '../services/lead-service.js';
import { InMemoryLeadRepository, baseEnv, createTestAuditService, healthyDeps } from '../test-utils.js';

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

async function boot(env = baseEnv) {
  const leadRepo = new InMemoryLeadRepository();
  const errors: unknown[] = [];
  const app = createApp({
    env,
    health: healthyDeps,
    audits: createTestAuditService().service,
    leads: new LeadService({ repo: leadRepo }),
    logger: { error: (...a: unknown[]) => void errors.push(a) },
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  closer = () => new Promise<void>((r) => server.close(() => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const post = (body: unknown, raw?: string) =>
    fetch(`${base}/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
  return { leadRepo, post, errors };
}

const valid = { name: 'Asha Verma', email: 'Asha@Example.com', company: 'Example Ltd', website: 'example.com', message: 'We need help with accessibility.' };
type Json = { data?: Record<string, unknown>; error?: { code: string; message: string; details?: { path: string; message: string }[] } };

describe('POST /leads', () => {
  it('stores a valid lead (trimmed, email lower-cased) and returns 201 without echoing data or an id', async () => {
    const { post, leadRepo } = await boot();
    const res = await post({ ...valid, name: '  Asha Verma  ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { received: true } });
    expect(leadRepo.leads).toHaveLength(1);
    expect(leadRepo.leads[0]).toMatchObject({ name: 'Asha Verma', email: 'asha@example.com', company: 'Example Ltd', website: 'example.com' });
  });

  it.each([
    ['name', { name: 'A' }],
    ['name', { name: '' }],
    ['email', { email: 'not-an-email' }],
    ['email', { email: '' }],
    ['company', { company: '   ' }],
    ['website', { website: 'not a url' }],
    ['website', { website: 'localhost' }],
    ['message', { message: 'short' }],
    ['message', { message: 'x'.repeat(2001) }],
    ['name', { name: 'Bad\u0000Name' }],
  ])('rejects invalid %s with 400 and a field path, storing nothing', async (field, patch) => {
    const { post, leadRepo } = await boot();
    const res = await post({ ...valid, ...patch });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Json;
    expect(body.error!.code).toBe('BAD_REQUEST');
    expect(body.error!.details!.map((d) => d.path)).toContain(`body.${field}`);
    expect(leadRepo.leads).toHaveLength(0);
  });

  it('reports every invalid field at once', async () => {
    const { post } = await boot();
    const body = (await (await post({})).json()) as Json;
    expect(body.error!.details!.map((d) => d.path).sort()).toEqual(['body.company', 'body.email', 'body.message', 'body.name', 'body.website']);
  });

  it('rejects unknown fields (strict) so nothing unexpected is persisted', async () => {
    const { post, leadRepo } = await boot();
    expect((await post({ ...valid, role: 'admin' })).status).toBe(400);
    expect(leadRepo.leads).toHaveLength(0);
  });

  it('silently discards honeypot submissions: looks successful to the bot, stores nothing', async () => {
    const { post, leadRepo } = await boot();
    const res = await post({ ...valid, hp: 'http://spam.example' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { received: true } });
    expect(leadRepo.leads).toHaveLength(0);
  });

  it('stores markup verbatim as inert text (output encoding is the renderer’s job, never executed here)', async () => {
    const { post, leadRepo } = await boot();
    await post({ ...valid, message: '<script>alert(1)</script> please call me' });
    expect(leadRepo.leads[0]!.message).toBe('<script>alert(1)</script> please call me');
  });

  it('rejects malformed JSON and oversized bodies without crashing', async () => {
    const { post } = await boot();
    expect((await post(undefined, '{not json')).status).toBe(400);
    expect((await post({ ...valid, message: 'x'.repeat(20_000) })).status).toBe(413);
  });

  it('applies its own rate limit (429) independent of the audit limiter', async () => {
    const { post, leadRepo } = await boot({ ...baseEnv, LEAD_RATE_LIMIT_MAX: 2 });
    expect((await post(valid)).status).toBe(201);
    expect((await post(valid)).status).toBe(201);
    const limited = await post(valid);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as Json).error!.code).toBe('RATE_LIMITED');
    expect(leadRepo.leads).toHaveLength(2);
  });

  it('returns a generic 500 without internals when storage fails', async () => {
    const { post, leadRepo, errors } = await boot();
    leadRepo.failWith = new Error('connection to 10.0.0.5:5432 refused');
    const res = await post(valid);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('10.0.0.5');
    expect(errors.length).toBeGreaterThan(0);
  });
});
