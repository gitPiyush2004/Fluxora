/**
 * Thin fetch wrapper for the Fluxora REST API.
 * - Cookies carry the HttpOnly session; the CSRF token lives only in memory.
 * - Non-GET requests send X-CSRF-Token; a stale token is refreshed and the request retried once.
 * - 401 responses broadcast `fluxora:unauthenticated` so the auth layer can redirect.
 */
const BASE = `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api/v1`;

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path: string; message: string }[] | Record<string, unknown>;
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorBody['details'],
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level validation messages keyed by dotted path. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]));
  }
}

export interface Envelope<T, M = unknown> {
  data: T;
  meta?: M;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function fetchCsrf(): Promise<string> {
  csrfPromise ??= fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) throw new ApiError(r.status, 'CSRF_FETCH_FAILED', 'Could not start a secure session');
      const body = (await r.json()) as Envelope<{ csrfToken: string }>;
      csrfToken = body.data.csrfToken;
      return csrfToken;
    })
    .finally(() => {
      csrfPromise = null;
    });
  return csrfPromise;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = `${BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function request<T, M = PageMeta>(path: string, opts: RequestOptions = {}, retried = false): Promise<Envelope<T, M>> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken ?? (await fetchCsrf());

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the Fluxora API. Check your connection and try again.');
  }

  if (res.status === 204) return { data: undefined as T };
  const body = (await res.json().catch(() => null)) as (Envelope<T, M> & { error?: ApiErrorBody }) | null;

  if (!res.ok) {
    const err = body?.error;
    if (res.status === 403 && err?.code === 'CSRF_INVALID' && !retried) {
      await fetchCsrf();
      return request<T, M>(path, opts, true);
    }
    if (res.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('fluxora:unauthenticated'));
    }
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details, err?.requestId);
  }
  return body as Envelope<T, M>;
}

export const api = {
  get: <T, M = PageMeta>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => request<T, M>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>(path, { method: 'POST', body: body ?? {}, headers }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** A user-facing message for any error; validation errors include the first field problem. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const firstField = Object.values(err.fieldErrors)[0];
    return err.code === 'VALIDATION_ERROR' && firstField ? `${err.message}: ${firstField}` : err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

/** Random idempotency key for one user-initiated attempt (double clicks reuse it). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
