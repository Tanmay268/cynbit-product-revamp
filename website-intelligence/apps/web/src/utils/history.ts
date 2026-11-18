const KEY = 'wi.audit-history.v1';
const MAX = 50; // matches the API's per-request id limit
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * There are no accounts, so "my audits" is the list of audit ids this browser has started (newest first).
 * Everything here tolerates storage being unavailable (private windows, blocked cookies).
 */
export function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function addToHistory(id: string): void {
  if (!UUID.test(id)) return;
  try {
    const next = [id, ...loadHistory().filter((x) => x !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: history simply will not persist */
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
