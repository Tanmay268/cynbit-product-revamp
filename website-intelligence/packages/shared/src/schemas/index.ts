import { z } from 'zod';
import { AUDIT_CATEGORIES, SEVERITIES } from '../constants/index.js';

export const auditCategorySchema = z.enum(AUDIT_CATEGORIES);
export const severitySchema = z.enum(SEVERITIES);
export const uuidParamSchema = z.object({ id: z.string().uuid() });

export const createAuditSchema = z
  .object({ url: z.string().trim().min(1, 'Enter a website URL').max(2048, 'URL is too long') })
  .strict();
export type CreateAuditInput = z.infer<typeof createAuditSchema>;

/**
 * Audits have no accounts, so a global listing would expose every visitor's submitted URLs.
 * History is therefore capability-based: callers must name the audit ids they know (the web app
 * keeps its own in localStorage). Ids are unguessable UUIDs.
 */
export const listAuditsQuerySchema = z.object({
  ids: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1, 'Provide at least one audit id').max(50, 'At most 50 ids')),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  /** Optional: narrow the given ids to one site. */
  url: z.string().trim().max(2048).optional(),
});

export const compareParamsSchema = z.object({
  firstId: z.string().uuid(),
  secondId: z.string().uuid(),
});

const dependencyStatus = z.enum(['up', 'down']);

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
  checks: z.object({ database: dependencyStatus, redis: dependencyStatus }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Standard error envelope returned by every failing API call. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Control characters (except tab/newline in the message) have no place in contact details. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const noControl = (s: string) => !CONTROL_CHARS.test(s);

const text = (label: string, min: number, max: number, minMessage = `Enter your ${label}`) =>
  z
    .string({ required_error: minMessage })
    .trim()
    .min(min, minMessage)
    .max(max, `${label[0]!.toUpperCase()}${label.slice(1)} must be at most ${max} characters`)
    .refine(noControl, `${label[0]!.toUpperCase()}${label.slice(1)} contains invalid characters`);

/**
 * Consultation request. Shared by the API (authority) and the web form (instant feedback)
 * so both always agree. `website` is stored as text and never fetched, so this check is
 * syntactic only: a hostname with a dot, optional http(s) scheme, no spaces.
 */
export const createLeadSchema = z
  .object({
    name: text('name', 2, 100, 'Enter your name'),
    email: z
      .string({ required_error: 'Enter your work email' })
      .trim()
      .toLowerCase()
      .min(1, 'Enter your work email')
      .max(254, 'Email is too long')
      .email('Enter a valid email address'),
    company: text('company', 1, 150, 'Enter your company name'),
    website: z
      .string({ required_error: 'Enter your website' })
      .trim()
      .min(1, 'Enter your website')
      .max(2048, 'Website is too long')
      .refine((v) => /^(https?:\/\/)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#]\S*)?$/i.test(v), 'Enter a valid website, like example.com'),
    message: text('message', 10, 2000, 'Tell us a little about what you need (at least 10 characters)'),
    /** Honeypot: hidden from people, filled by bots. Anything here is silently discarded. */
    hp: z.string().max(200).optional(),
  })
  .strict();
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
