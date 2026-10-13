import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import type { Alert, AlertSeverity, ShipmentEvent } from '@/lib/types';

export interface AlertSummary {
  open: number;
  acknowledged: number;
  unresolved: number;
  bySeverity: Record<AlertSeverity, number>;
}

/** Unresolved alert counts (sidebar badge and Tracking page tiles). Refreshed every minute. */
export const useAlertSummary = () =>
  useQuery({ queryKey: keys.alerts.summary, queryFn: async () => (await api.get<AlertSummary>('/alerts/summary')).data, refetchInterval: 60_000 });

export const useAlerts = (params: Record<string, string>) =>
  useQuery({
    queryKey: keys.alerts.list(params),
    queryFn: () => api.get<Alert[]>('/alerts', { ...params, pageSize: 15 }),
    placeholderData: keepPreviousData,
  });

/** The six newest unresolved alerts for the notifications menu. */
export const useAlertMenu = () =>
  useQuery({ queryKey: keys.alerts.menu, queryFn: () => api.get<Alert[]>('/alerts', { status: 'UNRESOLVED', pageSize: 6 }), refetchInterval: 60_000 });

/** Latest tracking events across the organisation. */
export const useEventFeed = () =>
  useQuery({ queryKey: keys.eventFeed, queryFn: async () => (await api.get<ShipmentEvent[]>('/alerts/feed/events', { limit: 25 })).data, refetchInterval: 60_000 });
