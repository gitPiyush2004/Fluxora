import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { Alert } from '@/lib/types';
import { ALERT_TYPE_LABEL } from '@/lib/constants';
import { keys } from '@/lib/query-keys';
import { useAuth } from './auth';

type Status = 'connecting' | 'live' | 'offline';
const Ctx = createContext<Status>('offline');

/**
 * Socket.IO connection, authenticated by the session cookie. The server assigns the
 * organisation room; on each event we refresh the affected React Query caches.
 * Reconnects whenever the active organisation changes.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('connecting');
  const orgId = me?.organization.id;

  useEffect(() => {
    if (!orgId) return;
    const url = import.meta.env.VITE_API_URL || undefined;
    const socket: Socket = io(url ?? '/', { path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setStatus('live'));
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));

    const refresh = (queryKey: readonly unknown[]) => void qc.invalidateQueries({ queryKey });

    const onShipmentChange = (shipmentId: string) => {
      refresh(keys.shipments.all);
      refresh(keys.shipment(shipmentId));
      refresh(keys.shipmentEvents(shipmentId));
      refresh(keys.eventFeed);
      refresh(keys.analytics.all);
    };
    socket.on('shipment:updated', (p: { id: string }) => onShipmentChange(p.id));
    socket.on('shipment:event', (p: { shipmentId: string }) => onShipmentChange(p.shipmentId));

    socket.on('purchase-order:updated', (p: { id: string }) => {
      refresh(keys.purchaseOrders.all);
      refresh(keys.purchaseOrder(p.id));
    });

    const onAlert = (alert: Alert, created: boolean) => {
      refresh(keys.alerts.all);
      refresh(keys.analytics.all);
      refresh(keys.shipment(alert.shipmentId));
      if (created && (alert.severity === 'HIGH' || alert.severity === 'CRITICAL')) {
        toast.warning(`${ALERT_TYPE_LABEL[alert.type] ?? 'Exception'} · ${alert.shipmentReference}`, { description: alert.message });
      }
    };
    socket.on('alert:created', (a: Alert) => onAlert(a, true));
    socket.on('alert:updated', (a: Alert) => onAlert(a, false));

    return () => {
      socket.removeAllListeners();
      socket.close();
      setStatus('offline');
    };
  }, [orgId, qc]);

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}

export function useRealtimeStatus(): Status {
  return useContext(Ctx);
}
