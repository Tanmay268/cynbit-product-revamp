import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api } from '../services/api';
import { ID_A, makeStatus } from '../test/fixtures';
import { nextDelay, useAuditStatus } from './useAuditStatus';

vi.mock('../services/api', async (orig) => {
  const actual = await orig<typeof import('../services/api')>();
  return { ...actual, api: { ...actual.api, getStatus: vi.fn() } };
});
const getStatus = vi.mocked(api.getStatus);

const flush = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  getStatus.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useAuditStatus', () => {
  it('polls until the audit reaches a terminal state, then stops', async () => {
    getStatus
      .mockResolvedValueOnce(makeStatus({ status: 'queued', progress: { finished: 0, total: 5 } }))
      .mockResolvedValueOnce(makeStatus({ status: 'running', progress: { finished: 2, total: 5 } }))
      .mockResolvedValue(makeStatus({ status: 'completed', progress: { finished: 5, total: 5 } }));

    const { result } = renderHook(() => useAuditStatus(ID_A));
    await flush(0);
    expect(result.current.status?.status).toBe('queued');
    await flush(1500);
    expect(result.current.status?.progress.finished).toBe(2);
    await flush(1500);
    expect(result.current.status?.status).toBe('completed');

    const calls = getStatus.mock.calls.length;
    await flush(30_000);
    expect(getStatus.mock.calls.length).toBe(calls); // no more polling after completion
  });

  it.each(['completed', 'partial', 'failed'] as const)('stops polling on %s', async (terminal) => {
    getStatus.mockResolvedValue(makeStatus({ status: terminal }));
    renderHook(() => useAuditStatus(ID_A));
    await flush(0);
    await flush(20_000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps retrying through transient failures and flags a connection issue after 3 in a row', async () => {
    const net = new ApiRequestError('down', 'NETWORK', null);
    getStatus.mockRejectedValue(net);
    const { result } = renderHook(() => useAuditStatus(ID_A));
    await flush(0);
    expect(result.current.connectionIssue).toBe(false);
    await flush(2_000);
    await flush(4_000);
    expect(result.current.connectionIssue).toBe(true);
    expect(result.current.error).toBeNull(); // still trying, not a fatal error

    getStatus.mockResolvedValue(makeStatus({ status: 'completed' }));
    await flush(8_000);
    expect(result.current.connectionIssue).toBe(false);
    expect(result.current.status?.status).toBe('completed');
  });

  it('stops on a non-retryable error such as 404', async () => {
    getStatus.mockRejectedValue(new ApiRequestError('Audit not found', 'NOT_FOUND', 404));
    const { result } = renderHook(() => useAuditStatus(ID_A));
    await flush(0);
    expect(result.current.error?.status).toBe(404);
    await flush(60_000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('stops polling when unmounted and cancels the in-flight request', async () => {
    getStatus.mockResolvedValue(makeStatus({ status: 'running' }));
    const { unmount } = renderHook(() => useAuditStatus(ID_A));
    await flush(0);
    const signal = getStatus.mock.calls[0]![1] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    const calls = getStatus.mock.calls.length;
    await flush(30_000);
    expect(getStatus.mock.calls.length).toBe(calls);
  });
});

describe('nextDelay', () => {
  it('polls quickly, then calmer, and backs off (capped) while failing', () => {
    expect(nextDelay(1, 0)).toBe(1500);
    expect(nextDelay(25, 0)).toBe(3000);
    expect([1, 2, 3, 4, 10].map((f) => nextDelay(5, f))).toEqual([2000, 4000, 8000, 15000, 15000]);
  });
});
