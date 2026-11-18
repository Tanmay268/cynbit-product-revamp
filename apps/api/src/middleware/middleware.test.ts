import type { AddressInfo } from 'node:net';
import express from 'express';
import { z } from 'zod';
import { afterEach, describe, expect, it } from 'vitest';
import { createErrorHandler, requestId } from './error-handler.js';
import { validate } from './validate.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function serve(logger: Pick<Console, 'error'> = { error: () => undefined }) {
  const app = express();
  app.use(requestId, express.json());
  app.get('/boom', () => {
    throw new Error('SELECT * FROM users failed at /srv/app/secret.ts');
  });
  app.post(
    '/items/:id',
    validate({
      params: z.object({ id: z.string().uuid() }),
      query: z.object({ limit: z.coerce.number().int().max(50).default(10) }),
      body: z.object({ name: z.string().trim().min(1) }).strict(),
    }),
    (req, res) => {
      res.json({ query: req.query, body: req.body });
    },
  );
  app.use(createErrorHandler(logger));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  close = () => new Promise<void>((r) => server.close(() => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('createErrorHandler', () => {
  it('returns a generic 500, logs the real error, and leaks nothing', async () => {
    const logged: unknown[][] = [];
    const base = await serve({ error: (...a: unknown[]) => void logged.push(a) });
    const res = await fetch(`${base}/boom`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR');
    expect(text).not.toMatch(/SELECT|secret|stack|\.ts/);
    expect(logged).toHaveLength(1);
  });
});

describe('validate', () => {
  const id = '3f2b8a52-6a53-4c0c-9a39-0a3a3b2d7f10';
  const post = (base: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('passes parsed, coerced and trimmed values to the handler', async () => {
    const base = await serve();
    const res = await post(base, `/items/${id}?limit=5`, { name: '  Acme  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ query: { limit: 5 }, body: { name: 'Acme' } });
  });

  it('reports every failing part with a path', async () => {
    const base = await serve();
    const res = await post(base, '/items/not-a-uuid?limit=999', { name: '', extra: 1 });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { details: { path: string }[] } };
    const paths = error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['params.id', 'query.limit']));
    expect(paths.some((p) => p.startsWith('body'))).toBe(true);
  });
});
