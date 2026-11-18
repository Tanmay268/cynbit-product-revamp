import axios, { AxiosError } from 'axios';
import type {
  ApiError,
  AuditComparisonResponse,
  AuditListResponse,
  AuditReportResponse,
  AuditStatusResponse,
  CreateAuditResponse,
  CreateLeadInput,
  CreateLeadResponse,
} from '@wi/shared';

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1',
  timeout: 15_000,
  headers: { Accept: 'application/json' },
});

/** The one error type the UI deals with. Messages are already safe/user-friendly. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
    readonly details: { path: string; message: string }[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
  /** True for failures that may go away by themselves (network down, 5xx, 429). */
  get retryable() {
    return this.status === null || this.status >= 500 || this.status === 429;
  }
}

export function toApiError(err: unknown): ApiRequestError {
  if (err instanceof ApiRequestError) return err;
  if (axios.isAxiosError(err)) {
    const e = err as AxiosError<Partial<ApiError>>;
    const body = e.response?.data?.error;
    if (e.response && body?.message) {
      return new ApiRequestError(body.message, body.code ?? 'ERROR', e.response.status, body.details, body.requestId);
    }
    if (e.response) {
      return new ApiRequestError('The server returned an unexpected response. Please try again.', 'BAD_RESPONSE', e.response.status);
    }
    if (e.code === 'ECONNABORTED') return new ApiRequestError('The server took too long to respond. Please try again.', 'TIMEOUT', null);
  }
  return new ApiRequestError('We could not reach the server. Check your connection and try again.', 'NETWORK', null);
}

async function get<T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  try {
    return (await http.get<{ data: T }>(path, { params, signal })).data.data;
  } catch (err) {
    throw toApiError(err);
  }
}

export const api = {
  async createAudit(url: string): Promise<CreateAuditResponse> {
    try {
      return (await http.post<{ data: CreateAuditResponse }>('/audits', { url })).data.data;
    } catch (err) {
      throw toApiError(err);
    }
  },
  async createLead(input: CreateLeadInput): Promise<CreateLeadResponse> {
    try {
      return (await http.post<{ data: CreateLeadResponse }>('/leads', input)).data.data;
    } catch (err) {
      throw toApiError(err);
    }
  },
  getStatus: (id: string, signal?: AbortSignal) => get<AuditStatusResponse>(`/audits/${id}/status`, undefined, signal),
  getReport: (id: string, signal?: AbortSignal) => get<AuditReportResponse>(`/audits/${id}/report`, undefined, signal),
  listAudits: (ids: string[], opts: { url?: string; page?: number; pageSize?: number } = {}, signal?: AbortSignal) =>
    get<AuditListResponse>('/audits', { ids: ids.join(','), ...opts }, signal),
  compare: (firstId: string, secondId: string, signal?: AbortSignal) =>
    get<AuditComparisonResponse>(`/audits/compare/${firstId}/${secondId}`, undefined, signal),
};
