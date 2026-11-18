import type { PrismaClient } from '@prisma/client';
import {
  auditStatusToDb,
  categoryStatusToDb,
  categoryToDb,
  findingStatusToDb,
  fromDb,
  severityToDb,
  type AnalyzerResult,
  type AuditCategoryId,
} from '@wi/shared';
import type { AuditStore, StoredAudit } from '../orchestrator/audit-store.js';

export class PrismaAuditStore implements AuditStore {
  constructor(private readonly prisma: PrismaClient) {}

  async getAudit(id: string): Promise<StoredAudit | null> {
    const a = await this.prisma.audit.findUnique({
      where: { id },
      select: {
        id: true,
        targetUrl: true,
        normalizedUrl: true,
        status: true,
        categories: { select: { category: true, status: true, score: true } },
      },
    });
    if (!a) return null;
    return {
      id: a.id,
      targetUrl: a.targetUrl,
      normalizedUrl: a.normalizedUrl,
      status: fromDb(auditStatusToDb, a.status),
      categories: a.categories.map((c) => ({
        category: fromDb(categoryToDb, c.category),
        status: fromDb(categoryStatusToDb, c.status),
        score: c.score,
      })),
    };
  }

  async markAuditRunning(id: string) {
    await this.prisma.audit.update({
      where: { id },
      data: { status: auditStatusToDb.running, startedAt: new Date() },
    });
  }

  async markCategoryRunning(id: string, category: AuditCategoryId) {
    await this.prisma.auditCategory.update({
      where: { auditId_category: { auditId: id, category: categoryToDb[category] } },
      data: { status: categoryStatusToDb.running, startedAt: new Date() },
    });
  }

  async saveCategoryResult(id: string, r: AnalyzerResult) {
    // One atomic nested write: update the category and REPLACE its findings, so a retried job never duplicates them.
    await this.prisma.auditCategory.update({
      where: { auditId_category: { auditId: id, category: categoryToDb[r.category] } },
      data: {
        status: categoryStatusToDb[r.status],
        score: r.status === 'completed' ? r.score : null,
        passedCount: r.summary.passed,
        failedCount: r.summary.failed,
        warningCount: r.summary.warnings,
        executionTimeMs: r.executionTimeMs,
        reason: r.reason ?? null,
        completedAt: new Date(),
        findings: {
          deleteMany: {},
          create: r.findings.map((f) => ({
            ruleId: f.ruleId,
            title: f.title,
            description: f.description,
            severity: severityToDb[f.severity],
            status: findingStatusToDb[f.status],
            evidence: f.evidence,
            recommendation: f.recommendation,
            impact: f.impact,
          })),
        },
      },
    });
  }

  async completeAudit(
    id: string,
    outcome: Parameters<AuditStore['completeAudit']>[1],
  ) {
    await this.prisma.audit.update({
      where: { id },
      data: {
        status: auditStatusToDb[outcome.status],
        overallScore: outcome.overallScore,
        errorMessage: outcome.errorMessage ?? null,
        completedAt: new Date(),
      },
    });
  }

  async failAudit(id: string, message: string) {
    await this.completeAudit(id, { status: 'failed', overallScore: null, errorMessage: message });
  }
}
