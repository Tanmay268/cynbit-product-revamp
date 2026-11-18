import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import { createErrorHandler, notFoundHandler, requestId } from './middleware/error-handler.js';
import { createRateLimiter } from './middleware/rate-limit.js';
import { createAuditsRouter } from './routes/audits.js';
import { createHealthRouter } from './routes/health.js';
import { createLeadsRouter } from './routes/leads.js';
import type { AuditService } from './services/audit-service.js';
import type { HealthDeps } from './services/health.js';
import type { LeadService } from './services/lead-service.js';

export interface AppDeps {
  env: Pick<Env, 'CORS_ORIGINS' | 'RATE_LIMIT_WINDOW_MS' | 'RATE_LIMIT_MAX' | 'AUDIT_RATE_LIMIT_MAX' | 'LEAD_RATE_LIMIT_MAX'> &
    Partial<Pick<Env, 'TRUST_PROXY_HOPS'>>;
  health: HealthDeps;
  audits: AuditService;
  leads: LeadService;
  logger?: Pick<Console, 'error'>;
}

export function createApp({ env, health, audits, leads, logger }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Trust exactly N proxy hops so req.ip is the real client (too high = spoofable, too low = everyone shares the proxy's IP).
  app.set('trust proxy', env.TRUST_PROXY_HOPS ?? 1);

  app.use(requestId);
  app.use(helmet()); // JSON API: default CSP/HSTS/nosniff/frame headers are appropriate
  app.use(
    cors({
      // Exact-match allowlist. Non-listed origins get no CORS headers, so browsers block them.
      origin: (origin, cb) => cb(null, !origin || env.CORS_ORIGINS.includes(origin)),
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  // Health is mounted before the limiter so orchestrator probes are never throttled.
  app.use('/api/v1/health', createHealthRouter(health));

  app.use('/api/v1', createRateLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX }));
  app.use(
    '/api/v1/audits',
    createAuditsRouter(audits, createRateLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.AUDIT_RATE_LIMIT_MAX })),
  );
  app.use(
    '/api/v1/leads',
    createLeadsRouter(leads, createRateLimiter({ windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.LEAD_RATE_LIMIT_MAX })),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
