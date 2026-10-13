export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'NOT_SUPPORTED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details);
export const validationError = (message: string, details?: unknown) =>
  new AppError(422, 'VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (entity = 'Resource') => new AppError(404, 'NOT_FOUND', `${entity} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details);
export const invalidTransition = (entity: string, from: string, to: string) =>
  new AppError(409, 'INVALID_TRANSITION', `${entity} cannot move from ${from} to ${to}`, { from, to });
export const providerError = (message: string, details?: unknown) =>
  new AppError(502, 'PROVIDER_ERROR', message, details);
export const notSupported = (message: string) => new AppError(422, 'NOT_SUPPORTED', message);
