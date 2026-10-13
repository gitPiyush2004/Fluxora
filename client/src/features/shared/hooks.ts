import { useEffect, useEffectEvent, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Debounces a fast-changing value (search boxes, weight sliders). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/**
 * A search box that writes its value to the URL once the user stops typing.
 * Returns the live input value and its setter, like `useState`.
 */
export function useDebouncedSearch(urlValue: string, onSearch: (value: string) => void) {
  const [value, setValue] = useState(urlValue);
  const debounced = useDebounced(value);
  // Effect events always see the latest props without re-running the effect.
  const commit = useEffectEvent((next: string) => {
    if (next !== urlValue) onSearch(next);
  });
  useEffect(() => commit(debounced), [debounced]);
  return [value, setValue] as const;
}

/**
 * Table state (page, sort, filters) kept in the URL so lists are shareable and
 * survive refresh / back navigation.
 */
export function useUrlState<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const state = Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, params.get(k) ?? d])) as T;
  const update = (patch: Partial<T>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries({ ...(resetPage && !('page' in patch) ? { page: '1' } : {}), ...patch })) {
          if (v === undefined || v === '' || v === defaults[k]) next.delete(k);
          else next.set(k, String(v));
        }
        return next;
      },
      { replace: true },
    );
  };
  return [state, update] as const;
}
