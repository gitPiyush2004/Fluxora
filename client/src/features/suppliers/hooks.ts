import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { AuditEntry, PoStatus, Supplier } from '@/lib/types';

export type SupplierDetail = Supplier & {
  recentOrders: { _id: string; poNumber: string; status: PoStatus; orderDate: string; totalMinor: number; currency: string }[];
  activity: AuditEntry[];
};

export const useSuppliers = (params: Record<string, string>) =>
  useQuery({
    queryKey: keys.suppliers.list(params),
    queryFn: () => api.get<Supplier[]>('/suppliers', { ...params, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });

export const useSupplier = (id: string | undefined) =>
  useQuery({ queryKey: keys.supplier(id), queryFn: async () => (await api.get<SupplierDetail>(`/suppliers/${id}`)).data, enabled: !!id });
