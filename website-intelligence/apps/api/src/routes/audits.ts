import { Router, type RequestHandler } from 'express';
import { compareParamsSchema, createAuditSchema, listAuditsQuerySchema, uuidParamSchema, type CreateAuditInput } from '@wi/shared';
import type { z } from 'zod';
import { validate } from '../middleware/validate.js';
import type { AuditService } from '../services/audit-service.js';

type Handler = (req: Parameters<RequestHandler>[0]) => Promise<unknown>;
const wrap =
  (status: number, fn: Handler): RequestHandler =>
  async (req, res, next) => {
    try {
      res.status(status).json({ data: await fn(req) });
    } catch (err) {
      next(err);
    }
  };

/** `createLimiter` is stricter than the global limiter: starting an audit is the expensive operation. */
export function createAuditsRouter(service: AuditService, createLimiter: RequestHandler) {
  const router = Router();

  // 202 Accepted: the work is queued, not done. Clients poll /:id/status.
  router.post(
    '/',
    createLimiter,
    validate({ body: createAuditSchema }),
    wrap(202, (req) => service.create((req.body as CreateAuditInput).url)),
  );

  router.get(
    '/',
    validate({ query: listAuditsQuerySchema }),
    wrap(200, (req) => service.list(req.query as unknown as z.infer<typeof listAuditsQuerySchema>)),
  );

  router.get(
    '/compare/:firstId/:secondId',
    validate({ params: compareParamsSchema }),
    wrap(200, (req) => service.compare(req.params.firstId as string, req.params.secondId as string)),
  );

  const idParam = validate({ params: uuidParamSchema });
  router.get('/:id', idParam, wrap(200, (req) => service.getStatus(req.params.id as string)));
  router.get('/:id/status', idParam, wrap(200, (req) => service.getStatus(req.params.id as string)));
  router.get('/:id/report', idParam, wrap(200, (req) => service.getReport(req.params.id as string)));

  return router;
}
