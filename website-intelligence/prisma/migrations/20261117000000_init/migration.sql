-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "CategoryKey" AS ENUM ('PERFORMANCE', 'SEO', 'ACCESSIBILITY', 'SECURITY', 'BEST_PRACTICES');

-- CreateEnum
CREATE TYPE "CategoryStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'UNAVAILABLE', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('FAILED', 'WARNING', 'PASSED');

-- CreateTable
CREATE TABLE "Audit" (
    "id" UUID NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "overallScore" INTEGER,
    "status" "AuditStatus" NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditCategory" (
    "id" UUID NOT NULL,
    "auditId" UUID NOT NULL,
    "category" "CategoryKey" NOT NULL,
    "score" INTEGER,
    "status" "CategoryStatus" NOT NULL DEFAULT 'PENDING',
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER,
    "reason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AuditCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFinding" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "ruleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "evidence" TEXT,
    "recommendation" TEXT NOT NULL,
    "impact" TEXT,
    "status" "FindingStatus" NOT NULL,
    "technicalDetails" JSONB,

    CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Audit_normalizedUrl_createdAt_idx" ON "Audit"("normalizedUrl", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Audit_createdAt_idx" ON "Audit"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Audit_status_idx" ON "Audit"("status");

-- CreateIndex
CREATE INDEX "AuditCategory_auditId_idx" ON "AuditCategory"("auditId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditCategory_auditId_category_key" ON "AuditCategory"("auditId", "category");

-- CreateIndex
CREATE INDEX "AuditFinding_categoryId_idx" ON "AuditFinding"("categoryId");

-- CreateIndex
CREATE INDEX "AuditFinding_severity_idx" ON "AuditFinding"("severity");

-- CreateIndex
CREATE INDEX "AuditFinding_ruleId_idx" ON "AuditFinding"("ruleId");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- AddForeignKey
ALTER TABLE "AuditCategory" ADD CONSTRAINT "AuditCategory_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AuditCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

