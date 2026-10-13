import { CarrierError, type CarrierCode } from './types.js';

/**
 * fetch wrapper that maps transport/HTTP failures onto CarrierError kinds so the
 * quote orchestrator can report each provider's outcome independently.
 */
export async function carrierFetch<T = unknown>(
  carrier: CarrierCode,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (err) {
    if (signal.aborted) throw new CarrierError(carrier, 'TIMEOUT', 'Carrier API did not respond in time');
    throw new CarrierError(carrier, 'UNAVAILABLE', `Carrier API unreachable: ${(err as Error).message}`);
  }

  const bodyText = await res.text().catch(() => '');
  let body: unknown;
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    body = undefined;
  }

  if (res.ok) return body as T;

  const detail = extractMessage(body) ?? (bodyText.slice(0, 300) || res.statusText);
  if (res.status === 401 || res.status === 403) throw new CarrierError(carrier, 'AUTH', `Authentication failed: ${detail}`, res.status);
  if (res.status === 429) throw new CarrierError(carrier, 'RATE_LIMITED', 'Carrier API rate limit reached — try again later', res.status);
  if (res.status === 400 || res.status === 404 || res.status === 422) throw new CarrierError(carrier, 'VALIDATION', detail, res.status);
  if (res.status >= 500) throw new CarrierError(carrier, 'UNAVAILABLE', `Carrier service error (${res.status})`, res.status);
  throw new CarrierError(carrier, 'UNKNOWN', `Unexpected response (${res.status}): ${detail}`, res.status);
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.detail === 'string') return b.detail;
  if (typeof b.message === 'string') return b.message;
  if (typeof b.title === 'string') return b.title;
  const errors = b.errors;
  if (Array.isArray(errors) && errors[0] && typeof (errors[0] as { message?: unknown }).message === 'string') {
    return (errors[0] as { message: string }).message;
  }
  return undefined;
}
