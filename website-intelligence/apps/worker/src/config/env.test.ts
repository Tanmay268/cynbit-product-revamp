import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env.js';

const valid = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', REDIS_URL: 'redis://localhost:6379' };

describe('worker env', () => {
  it('applies defaults', () => {
    const env = loadWorkerEnv(valid as NodeJS.ProcessEnv);
    expect(env.WORKER_CONCURRENCY).toBe(2);
    expect(env.PAGESPEED_API_KEY).toBeUndefined();
  });
  it('rejects invalid values', () => {
    expect(() => loadWorkerEnv({ ...valid, WORKER_CONCURRENCY: '0' } as NodeJS.ProcessEnv)).toThrow();
  });
  it('requires connection strings', () => {
    expect(() => loadWorkerEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });
});
