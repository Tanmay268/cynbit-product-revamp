/** Operational errors that are safe to show to clients. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: AppError['details']) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const notFound = (message = 'Resource not found') => new AppError(404, 'NOT_FOUND', message);
export const tooManyRequests = (message = 'Too many requests, please slow down') =>
  new AppError(429, 'RATE_LIMITED', message);
export const unprocessable = (message: string, details?: AppError['details']) =>
  new AppError(422, 'UNPROCESSABLE', message, details);
