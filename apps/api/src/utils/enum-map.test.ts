import * as prisma from '@prisma/client';
import { AUDIT_CATEGORIES, AUDIT_STATUSES, CATEGORY_STATUSES, FINDING_STATUSES, SEVERITIES } from '@wi/shared';
import { describe, expect, it } from 'vitest';
import {
  auditStatusToDb,
  categoryStatusToDb,
  categoryToDb,
  findingStatusToDb,
  severityToDb,
} from './enum-map.js';

// Guards against the Prisma schema and the shared contract drifting apart.
const cases = [
  ['AuditStatus', AUDIT_STATUSES, auditStatusToDb],
  ['CategoryKey', AUDIT_CATEGORIES, categoryToDb],
  ['CategoryStatus', CATEGORY_STATUSES, categoryStatusToDb],
  ['Severity', SEVERITIES, severityToDb],
  ['FindingStatus', FINDING_STATUSES, findingStatusToDb],
] as const;

describe('prisma enums match shared constants', () => {
  for (const [name, shared, map] of cases) {
    it(name, () => {
      const dbValues = Object.values((prisma as unknown as Record<string, Record<string, string>>)[name]!);
      expect(Object.keys(map).sort()).toEqual([...shared].sort());
      expect(Object.values(map).sort()).toEqual([...dbValues].sort());
    });
  }
});
