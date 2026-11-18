import type { HealthResponse } from '@wi/shared';

/** Dependency probes are injected so the health route is testable without real infrastructure. */
export interface HealthDeps {
  checkDatabase(): Promise<void>;
  checkRedis(): Promise<void>;
}

const PROBE_TIMEOUT_MS = 2_000;

async function probe(fn: () => Promise<void>): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

export async function getHealth(deps: HealthDeps): Promise<HealthResponse> {
  const [database, redis] = await Promise.all([probe(deps.checkDatabase), probe(deps.checkRedis)]);
  return {
    status: database === 'up' && redis === 'up' ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: { database, redis },
  };
}
