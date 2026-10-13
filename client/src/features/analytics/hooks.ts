import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { Alert, PoStatus, ShipmentStatus } from '@/lib/types';
import type { MapShipment } from '@/components/globe/globe-panel';

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  carrier?: string;
  status?: string;
  poStatus?: string;
}

export interface Overview {
  period: { from: string; to: string };
  shipments: { total: number; byStatus: Partial<Record<ShipmentStatus, number>>; inTransit: number; delivered: number; delayedOrException: number; planning: number };
  freightSpend: { currency: string; totalMinor: number; shipmentCount: number }[];
  averageTransit: { hours: number | null; days: number | null; eligibleCount: number };
  onTimeDelivery: { rate: number | null; onTimeCount: number; eligibleCount: number };
  unresolvedAlerts: number;
  dataProvenance: { simulatedOfferShipments: number; realOfferShipments: number; noOfferShipments: number };
}

export interface Freight {
  monthly: { month: string; currency: string; totalMinor: number; shipmentCount: number }[];
  byCarrier: { carrierCode: string; carrierName: string; currency: string; totalMinor: number; shipmentCount: number; billableKg: number; avgCostPerKgMinor: number | null }[];
}

export interface CarrierPerf {
  carrierCode: string;
  carrierName: string;
  bookedShipments: number;
  cancelled: number;
  delivered: number;
  onTime: { rate: number | null; onTimeCount: number; eligibleCount: number };
  averageTransitDays: { value: number | null; eligibleCount: number };
  shipmentsWithExceptions: number;
}

export interface PoAnalytics {
  byStatus: Partial<Record<PoStatus, { count: number; totals: { currency: string; totalMinor: number }[] }>>;
  totals: { currency: string; totalMinor: number; count: number }[];
  openCommitments: { currency: string; totalMinor: number }[];
}

export interface Savings {
  definition: string;
  byCurrency: { currency: string; comparedShipments: number; shipmentsWithCheaperAlternative: number; potentialSavingsMinor: number; selectedTotalMinor: number }[];
}

export interface DashboardLists {
  recentShipments: { _id: string; reference: string; status: ShipmentStatus; origin: { city: string; country: string }; destination: { city: string; country: string }; carrierName?: string; expectedDeliveryDate?: string; freightCostMinor?: number; currency: string; quoteIsSimulated?: boolean; createdAt: string }[];
  upcomingDeliveries: { _id: string; reference: string; status: ShipmentStatus; destination: { city: string; country: string }; carrierName?: string; expectedDeliveryDate: string }[];
  activeAlerts: Alert[];
  recentPurchaseOrders: { _id: string; poNumber: string; status: PoStatus; totalMinor: number; currency: string; orderDate: string; supplierId?: { name: string } }[];
}

export const useOverview = (f: AnalyticsFilters = {}) =>
  useQuery({ queryKey: keys.analytics.report('overview', f), queryFn: async () => (await api.get<Overview>('/analytics/overview', { ...f })).data });
export const useFreight = (f: AnalyticsFilters = {}) =>
  useQuery({ queryKey: keys.analytics.report('freight', f), queryFn: async () => (await api.get<Freight>('/analytics/freight', { ...f })).data });
export const useCarrierPerf = (f: AnalyticsFilters = {}) =>
  useQuery({ queryKey: keys.analytics.report('carriers', f), queryFn: async () => (await api.get<CarrierPerf[]>('/analytics/carriers', { ...f })).data });
export const usePoAnalytics = (f: AnalyticsFilters = {}) =>
  useQuery({ queryKey: keys.analytics.report('purchase-orders', f), queryFn: async () => (await api.get<PoAnalytics>('/analytics/purchase-orders', { ...f })).data });
export const useSavings = (f: AnalyticsFilters = {}) =>
  useQuery({ queryKey: keys.analytics.report('savings', f), queryFn: async () => (await api.get<Savings>('/analytics/savings', { ...f })).data });
export const useDashboardLists = () =>
  useQuery({ queryKey: keys.analytics.dashboard, queryFn: async () => (await api.get<DashboardLists>('/analytics/dashboard')).data });
export const useMapShipments = () =>
  useQuery({ queryKey: keys.shipments.map, queryFn: async () => (await api.get<MapShipment[]>('/shipments/map')).data });

/**
 * Picks one currency to chart (charts never mix currencies): the organisation's default
 * currency when it has data, otherwise the currency with the most recorded spend.
 */
export function dominantCurrency(rows: { currency: string; totalMinor?: number }[], preferred: string): string {
  if (rows.some((r) => r.currency === preferred)) return preferred;
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + (r.totalMinor ?? 1));
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? preferred;
}
