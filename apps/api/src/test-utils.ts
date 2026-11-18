import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  AUDIT_CATEGORIES,
  type AuditListResponse,
  type AuditReportResponse,
  type AuditStatusResponse,
  type CategoryReport,
} from '@wi/shared';
import { createApp, type AppDeps } from './app.js';
import type { AuditRepository } from './services/audit-repository.js';
import { AuditService, type AuditQueuePort } from './services/audit-service.js';
import type { LeadRecord, LeadRepository } from './services/lead-repository.js';
import { LeadService } from './services/lead-service.js';

export const baseEnv: AppDeps['env'] = {
  CORS_ORIGINS: ['http://localhost:5173'],
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 1000,
  AUDIT_RATE_LIMIT_MAX: 1000,
  LEAD_RATE_LIMIT_MAX: 1000,
  STATUS_RATE_LIMIT_MAX: 1000,
};

export const healthyDeps = {
  checkDatabase: async () => undefined,
  checkRedis: async () => undefined,
};

interface StoredAudit {
  id: string;
  targetUrl: string;
  normalizedUrl: string;
  status: AuditReportResponse['status'];
  overallScore: number | null;
  errorMessage: string | null;
  createdAt: Date;
  categories: CategoryReport[];
}

/** In-memory AuditRepository: same contract as the Prisma one, no database needed. */
export class InMemoryAuditRepository implements AuditRepository {
  readonly audits = new Map<string, StoredAudit>();

  async create(input: { targetUrl: string; normalizedUrl: string }) {
    const id = randomUUID();
    this.audits.set(id, {
      id,
      ...input,
      status: 'queued',
      overallScore: null,
      errorMessage: null,
      createdAt: new Date(),
      categories: AUDIT_CATEGORIES.map((category) => ({
        category,
        status: 'pending' as const,
        score: null,
        reason: null,
        executionTimeMs: null,
        summary: { passed: 0, failed: 0, warnings: 0 },
        findings: [],
      })),
    });
    return { id };
  }

  async findStatus(id: string): Promise<AuditStatusResponse | null> {
    const a = this.audits.get(id);
    if (!a) return null;
    const categories = a.categories.map(({ category, status, score, reason, executionTimeMs }) => ({
      category,
      status,
      score,
      reason,
      executionTimeMs,
    }));
    return {
      id: a.id,
      targetUrl: a.targetUrl,
      normalizedUrl: a.normalizedUrl,
      status: a.status,
      overallScore: a.overallScore,
      progress: { finished: categories.filter((c) => ['completed', 'unavailable', 'failed'].includes(c.status)).length, total: categories.length },
      categories,
      createdAt: a.createdAt.toISOString(),
      completedAt: null,
      errorMessage: a.errorMessage,
    };
  }

  async findReport(id: string): Promise<AuditReportResponse | null> {
    const a = this.audits.get(id);
    if (!a) return null;
    return {
      id: a.id,
      status: a.status,
      targetUrl: a.targetUrl,
      normalizedUrl: a.normalizedUrl,
      overallScore: a.overallScore,
      scoredCategories: [],
      createdAt: a.createdAt.toISOString(),
      completedAt: null,
      errorMessage: a.errorMessage,
      categories: a.categories,
    };
  }

  async list(q: { ids: string[]; page: number; pageSize: number; normalizedUrl?: string }): Promise<AuditListResponse> {
    const all = [...this.audits.values()]
      .filter((a) => q.ids.includes(a.id))
      .filter((a) => !q.normalizedUrl || a.normalizedUrl === q.normalizedUrl)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
    return {
      items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((a) => ({
        id: a.id,
        targetUrl: a.targetUrl,
        normalizedUrl: a.normalizedUrl,
        status: a.status,
        overallScore: a.overallScore,
        createdAt: a.createdAt.toISOString(),
        completedAt: null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total: all.length,
    };
  }

  async markFailed(id: string, message: string) {
    const a = this.audits.get(id);
    if (a) Object.assign(a, { status: 'failed', errorMessage: message });
  }
}

export class InMemoryLeadRepository implements LeadRepository {
  readonly leads: (LeadRecord & { id: string })[] = [];
  failWith: Error | null = null;
  async create(lead: LeadRecord) {
    if (this.failWith) throw this.failWith;
    const id = randomUUID();
    this.leads.push({ id, ...lead });
    return { id };
  }
}

export class FakeQueue implements AuditQueuePort {
  readonly jobs: string[] = [];
  failWith: Error | null = null;
  async enqueue(auditId: string) {
    if (this.failWith) throw this.failWith;
    this.jobs.push(auditId);
  }
}

/** Service wired to in-memory fakes. DNS is stubbed so tests never touch the network. */
export function createTestAuditService(opts: { resolveHost?: (h: string) => Promise<unknown> } = {}) {
  const repo = new InMemoryAuditRepository();
  const queue = new FakeQueue();
  const service = new AuditService({ repo, queue, resolveHost: opts.resolveHost ?? (async () => ['93.184.216.34']) });
  return { repo, queue, service };
}

/** Boots the real Express app on an ephemeral port with injected deps. */
export async function startTestApp(overrides: Partial<AppDeps> = {}) {
  const { service } = createTestAuditService();
  const app = createApp({
    env: baseEnv,
    health: healthyDeps,
    audits: service,
    leads: new LeadService({ repo: new InMemoryLeadRepository() }),
    logger: { error: () => undefined },
    ...overrides,
  });
  const server: Server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
}
