import { useRef } from 'react';
import { useMutation as useTanstackMutation, type DefaultError, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query';

/**
 * `useMutation` that ignores a repeated `mutate` call with the same variables while the
 * previous one is still in flight. TanStack's `isPending` only disables a button after the
 * next render, so a fast double-click would otherwise send two requests (receive goods twice,
 * create two shipments…). Calls with different variables (e.g. acknowledging two different
 * alerts) still run concurrently. Server-side checks remain the real guarantee.
 */
export function useMutation<TData = unknown, TError = DefaultError, TVariables = void, TContext = unknown>(
  options: UseMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const result = useTanstackMutation(options);
  const inFlight = useRef<Set<string>>(null);
  const mutate: typeof result.mutate = (...args) => {
    inFlight.current ??= new Set();
    const pending = inFlight.current;
    const key = JSON.stringify(args[0]) ?? '';
    if (pending.has(key)) return;
    pending.add(key);
    // Same semantics as TanStack's own mutate (mutateAsync with errors swallowed).
    result
      .mutateAsync(...args)
      .catch(() => undefined)
      .finally(() => pending.delete(key));
  };
  return { ...result, mutate };
}
