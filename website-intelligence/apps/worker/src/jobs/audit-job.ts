import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { AUDIT_QUEUE_NAME, type AuditJobData } from '@wi/shared';
import type { AuditStore } from '../orchestrator/audit-store.js';
import { runAudit, type RunAuditDeps } from '../orchestrator/run-audit.js';

export const FINAL_FAILURE_MESSAGE = 'The audit could not be completed. Please try again.';

/**
 * BullMQ emits `failed` after EVERY failed attempt. Only when the last allowed
 * attempt has failed do we give up and mark the audit failed; earlier attempts
 * leave it in its current state so the retry can resume.
 */
export async function finalizeFailedJob(
  job: Pick<Job<AuditJobData>, 'data' | 'attemptsMade' | 'opts'> | undefined,
  store: Pick<AuditStore, 'failAudit'>,
): Promise<boolean> {
  if (!job) return false;
  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < maxAttempts) return false;
  await store.failAudit(job.data.auditId, FINAL_FAILURE_MESSAGE);
  return true;
}

export function startAuditWorker(opts: {
  connection: Redis;
  concurrency: number;
  deps: RunAuditDeps;
  logger?: Pick<Console, 'error' | 'info'>;
}) {
  const logger = opts.logger ?? console;
  const worker = new Worker<AuditJobData>(
    AUDIT_QUEUE_NAME,
    async (job) => {
      const outcome = await runAudit(job.data.auditId, opts.deps);
      logger.info(`[worker] audit ${job.data.auditId} -> ${outcome?.status ?? 'skipped'}`);
      return outcome;
    },
    { connection: opts.connection, concurrency: opts.concurrency },
  );

  worker.on('failed', (job, err) => {
    logger.error(`[worker] job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.name}`);
    finalizeFailedJob(job, opts.deps.store).catch((e) => logger.error('[worker] could not mark audit failed', e));
  });
  worker.on('error', (err) => logger.error(`[worker] queue error: ${err.name}`));
  return worker;
}
