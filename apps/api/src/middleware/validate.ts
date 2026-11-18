import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../utils/errors.js';

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

/**
 * Validates and replaces req.body / req.query / req.params with the parsed
 * (trimmed, coerced, unknown-keys-stripped) values. Handlers only see clean data.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    const details: { path: string; message: string }[] = [];
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (result.success) {
        Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true });
      } else {
        for (const issue of result.error.issues) {
          details.push({ path: [part, ...issue.path].join('.'), message: issue.message });
        }
      }
    }
    if (details.length > 0) return next(badRequest('Request validation failed', details));
    next();
  };
}

export type Parsed<T extends ZodTypeAny> = z.infer<T>;
