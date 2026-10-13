import { Types } from 'mongoose';
import { z } from 'zod';
import { validationError } from './errors.js';

/** Parses input with a Zod schema, throwing a 422 with field-level issues on failure. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError(
      'Request validation failed',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export const objectId = z
  .string()
  .refine((v) => /^[a-f0-9]{24}$/i.test(v) && Types.ObjectId.isValid(v), { message: 'Invalid identifier' });

export const idParams = z.object({ id: objectId });

/** Body of the activate / deactivate endpoints. */
export const activeInput = z.object({ isActive: z.boolean() });

/** Optional free text: trimmed, with a maximum length. */
export const text = (max: number) => z.string().trim().max(max);
/** Required free text: trimmed, non-empty, with a maximum length. */
export const requiredText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** Comma-separated query value restricted to an allowlist, e.g. `status=IN_TRANSIT,DELAYED`. */
export function csvList<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));
}
