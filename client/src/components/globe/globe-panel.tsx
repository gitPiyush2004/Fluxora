import { lazy, Suspense, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Globe2 } from 'lucide-react';
import { coordsFor, placeLabel } from '@/lib/geo';
import type { ShipmentStatus } from '@/lib/types';
import { useRealtimeStatus } from '@/providers/realtime';
import { webglAvailable, type GlobeRoute } from './globe-utils';

const OpsGlobe = lazy(() => import('./ops-globe'));

export interface MapShipment {
  _id: string;
  reference: string;
  status: ShipmentStatus;
  origin: { city: string; country: string };
  destination: { city: string; country: string };
  carrierName?: string;
}

export function toRoutes(items: MapShipment[]): GlobeRoute[] {
  return items.map((s) => ({
    id: s._id,
    status: s.status,
    label: `${s.reference} · ${placeLabel(s.origin)} → ${placeLabel(s.destination)}${s.carrierName ? ` · ${s.carrierName}` : ''}`,
    from: { ...coordsFor(s.origin.city, s.origin.country), name: placeLabel(s.origin) },
    to: { ...coordsFor(s.destination.city, s.destination.country), name: placeLabel(s.destination) },
  }));
}

/** Dashboard globe: shipment lanes with a title, counts, live-update status and a legend. */
export function GlobePanel({ shipments, height = 420 }: { shipments: MapShipment[]; height?: number }) {
  const navigate = useNavigate();
  const status = useRealtimeStatus();
  const routes = useMemo(() => toRoutes(shipments), [shipments]);
  const active = shipments.filter((s) => !['DELIVERED', 'CANCELLED'].includes(s.status)).length;
  const problems = shipments.filter((s) => s.status === 'DELAYED' || s.status === 'EXCEPTION').length;
  const canRender = useMemo(() => webglAvailable(), []);
  const openRoute = useCallback((r: GlobeRoute) => navigate(`/shipments/${r.id}`), [navigate]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-fg">Shipment lanes</h2>
          <p className="mt-0.5 text-sm text-muted tabular">
            {active} active · {problems} delayed · {shipments.length} lanes
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface/80 px-2.5 py-1 text-xs text-muted">
          <span className={status === 'live' ? 'h-1.5 w-1.5 rounded-full bg-success' : 'h-1.5 w-1.5 rounded-full bg-subtle'} aria-hidden />
          {status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'}
        </span>
      </div>

      {canRender ? (
        <Suspense fallback={<div className="skeleton m-4" style={{ height: height - 32 }} />}>
          <OpsGlobe routes={routes} height={height} onRouteClick={openRoute} />
        </Suspense>
      ) : (
        <div className="grid place-items-center text-center text-sm text-muted" style={{ height }}>
          <div>
            <Globe2 className="mx-auto mb-2 h-8 w-8 text-subtle" />
            3D view unavailable (WebGL is disabled in this browser).
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 p-5 text-xs text-muted">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded-full bg-accent" /> Moving</span>
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded-full bg-danger" /> Delayed</span>
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 rounded-full bg-success opacity-60" /> Delivered</span>
        </div>
        <span className="hidden sm:inline">Drag to rotate · select a lane to open it</span>
      </div>
    </div>
  );
}
