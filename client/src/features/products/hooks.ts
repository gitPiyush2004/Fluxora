import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type PageMeta } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { Product } from '@/lib/types';

/** Product page; `meta.categories` feeds the category filter. */
export const useProducts = (params: Record<string, string>) =>
  useQuery({
    queryKey: keys.products.list(params),
    queryFn: () => api.get<Product[], PageMeta & { categories: string[] }>('/products', { ...params, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
