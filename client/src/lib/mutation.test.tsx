import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { useMutation } from './mutation';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe('guarded useMutation', () => {
  it('drops a repeated call with the same variables while the first is in flight', async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => (release = r)));
    const { result } = renderHook(() => useMutation({ mutationFn: fn }), { wrapper });
    await act(async () => {
      result.current.mutate();
      result.current.mutate(); // double-click before the re-render disables the button
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => release());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => result.current.mutate()); // a deliberate later retry still runs
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it('lets calls with different variables run concurrently and releases after errors', async () => {
    const fn = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('nope');
      return id;
    });
    const { result } = renderHook(() => useMutation({ mutationFn: fn }), { wrapper });
    await act(async () => {
      result.current.mutate('a');
      result.current.mutate('b');
      result.current.mutate('bad');
    });
    expect(fn).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => result.current.mutate('bad'));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(4));
  });
});
