import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { tooManyRequests } from '../utils/errors.js';

/**
 * Per-IP limiter. Behind a proxy/load balancer set `trust proxy` (see app.ts) or
 * every client will share the proxy's IP. In-memory store is per-process; use a
 * Redis store if the API is scaled horizontally (documented in Milestone 7).
 */
export function createRateLimiter(opts: { windowMs: number; max: number; skip?: (req: Request) => boolean }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: opts.skip,
    handler: (_req, _res, next) => next(tooManyRequests()),
  });
}
