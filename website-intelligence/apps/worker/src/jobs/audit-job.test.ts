import { describe, expect, it } from 'vitest';
import { FINAL_FAILURE_MESSAGE, finalizeFailedJob } from './audit-job.js';

const job = (attemptsMade: number, attempts?: number) => ({
  data: { auditId: 'a1' },
  attemptsMade,
  opts: { attempts },
});
const recorder = () => {
  const failed: [string, string][] = [];
  return { failed, store: { failAudit: async (id: string, msg: string) => void failed.push([id, msg]) } };
};

describe('finalizeFailedJob (retry behaviour)', () => {
  it('does NOT mark the audit failed while retries remain', async () => {
    const { failed, store } = recorder();
    expect(await finalizeFailedJob(job(1, 2) as never, store)).toBe(false);
    expect(failed).toEqual([]);
  });

  it('marks the audit failed once the last attempt has failed', async () => {
    const { failed, store } = recorder();
    expect(await finalizeFailedJob(job(2, 2) as never, store)).toBe(true);
    expect(failed).toEqual([['a1', FINAL_FAILURE_MESSAGE]]);
  });

  it('treats a job with no retry configuration as single-attempt', async () => {
    const { failed, store } = recorder();
    await finalizeFailedJob(job(1) as never, store);
    expect(failed).toHaveLength(1);
  });

  it('ignores a missing job', async () => {
    const { store } = recorder();
    expect(await finalizeFailedJob(undefined, store)).toBe(false);
  });
});
