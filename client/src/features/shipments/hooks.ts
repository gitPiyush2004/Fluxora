import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TRACKABLE_STATUSES } from '@/lib/constants';
import { keys } from '@/lib/query-keys';
import type { CarrierIntegration, QuoteResponse, Shipment, ShipmentEvent } from '@/lib/types';

export interface ShipmentListParams {
  page: string;
  pageSize?: string;
  sortBy: string;
  sortDir: string;
  search: string;
  status: string;
  carrier: string;
  from: string;
  to: string;
  purchaseOrderId?: string;
}

export interface BillableWeight {
  actualWeightKg: number;
  volumetricWeightKg: number | null;
  billableWeightKg: number;
  basis: string;
}

export const useShipments = (params: ShipmentListParams) =>
  useQuery({
    queryKey: keys.shipments.list(params),
    queryFn: () => api.get<Shipment[]>('/shipments', { ...params }),
    placeholderData: keepPreviousData,
  });

export const useShipment = (id: string | undefined) =>
  useQuery({ queryKey: keys.shipment(id), queryFn: async () => (await api.get<Shipment>(`/shipments/${id}`)).data, enabled: !!id });

export const useShipmentEvents = (id: string | undefined) =>
  useQuery({
    queryKey: keys.shipmentEvents(id),
    queryFn: async () => (await api.get<ShipmentEvent[]>(`/shipments/${id}/events`, { order: 'desc', pageSize: 100 })).data,
    enabled: !!id,
  });

export const useShipmentQuotes = (id: string | undefined) =>
  useQuery({ queryKey: keys.shipmentQuotes(id), queryFn: async () => (await api.get<QuoteResponse | null>(`/shipments/${id}/quotes`)).data, enabled: !!id });

/** Booked and in-flight shipments, soonest delivery first (Tracking page). */
export const useInFlightShipments = () =>
  useQuery({
    queryKey: keys.shipments.inFlight,
    queryFn: async () =>
      (await api.get<Shipment[]>('/shipments', { status: TRACKABLE_STATUSES.join(','), sortBy: 'expectedDeliveryDate', sortDir: 'asc', pageSize: 12 })).data,
  });

export const useCarrierIntegrations = () =>
  useQuery({ queryKey: keys.carriers, queryFn: async () => (await api.get<CarrierIntegration[]>('/quotes/carriers')).data, staleTime: 5 * 60_000 });

/** A stored carrier comparison (the Compare page keeps its id in the URL). */
export const useQuoteRequest = (id: string | null) =>
  useQuery({ queryKey: keys.quoteRequest(id), queryFn: async () => (await api.get<QuoteResponse>(`/quotes/requests/${id}`)).data, enabled: !!id });

/** Server-calculated billable weight for the live preview on the shipment form. */
export const useBillableWeight = (input: { actualWeightKg: number; packageCount: number; lengthCm?: number; widthCm?: number; heightCm?: number; divisor: number }, enabled: boolean) =>
  useQuery({
    queryKey: keys.billableWeight(input),
    queryFn: async () => (await api.post<BillableWeight>('/quotes/billable-weight', input)).data,
    enabled,
  });
