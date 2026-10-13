import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/** Builds a sort query param schema restricted to an allowlist of fields. */
export function sortSchema<const T extends readonly [string, ...string[]]>(fields: T, defaultField: T[number]) {
  return z.object({
    // Cast: Zod can't infer that the default is one of the generic `fields`.
    sortBy: z.enum(fields).default(defaultField as never),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  });
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Escapes user input before using it inside a RegExp (prevents ReDoS / regex injection). */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
