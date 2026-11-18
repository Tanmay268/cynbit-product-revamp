import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { AUDIT_QUEUE_NAME, type AuditJobData } from '@wi/shared';
import type { Env } from '../config/env.js';
import type { AuditQueuePort } from './audit-service.js';
import type { HealthDeps } from './health.js';

/**
 * Prisma's defaults (5s connect + 10s pool wait) make requests hang for ~15s when Postgres is down.
 * Fail fast instead; explicit values in DATABASE_URL always win.
 */
export function withDbTimeouts(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '3');
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '3');
  return url.toString();
}

export interface Infrastructure extends HealthDeps, AuditQueuePort {
  prisma: PrismaClient;
  redis: Redis;
  auditQueue: Queue<AuditJobData>;
  close(): Promise<void>;
}

/** Creates the long-lived Postgres + Redis + BullMQ handles. Connections are lazy: nothing fails at construction. */
export function createInfrastructure(env: Pick<Env, 'DATABASE_URL' | 'REDIS_URL'>): Infrastructure {
  const prisma = new PrismaClient({ datasources: { db: { url: withDbTimeouts(env.DATABASE_URL) } } });

  // BullMQ requires maxRetriesPerRequest: null on connections it blocks on.
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000), // back off, cap at 5s
  });
  // Outages are surfaced via the health probe; log once-per-event tersely instead of dumping stacks.
  let lastWarn = 0;
  const onRedisError = (err: Error) => {
    if (Date.now() - lastWarn > 30_000) {
      lastWarn = Date.now();
      console.warn(`[api] redis unavailable: ${err.name}`);
    }
  };
  redis.on('error', onRedisError);

  const auditQueue = new Queue<AuditJobData>(AUDIT_QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  auditQueue.on('error', onRedisError);

  return {
    prisma,
    redis,
    auditQueue,
    // jobId = audit id makes enqueue idempotent: the same audit can never be queued twice.
    enqueue: async (auditId) => {
      await auditQueue.add('run-audit', { auditId }, { jobId: auditId });
    },
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    checkRedis: async () => {
      if (redis.status === 'wait') await redis.connect();
      await redis.ping();
    },
    close: async () => {
      await auditQueue.close();
      redis.disconnect();
      await prisma.$disconnect();
    },
  };
}
