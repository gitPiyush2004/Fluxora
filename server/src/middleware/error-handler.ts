import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { isProd } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, requestId: req.id } });
}

/** Converts any thrown error into the standard error envelope without leaking internals. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let appErr: AppError;

  if (err instanceof AppError) {
    appErr = err;
  } else if (err instanceof mongoose.Error.ValidationError) {
    appErr = new AppError(
      422,
      'VALIDATION_ERROR',
      'Validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  } else if (err instanceof mongoose.Error.CastError) {
    appErr = new AppError(400, 'BAD_REQUEST', `Invalid value for ${err.path}`);
  } else if (err instanceof mongoose.Error.VersionError) {
    appErr = new AppError(409, 'CONFLICT', 'This record was modified by someone else. Reload and try again.');
  } else if (typeof err === 'object' && err && (err as { code?: number }).code === 11000) {
    const keys = Object.keys((err as { keyValue?: Record<string, unknown> }).keyValue ?? {}).filter((k) => k !== 'organizationId');
    appErr = new AppError(409, 'CONFLICT', `A record with the same ${keys.join(', ') || 'key'} already exists`, { fields: keys });
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.too.large') {
    appErr = new AppError(413, 'BAD_REQUEST', 'Request body too large');
  } else if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.parse.failed') {
    appErr = new AppError(400, 'BAD_REQUEST', 'Malformed JSON body');
  } else {
    logger.error({ err, requestId: req.id, path: req.path }, 'Unhandled error');
    appErr = new AppError(500, 'INTERNAL_ERROR', isProd ? 'An unexpected error occurred' : String((err as Error)?.message ?? err));
  }

  if (appErr.status >= 500 && appErr.code !== 'INTERNAL_ERROR') {
    logger.warn({ code: appErr.code, message: appErr.message, requestId: req.id }, 'Request failed');
  }

  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message, details: appErr.details, requestId: req.id },
  });
}
