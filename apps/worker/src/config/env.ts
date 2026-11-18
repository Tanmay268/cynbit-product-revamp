import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Wall-clock budget per analyzer (not per audit). */
  AUDIT_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(120_000),
  MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).default(5_242_880),
  PAGESPEED_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)), // an empty "PAGESPEED_API_KEY=" means "not set"
  /** Disable Chromium's sandbox. Only for locked-down containers that cannot grant the sandbox its kernel features. */
  BROWSER_NO_SANDBOX: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type WorkerEnv = z.infer<typeof schema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Names + messages only; never echo values (they may be secrets).
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid worker environment: ${issues}`);
  }
  return parsed.data;
}
