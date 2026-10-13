import type { NextFunction, Request, Response } from 'express';

/**
 * Defence-in-depth against NoSQL operator injection: removes keys beginning with
 * `$` or containing `.` (and prototype-pollution keys) from request bodies. Query strings
 * use the `simple` parser and strict Zod schemas, so they only ever contain scalar values.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 20) return undefined;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') req.body = scrub(req.body);
  next();
}
