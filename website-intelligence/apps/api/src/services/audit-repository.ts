import type { PrismaClient } from '@prisma/client';
import {
  AUDIT_CATEGORIES,
  SEVERITIES,
  auditStatusToDb,
  categoryStatusToDb,
  categoryToDb,
  computeOverallScore,
  findingStatusToDb,
  fromDb,
  severityToDb,
  type AuditListResponse,
  type AuditReportResponse,
  type AuditStatusResponse,
  type CategoryReport,
  type CategoryStatusView,
  type Finding,
} from '@wi/shared';

export interface AuditRepository {
  /** Creates the audit (status queued) with one pending row per category. */
  create(input: { targetUrl: string; normalizedUrl: string }): Promise<{ id: string }>;
  findStatus(id: string): Promise<AuditStatusResponse | null>;
  findReport(id: string): Promise<AuditReportResponse | null>;
  list(query: { ids: string[]; page: number; pageSize: number; normalizedUrl?: string }): Promise<AuditListResponse>;
  markFailed(id: string, message: string): Promise<void>;
}

const categoryOrder = (c: { category: string }) =>
  AUDIT_CATEGORIES.indexOf(fromDb(categoryToDb, c.category) as (typeof AUDIT_CATEGORIES)[number]);

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: { targetUrl: string; normalizedUrl: string }) {
    return this.prisma.audit.create({
      data: {
        targetUrl: input.targetUrl,
        normalizedUrl: input.normalizedUrl,
        status: auditStatusToDb.queued,
        categories: { create: AUDIT_CATEGORIES.map((c) => ({ category: categoryToDb[c] })) },
      },
      select: { id: true },
    });
  }

  async findStatus(id: string): Promise<AuditStatusResponse | null> {
    const audit = await this.prisma.audit.findUnique({ where: { id }, include: { categories: true } });
    if (!audit) return null;
    const categories = [...audit.categories].sort((a, b) => categoryOrder(a) - categoryOrder(b)).map(toCategoryView);
    return {
      id: audit.id,
      targetUrl: audit.targetUrl,
      normalizedUrl: audit.normalizedUrl,
      status: fromDb(auditStatusToDb, audit.status),
      overallScore: audit.overallScore,
      // Real progress: how many categories have reached a terminal state in the database.
      progress: {
        finished: categories.filter((c) => c.status === 'completed' || c.status === 'unavailable' || c.status === 'failed').length,
        total: categories.length,
      },
      categories,
      createdAt: audit.createdAt.toISOString(),
      completedAt: audit.completedAt?.toISOString() ?? null,
      errorMessage: audit.errorMessage,
    };
  }

  async findReport(id: string): Promise<AuditReportResponse | null> {
    const audit = await this.prisma.audit.findUnique({
      where: { id },
      include: { categories: { include: { findings: true } } },
    });
    if (!audit) return null;

    const categories: CategoryReport[] = [...audit.categories]
      .sort((a, b) => categoryOrder(a) - categoryOrder(b))
      .map((c) => ({
        ...toCategoryView(c),
        summary: { passed: c.passedCount, failed: c.failedCount, warnings: c.warningCount },
        findings: c.findings
          .map(
            (f): Finding => ({
              ruleId: f.ruleId,
              title: f.title,
              description: f.description,
              severity: fromDb(severityToDb, f.severity),
              status: fromDb(findingStatusToDb, f.status),
              evidence: f.evidence,
              recommendation: f.recommendation,
              impact: f.impact,
            }),
          )
          .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.title.localeCompare(b.title)),
      }));

    return {
      id: audit.id,
      status: fromDb(auditStatusToDb, audit.status),
      targetUrl: audit.targetUrl,
      normalizedUrl: audit.normalizedUrl,
      overallScore: audit.overallScore,
      scoredCategories: computeOverallScore(categories).includedCategories,
      createdAt: audit.createdAt.toISOString(),
      completedAt: audit.completedAt?.toISOString() ?? null,
      errorMessage: audit.errorMessage,
      categories,
    };
  }

  async list(query: { ids: string[]; page: number; pageSize: number; normalizedUrl?: string }): Promise<AuditListResponse> {
    const where = { id: { in: query.ids }, ...(query.normalizedUrl ? { normalizedUrl: query.normalizedUrl } : {}) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.audit.count({ where }),
      this.prisma.audit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          targetUrl: true,
          normalizedUrl: true,
          status: true,
          overallScore: true,
          createdAt: true,
          completedAt: true,
        },
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        targetUrl: r.targetUrl,
        normalizedUrl: r.normalizedUrl,
        status: fromDb(auditStatusToDb, r.status),
        overallScore: r.overallScore,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async markFailed(id: string, message: string) {
    await this.prisma.audit.update({
      where: { id },
      data: { status: auditStatusToDb.failed, errorMessage: message, completedAt: new Date() },
    });
  }
}

function toCategoryView(c: {
  category: string;
  status: string;
  score: number | null;
  reason: string | null;
  executionTimeMs: number | null;
}): CategoryStatusView {
  const status = fromDb(categoryStatusToDb, c.status);
  return {
    category: fromDb(categoryToDb, c.category),
    status,
    score: status === 'completed' ? c.score : null, // never surface a score for an unavailable/failed category
    reason: c.reason,
    executionTimeMs: c.executionTimeMs,
  };
}
