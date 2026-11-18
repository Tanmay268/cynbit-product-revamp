import { Router, type RequestHandler } from 'express';
import { createLeadSchema, type CreateLeadInput } from '@wi/shared';
import { validate } from '../middleware/validate.js';
import type { LeadService } from '../services/lead-service.js';

/** `limiter` is strict: a human submits a handful of consultation requests, never dozens. */
export function createLeadsRouter(service: LeadService, limiter: RequestHandler) {
  const router = Router();
  router.post('/', limiter, validate({ body: createLeadSchema }), async (req, res, next) => {
    try {
      res.status(201).json({ data: await service.create(req.body as CreateLeadInput) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
