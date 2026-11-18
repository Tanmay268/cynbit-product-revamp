import { normalizeUrl, resolvePublicAddresses, UrlValidationError } from '@wi/net-guard';
import {
  AUDIT_CATEGORIES,
  type AuditCategoryId,
  type AuditComparisonResponse,
  type AuditListResponse,
  type AuditReportResponse,
  type AuditStatusResponse,
  type CreateAuditResponse,
} from '@wi/shared';
import { AppError, notFound } from '../utils/errors.js';
import type { AuditRepository } from './audit-repository.js';

export interface AuditQueuePort {
  enqueue(auditId: string): Promise<void>;
}

export interface AuditServiceDeps {
  repo: AuditRepository;
  queue: AuditQueuePort;
  /** Early DNS check at submission time. Injected in tests. */
  resolveHost?: (hostname: string) => Promise<unknown>;
}

export class AuditService {
  private readonly resolveHost: (hostname: string) => Promise<unknown>;

  constructor(private readonly deps: AuditServiceDeps) {
    this.resolveHost = deps.resolveHost ?? ((h) => resolvePublicAddresses(h));
  }

  /**
   * Validates synchronously so users get instant feedback, then queues the work.
   * This is only the *first* of several SSRF checks: the worker re-validates, and
   * every connection is validated again at connect time (see @wi/net-guard).
   */
  async create(rawUrl: string): Promise<CreateAuditResponse> {
    const url = await this.validate(rawUrl);

    const { id } = await this.deps.repo.create({ targetUrl: rawUrl.trim(), normalizedUrl: url });
    try {
      await this.deps.queue.enqueue(id);
    } catch {
      await this.deps.repo.markFailed(id, 'The audit could not be queued.').catch(() => undefined);
      throw new AppError(503, 'QUEUE_UNAVAILABLE', 'Audits are temporarily unavailable. Please try again shortly.');
    }
    return { id, status: 'queued' };
  }

  async getStatus(id: string): Promise<AuditStatusResponse> {
    return (await this.deps.repo.findStatus(id)) ?? Promise.reject(notFound('Audit not found'));
  }

  async getReport(id: string): Promise<AuditReportResponse> {
    return (await this.deps.repo.findReport(id)) ?? Promise.reject(notFound('Audit not found'));
  }

  async list(query: { ids: string[]; page: number; pageSize: number; url?: string }): Promise<AuditListResponse> {
    const normalizedUrl = query.url ? await this.validate(query.url, { resolve: false }) : undefined;
    return this.deps.repo.list({ ids: query.ids, page: query.page, pageSize: query.pageSize, normalizedUrl });
  }

  /** Score-by-score comparison of two finished audits. Missing scores are never treated as 0. */
  async compare(firstId: string, secondId: string): Promise<AuditComparisonResponse> {
    const [first, second] = await Promise.all([this.getStatus(firstId), this.getStatus(secondId)]);
    const done = (s: AuditStatusResponse) => s.status === 'completed' || s.status === 'partial';
    if (!done(first) || !done(second)) {
      throw new AppError(409, 'AUDIT_NOT_FINISHED', 'Both audits must have finished (with results) before they can be compared.');
    }
    const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : b - a);
    const score = (s: AuditStatusResponse, c: AuditCategoryId) => s.categories.find((x) => x.category === c)?.score ?? null;
    return {
      first,
      second,
      sameSite: first.normalizedUrl === second.normalizedUrl,
      overallDelta: delta(first.overallScore, second.overallScore),
      categories: AUDIT_CATEGORIES.map((category) => {
        const a = score(first, category);
        const b = score(second, category);
        return { category, first: a, second: b, delta: delta(a, b) };
      }),
    };
  }

  /** Returns the canonical history key. */
  private async validate(raw: string, opts: { resolve?: boolean } = {}): Promise<string> {
    try {
      const n = normalizeUrl(raw);
      if (opts.resolve !== false) await this.resolveHost(n.hostname);
      return n.key;
    } catch (err) {
      if (err instanceof UrlValidationError) throw new AppError(422, err.code, err.message);
      throw err;
    }
  }
}
