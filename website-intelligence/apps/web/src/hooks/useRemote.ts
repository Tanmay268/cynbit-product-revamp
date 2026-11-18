import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError, type ApiRequestError } from '../services/api';

export interface Remote<T> {
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  reload: () => void;
}

/** Fetches once (and again on `reload` or when `deps` change). Cancels in-flight requests on unmount/change. */
export function useRemote<T>(load: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[]): Remote<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiRequestError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: load !== null,
  });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const fn = loadRef.current;
    if (!fn) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((p) => ({ ...p, error: null, loading: true }));
    fn(controller.signal).then(
      (data) => !controller.signal.aborted && setState({ data, error: null, loading: false }),
      (e) => !controller.signal.aborted && setState({ data: null, error: toApiError(e), loading: false }),
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload: useCallback(() => setNonce((n) => n + 1), []) };
}
