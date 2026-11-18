import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  /** Reverse-proxy hops in front of the API, so req.ip (and rate limiting) use the real client. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(60),
  /** Max audit submissions per IP per window (the expensive operation). */
  AUDIT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
  /** Max consultation requests per IP per window. */
  LEAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
});

export type Env = z.infer<typeof schema>;

/** Validates process.env once at startup; fails fast with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Names + messages only; never echo values (they may be secrets).
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid API environment: ${issues}`);
  }
  return parsed.data;
}
