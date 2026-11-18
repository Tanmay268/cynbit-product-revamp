import { useEffect, useState } from 'react';
import type { AuditStatus, AuditStatusResponse } from '@wi/shared';
import { api, toApiError, type ApiRequestError } from '../services/api';

export const isTerminal = (s: AuditStatus) => s === 'completed' || s === 'partial' || s === 'failed';

export interface AuditStatusState {
  status: AuditStatusResponse | null;
  /** A non-retryable error (e.g. 404 unknown audit). Polling has stopped. */
  error: ApiRequestError | null;
  /** 3+ consecutive failed polls: show "reconnecting…" while we keep trying. */
  connectionIssue: boolean;
}

/** Delay before the next poll: quick at first, calmer for long audits, backing off while the API is failing. */
export function nextDelay(polls: number, consecutiveFailures: number): number {
  if (consecutiveFailures > 0) return Math.min(2_000 * 2 ** (consecutiveFailures - 1), 15_000);
  return polls < 20 ? 1_500 : 3_000;
}

/**
 * Polls the status endpoint until the audit reaches a terminal state. Everything shown comes from
 * what the API returned: the hook never estimates progress.
 */
export function useAuditStatus(id: string): AuditStatusState {
  const [state, setState] = useState<AuditStatusState>({ status: null, error: null, connectionIssue: false });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let polls = 0;
    const controller = new AbortController();
    setState({ status: null, error: null, connectionIssue: false });

    const tick = async () => {
      try {
        const status = await api.getStatus(id, controller.signal);
        if (cancelled) return;
        failures = 0;
        setState({ status, error: null, connectionIssue: false });
        if (isTerminal(status.status)) return;
      } catch (e) {
        if (cancelled) return;
        const err = toApiError(e);
        if (!err.retryable) {
          setState((p) => ({ ...p, error: err }));
          return;
        }
        failures++;
        setState((p) => ({ ...p, connectionIssue: failures >= 3 }));
      }
      polls++;
      timer = setTimeout(tick, nextDelay(polls, failures));
    };
    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [id]);

  return state;
}
