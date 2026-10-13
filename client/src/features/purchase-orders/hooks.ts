import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { Product, PurchaseOrder, Supplier } from '@/lib/types';

export const usePurchaseOrders = (params: Record<string, string>) =>
  useQuery({
    queryKey: keys.purchaseOrders.list(params),
    queryFn: () => api.get<PurchaseOrder[]>('/purchase-orders', { ...params, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

export const usePurchaseOrder = (id: string | undefined) =>
  useQuery({ queryKey: keys.purchaseOrder(id), queryFn: async () => (await api.get<PurchaseOrder>(`/purchase-orders/${id}`)).data, enabled: !!id });

/** Active suppliers for the PO form's dropdown. */
export const useActiveSuppliers = () =>
  useQuery({
    queryKey: keys.suppliers.activeOptions,
    queryFn: async () => (await api.get<Supplier[]>('/suppliers', { status: 'active', pageSize: 100, sortBy: 'name', sortDir: 'asc' })).data,
  });

/** Active products for the PO form's line picker. */
export const useActiveProducts = () =>
  useQuery({
    queryKey: keys.products.activeOptions,
    queryFn: async () => (await api.get<Product[]>('/products', { status: 'active', pageSize: 100, sortBy: 'name', sortDir: 'asc' })).data,
  });
