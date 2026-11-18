import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiError } from '@wi/shared';
import { AppError, notFound } from '../utils/errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

/** Attaches a request id (also returned as a header) so users can quote it and we can find the log line. */
export const requestId: RequestHandler = (req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound('Route not found'));

type Logger = Pick<Console, 'error'>;

/**
 * Single place errors are turned into responses. Clients only ever see AppError
 * messages or a generic string: never stack traces, SQL, or library messages.
 */
export const createErrorHandler =
  (logger: Logger = console): ErrorRequestHandler =>
  (err, req, res, _next) => {
    let status = 500;
    let body: ApiError['error'] = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong. Please try again later.',
      requestId: req.id,
    };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message, requestId: req.id, details: err.details };
    } else if (isDatabaseUnavailable(err)) {
      status = 503;
      body = {
        code: 'SERVICE_UNAVAILABLE',
        message: 'The service is temporarily unavailable. Please try again shortly.',
        requestId: req.id,
      };
      logger.error(`[api] database unavailable requestId=${req.id}`);
    } else if (isBodyParserError(err)) {
      status = err.status;
      body =
        err.type === 'entity.too.large'
          ? { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large', requestId: req.id }
          : { code: 'BAD_REQUEST', message: 'Malformed request body', requestId: req.id };
    } else {
      logger.error(`[api] unhandled error requestId=${req.id}`, err);
    }

    res.status(status).json({ error: body } satisfies ApiError);
  };

/** Prisma connection failures: P1001/P1002 unreachable, P1008 timeout, P2024 pool timeout, or failed client init. */
export function isDatabaseUnavailable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; code?: unknown };
  return (
    e.name === 'PrismaClientInitializationError' ||
    (typeof e.code === 'string' && ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(e.code))
  );
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { type?: unknown; status?: unknown };
  return typeof e.type === 'string' && e.type.startsWith('entity.') && typeof e.status === 'number';
}
