import { CircleDot, Cloud, FlaskConical, MapPin, Server, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDateTime, relativeTime } from '@/lib/format';
import { SHIPMENT_STATUS } from '@/lib/constants';
import type { ShipmentEvent } from '@/lib/types';
import { Badge, StatusBadge } from '@/components/ui/badge';

const SOURCE_META = {
  CARRIER_API: { label: 'Carrier API', icon: Cloud, tone: 'success' as const },
  SIMULATED: { label: 'Simulated', icon: FlaskConical, tone: 'sim' as const },
  USER: { label: 'Entered by user', icon: User, tone: 'neutral' as const },
  SYSTEM: { label: 'System', icon: Server, tone: 'neutral' as const },
};

const TYPE_LABEL: Record<string, string> = {
  CREATED: 'Created', UPDATED: 'Updated', QUOTED: 'Quoted', QUOTE_SELECTED: 'Offer selected', BOOKED: 'Booked',
  BOOKING_FAILED: 'Booking failed', TRACKING: 'Tracking update', STATUS_CHANGE: 'Status change', CANCELLED: 'Cancelled', NOTE: 'Note',
};

/** Must match DHL_TRACKING_PROVIDER on the server. */
const DHL_TRACKING_PROVIDER = 'dhl-unified-tracking';

/** Vertical event timeline. Every event shows whether it is real, simulated or user-entered. */
export function Timeline({ events, showShipment }: { events: ShipmentEvent[]; showShipment?: boolean }) {
  // DHL's terms of use require this attribution wherever DHL tracking data is shown.
  const fromDhl = events.some((e) => e.source.provider === DHL_TRACKING_PROVIDER);
  return (
    <>
      <ol className="relative">
        {events.map((e, i) => {
          const src = SOURCE_META[e.source.type];
          const tone = e.isException || e.type === 'BOOKING_FAILED' ? 'danger' : e.newStatus ? SHIPMENT_STATUS[e.newStatus].tone : 'neutral';
          const dot = { danger: 'bg-danger', warning: 'bg-warning', success: 'bg-success', accent: 'bg-accent', info: 'bg-info', neutral: 'bg-subtle', sim: 'bg-sim' }[tone];
          const location = [e.location?.city, e.location?.country].filter(Boolean).join(', ');
          return (
            <li key={e._id} className="relative flex gap-4 pb-5 last:pb-0">
              {i < events.length - 1 && <span className="absolute top-4 bottom-0 left-[7px] w-px bg-line" aria-hidden />}
              <span className={cn('relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-surface ring-1 ring-line', dot, i === 0 && 'ring-2 ring-[var(--ring)]')} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-fg">{e.description}</span>
                  {e.newStatus && <StatusBadge status={e.newStatus} />}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <time dateTime={e.occurredAt} title={formatDateTime(e.occurredAt, true)}>
                    {formatDateTime(e.occurredAt, true)} · {relativeTime(e.occurredAt)}
                  </time>
                  {location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{location}</span>}
                  <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-wider text-subtle"><CircleDot className="h-3 w-3" />{TYPE_LABEL[e.type] ?? e.type}</span>
                  <Badge tone={src.tone} className="font-mono text-[10px] tracking-wider uppercase" title={e.source.provider ? `Provider: ${e.source.provider}` : undefined}>
                    <src.icon className="h-3 w-3" />
                    {src.label}{e.source.sandbox ? ' · sandbox' : ''}
                  </Badge>
                  {e.actorName && <span>by {e.actorName}</span>}
                  {showShipment && typeof e.shipmentId === 'object' && <span className="font-mono">{e.shipmentId.reference}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {fromDhl && <p className="mt-3 text-xs text-muted">Delivered by Deutsche Post DHL Group</p>}
    </>
  );
}
