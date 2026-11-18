import { Router } from 'express';
import { getHealth, type HealthDeps } from '../services/health.js';

export function createHealthRouter(deps: HealthDeps) {
  const router = Router();
  router.get('/', async (_req, res, next) => {
    try {
      const health = await getHealth(deps);
      // 503 lets load balancers / orchestrators pull an unhealthy instance.
      res.status(health.status === 'ok' ? 200 : 503).json({ data: health });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
