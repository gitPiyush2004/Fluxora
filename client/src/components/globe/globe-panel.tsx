import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Crosshair, Globe2 } from 'lucide-react';
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

/** Globe with HUD chrome: telemetry readout, legend and live-link indicator. */
export function GlobePanel({ shipments, height = 420 }: { shipments: MapShipment[]; height?: number }) {
  const navigate = useNavigate();
  const status = useRealtimeStatus();
  const [tele, setTele] = useState<{ lat: number; lng: number; altitude: number } | null>(null);
  const routes = useMemo(() => toRoutes(shipments), [shipments]);
  const active = shipments.filter((s) => !['DELIVERED', 'CANCELLED'].includes(s.status)).length;
  const problems = shipments.filter((s) => s.status === 'DELAYED' || s.status === 'EXCEPTION').length;
  const canRender = useMemo(() => webglAvailable(), []);
  const openRoute = useCallback((r: GlobeRoute) => navigate(`/shipments/${r.id}`), [navigate]);

  return (
    <div className="hud-frame relative overflow-hidden rounded-xl border border-line bg-surface shadow-panel">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-4">
        <div>
          <div className="hud-label flex items-center gap-2 text-accent">
            <span className={status === 'live' ? 'h-1.5 w-1.5 rounded-full bg-success animate-blink' : 'h-1.5 w-1.5 rounded-full bg-subtle'} />
            Live ops view · {status === 'live' ? 'Link up' : status === 'connecting' ? 'Linking' : 'Offline'}
          </div>
          <div className="mt-1 text-lg font-semibold tracking-tight">Global lanes</div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">
            {active} ACTIVE · {problems} FLAGGED · {shipments.length} ROUTES
          </div>
        </div>
        <div className="hidden text-right font-mono text-[10.5px] leading-5 text-subtle sm:block" aria-hidden>
          <div>LAT {tele ? tele.lat.toFixed(2).padStart(7, ' ') : '  --.--'}</div>
          <div>LNG {tele ? tele.lng.toFixed(2).padStart(7, ' ') : '  --.--'}</div>
          <div>ALT {tele ? tele.altitude.toFixed(2) : '-.--'}</div>
        </div>
      </div>

      {canRender ? (
        <Suspense fallback={<div className="skeleton m-4" style={{ height: height - 32 }} />}>
          <OpsGlobe routes={routes} height={height} onTelemetry={setTele} onRouteClick={openRoute} />
        </Suspense>
      ) : (
        <div className="grid place-items-center text-center text-sm text-muted" style={{ height }}>
          <div>
            <Globe2 className="mx-auto mb-2 h-8 w-8 text-subtle" />
            3D view unavailable (WebGL is disabled in this browser).
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 p-4 font-mono text-[10.5px] text-muted">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-accent" /> In motion</span>
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-danger" /> Delayed / exception</span>
          <span className="flex items-center gap-1.5"><i className="h-0.5 w-4 bg-success opacity-50" /> Delivered</span>
        </div>
        <span className="flex items-center gap-1.5">
          <Crosshair className="h-3 w-3" /> Click a lane to open the shipment
        </span>
      </div>
    </div>
  );
}
