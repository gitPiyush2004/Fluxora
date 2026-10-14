import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { ArrowRight, Ban, CalendarCheck, Check, ClipboardList, FastForward, GitCompareArrows, NotebookPen, Pencil, RefreshCw, Tag, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ALERT_TYPE_LABEL, CANCELLABLE_STATUSES, PLANNING_STATUSES, SHIPMENT_STATUS, TRACKABLE_STATUSES } from '@/lib/constants';
import { formatDate, formatDateTime, formatMoney, formatWeight, relativeTime } from '@/lib/format';
import { countryName } from '@/lib/geo';
import type { Quote, QuoteResponse, Shipment, ShipmentStatus } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { useSession } from '@/providers/auth';
import { Badge, PoStatusBadge, SeverityBadge, SimulatedTag, SourceBadge, StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, InlineNotice, SkeletonRows, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { PageHeader, Tabs } from '@/components/ui/page';
import { DataList, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Table, Td, Th } from '@/components/ui/table';
import { QuoteResults } from '../compare/quote-results';
import { Timeline } from '../tracking/timeline';
import { BookingDialog } from './booking-dialog';
import { useShipment, useShipmentEvents, useShipmentQuotes } from './hooks';
import { ManualUpdateDialog } from './manual-update-dialog';

const FLOW: ShipmentStatus[] = ['DRAFT', 'QUOTED', 'BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];

function LifecycleTracker({ shipment }: { shipment: Shipment }) {
  const problem = shipment.status === 'DELAYED' || shipment.status === 'EXCEPTION';
  const cancelled = shipment.status === 'CANCELLED';
  // For problem states, position the marker at the last movement milestone reached.
  const reached = problem ? (shipment.pickedUpAt ? FLOW.indexOf('IN_TRANSIT') : FLOW.indexOf('BOOKED')) : FLOW.indexOf(shipment.status);
  return (
    <Panel hud className="overflow-x-auto">
      <ol className="flex min-w-[640px] items-center gap-0 p-4" aria-label="Shipment lifecycle">
        {FLOW.map((s, i) => {
          const done = !cancelled && i <= reached;
          const current = !cancelled && i === reached;
          return (
            <li key={s} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full border text-[10px] font-semibold',
                    done ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong text-subtle',
                    current && problem && 'border-danger bg-danger text-white dark:text-black',
                  )}
                  aria-current={current ? 'step' : undefined}
                >
                  {done && !current ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={cn('hud-label text-[9.5px] whitespace-nowrap', current && 'text-fg')}>{current && problem ? SHIPMENT_STATUS[shipment.status].label : SHIPMENT_STATUS[s].label}</span>
              </div>
              {i < FLOW.length - 1 && <span className={cn('mx-2 mb-5 h-px flex-1', !cancelled && i < reached ? 'bg-accent' : 'bg-line')} />}
            </li>
          );
        })}
      </ol>
      {cancelled && <div className="border-t border-line px-4 py-2 text-[13px] text-muted">Cancelled{shipment.cancellationReason ? ` — ${shipment.cancellationReason}` : ''}</div>}
    </Panel>
  );
}

function OffersTab({ shipment }: { shipment: Shipment }) {
  const me = useSession();
  const qc = useQueryClient();
  const quotable = PLANNING_STATUSES.includes(shipment.status);
  const latest = useShipmentQuotes(shipment._id);

  const request = useMutation({
    mutationFn: async () => (await api.post<QuoteResponse>(`/shipments/${shipment._id}/quotes`)).data,
    onSuccess: (data) => {
      qc.setQueryData(keys.shipmentQuotes(shipment._id), data);
      toast.success(`${data.quotes.filter((q) => q.eligibility.eligible).length} eligible offers`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const select = useMutation({
    mutationFn: async (q: Quote) => (await api.post<Shipment>(`/shipments/${shipment._id}/select-quote`, { quoteId: q.id })).data,
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.shipment(shipment._id) });
      void qc.invalidateQueries({ queryKey: keys.shipmentEvents(shipment._id) });
      toast.success(`Selected ${s.carrierName} ${s.serviceName}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (latest.isLoading) return <SkeletonRows rows={4} />;
  if (latest.isError) return <ErrorState error={latest.error} onRetry={() => latest.refetch()} />;
  const data = latest.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {quotable ? 'Request offers for this shipment, compare them and select one to book.' : 'The offer comparison used for this shipment (read-only after booking).'}
        </p>
        {quotable && (
          <Button onClick={() => request.mutate()} loading={request.isPending} icon={<GitCompareArrows className="h-4 w-4" />}>
            {data ? 'Request new quotes' : 'Request quotes'}
          </Button>
        )}
      </div>
      {data ? (
        <QuoteResults
          key={data.quoteRequestId}
          data={data}
          defaultWeights={me.organization.settings.recommendationWeights}
          rankPath={`/shipments/${shipment._id}/quotes/rank`}
          rankBody={(w) => ({ quoteRequestId: data.quoteRequestId, weights: w })}
          selectedQuoteId={shipment.selectedQuoteId}
          onSelect={quotable ? (q) => select.mutate(q) : undefined}
          selectingId={select.isPending ? (select.variables?.id ?? null) : null}
          canSelect={quotable}
        />
      ) : (
        <Panel>
          <EmptyState icon={<GitCompareArrows className="h-5 w-5" />} title="No offers yet" description={quotable ? 'Request quotes to compare carriers for this shipment.' : 'No comparison was recorded for this shipment.'} />
        </Panel>
      )}
    </div>
  );
}

export default function ShipmentDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'overview' | 'offers' | 'tracking' | null) ?? 'overview';
  const qc = useQueryClient();
  const shipmentQ = useShipment(id);
  const eventsQ = useShipmentEvents(id);
  const fromSandbox = eventsQ.data?.some((e) => e.source.sandbox) ?? false;
  const [dialog, setDialog] = useState<'book' | 'cancel' | 'update' | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const refresh = useMutation({
    mutationFn: async () => (await api.post<{ newEvents: number; status: string }>(`/shipments/${id}/refresh-tracking`)).data,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.shipment(id) });
      void qc.invalidateQueries({ queryKey: keys.shipmentEvents(id) });
      toast.success(r.newEvents ? `${r.newEvents} new tracking event(s)` : 'No new tracking events');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const simulate = useMutation({
    mutationFn: async () => (await api.post<{ newEvents: number; status: string }>(`/shipments/${id}/simulate-next`)).data,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: keys.shipment(id) });
      void qc.invalidateQueries({ queryKey: keys.shipmentEvents(id) });
      toast.message(`Next tracking event added · status ${SHIPMENT_STATUS[r.status as ShipmentStatus]?.label ?? r.status}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: async () => (await api.post<Shipment>(`/shipments/${id}/cancel`, { reason: cancelReason.trim() || undefined })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.shipment(id) });
      void qc.invalidateQueries({ queryKey: keys.shipmentEvents(id) });
      void qc.invalidateQueries({ queryKey: keys.shipments.all });
      setDialog(null);
      toast.success('Shipment cancelled');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (shipmentQ.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (shipmentQ.isError) return <ErrorState error={shipmentQ.error} onRetry={() => shipmentQ.refetch()} />;
  const s = shipmentQ.data!;
  const planning = PLANNING_STATUSES.includes(s.status);
  const inFlight = TRACKABLE_STATUSES.includes(s.status);
  const cancellable = CANCELLABLE_STATUSES.includes(s.status) && !(s.booking?.reference && s.booking.cancellable === false);
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Shipments', to: '/shipments' }, { label: s.reference }]}
        label="// Shipment"
        title={<><span className="font-mono">{s.reference}</span><StatusBadge status={s.status} /></>}
        meta={
          <>
            {s.quoteIsSimulated && <SimulatedTag label={s.trackingMode === 'SIMULATED' ? 'Sample rate & tracking' : 'Sample rate'} />}
            {s.quoteSourceType && !s.quoteIsSimulated && <SourceBadge sourceType={s.quoteSourceType} />}
            <span className="text-[13px] text-muted">Updated {relativeTime(s.updatedAt)}</span>
          </>
        }
        actions={
          <>
            {planning && <ButtonLink to={`/shipments/${s._id}/edit`} variant="outline" icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink>}
            {planning && <Button variant={s.status === 'DRAFT' ? 'primary' : 'outline'} onClick={() => setTab('offers')} icon={<GitCompareArrows className="h-4 w-4" />}>Compare offers</Button>}
            {s.status === 'QUOTED' && <Button onClick={() => setDialog('book')} icon={<CalendarCheck className="h-4 w-4" />}>Book shipment</Button>}
            {inFlight && s.trackingMode === 'SIMULATED' && (
              <Button variant="outline" onClick={() => simulate.mutate()} loading={simulate.isPending} icon={<FastForward className="h-4 w-4" />} title="Release the next scripted simulated tracking milestone now">
                Next tracking event
              </Button>
            )}
            {inFlight && (s.trackingMode === 'LIVE' || s.trackingMode === 'SIMULATED') && (
              <Button variant="outline" onClick={() => refresh.mutate()} loading={refresh.isPending} icon={<RefreshCw className="h-4 w-4" />}>Refresh tracking</Button>
            )}
            {inFlight && <Button variant="outline" onClick={() => setDialog('update')} icon={<NotebookPen className="h-4 w-4" />}>Record update</Button>}
            {cancellable && <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')} icon={<Ban className="h-4 w-4" />}>Cancel</Button>}
          </>
        }
      />

      <LifecycleTracker shipment={s} />

      {s.openAlerts && s.openAlerts.length > 0 && (
        <div className="space-y-2">
          {s.openAlerts.map((a) => (
            <InlineNotice key={a._id} tone="danger" icon={<TriangleAlert className="h-4 w-4 text-danger" />}>
              <div className="flex flex-wrap items-center gap-2">
                <b>{ALERT_TYPE_LABEL[a.type]}</b> <SeverityBadge severity={a.severity} /> <span className="text-muted">{a.status === 'ACKNOWLEDGED' ? `acknowledged by ${a.acknowledgedByName ?? 'a teammate'}` : `detected ${relativeTime(a.detectedAt)}`}</span>
              </div>
              <div className="mt-0.5">{a.message}. <span className="text-muted">Next action: {a.recommendedAction}</span> <Link to="/tracking" className="font-medium text-accent hover:underline">Manage alerts</Link></div>
            </InlineNotice>
          ))}
        </div>
      )}
      {s.lastTrackingError && inFlight && <InlineNotice tone="warning">Last tracking refresh failed: {s.lastTrackingError}</InlineNotice>}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'offers', label: 'Carrier offers' },
          { value: 'tracking', label: `Tracking timeline${s.eventCount ? ` (${s.eventCount})` : ''}` },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2">
            <PanelHeader label="Route" title={<span className="flex items-center gap-2">{s.origin.city} <ArrowRight className="h-3.5 w-3.5 text-accent" /> {s.destination.city}</span>} />
            <PanelBody className="grid gap-6 sm:grid-cols-2">
              {(['origin', 'destination'] as const).map((k) => (
                <div key={k}>
                  <div className="hud-label mb-1">{k}</div>
                  <div className="text-sm font-medium">{s[k].name ?? s[k].city}</div>
                  <div className="text-[13px] text-muted">{[s[k].address, s[k].city, s[k].postalCode].filter(Boolean).join(', ')}</div>
                  <div className="text-[13px] text-muted">{countryName(s[k].country)}</div>
                </div>
              ))}
            </PanelBody>
            <div className="border-t border-line">
              <PanelBody>
                <DataList
                  columns={3}
                  items={[
                    { label: 'Type', value: `${s.packageCount} × ${s.shipmentType.toLowerCase()}` },
                    { label: 'Actual weight', value: formatWeight(s.actualWeightKg) },
                    { label: 'Dimensions / pkg', value: s.lengthCm ? `${s.lengthCm} × ${s.widthCm} × ${s.heightCm} cm` : 'Not provided' },
                    { label: 'Volumetric (est.)', value: formatWeight(s.volumetricWeightKg) },
                    { label: 'Billable (est.)', value: formatWeight(s.billableWeightKg) },
                    { label: 'Service preference', value: s.servicePreference?.toLowerCase() ?? 'Any' },
                    { label: 'Required by', value: formatDate(s.requiredDeliveryDate) },
                    { label: 'Insurance', value: s.insuranceRequired ? `Yes · ${formatMoney(s.cargoValueMinor, s.cargoCurrency ?? s.currency)}` : 'No' },
                    { label: 'Special handling', value: s.specialHandling.length ? s.specialHandling.map((h) => h.replace(/_/g, ' ').toLowerCase()).join(', ') : 'None' },
                    { label: 'Contents', value: s.contentsDescription || '—' },
                    { label: 'Budget', value: s.maxBudgetMinor ? formatMoney(s.maxBudgetMinor, s.currency) : 'No limit' },
                    { label: 'Notes', value: s.notes || '—' },
                  ]}
                />
              </PanelBody>
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel hud>
              <PanelHeader label="Carrier & cost" title={s.carrierName ? `${s.carrierName} · ${s.serviceName}` : 'No offer selected'} />
              <PanelBody>
                {s.carrierName ? (
                  <DataList
                    columns={1}
                    items={[
                      { label: 'Freight cost', value: <span className="text-lg font-semibold tabular">{formatMoney(s.freightCostMinor, s.currency)}</span> },
                      { label: 'Data source', value: s.quoteSourceType ? <SourceBadge sourceType={s.quoteSourceType} /> : '—' },
                      { label: 'Expected delivery', value: formatDate(s.expectedDeliveryDate) },
                    ]}
                  />
                ) : (
                  <div className="text-sm text-muted">
                    Compare carriers to choose an offer. <button className="font-medium text-accent hover:underline" onClick={() => setTab('offers')}>Compare now</button>
                  </div>
                )}
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader label="Booking & tracking" />
              <PanelBody>
                <DataList
                  columns={1}
                  items={[
                    {
                      label: 'Booking reference',
                      value: s.booking?.reference ? (
                        <span className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
                          {s.booking.reference}
                          {s.booking.isSimulated && <Tag className="h-3.5 w-3.5 text-subtle" aria-label="Sample booking" />}
                          {s.booking.provider === 'manual' && <Badge>Manual</Badge>}
                        </span>
                      ) : 'Not booked',
                    },
                    { label: 'Tracking number', value: s.trackingNumber ?? '—', mono: true },
                    { label: 'Tracking source', value: { NONE: 'None', LIVE: 'Carrier API (live)', SIMULATED: 'Sample tracking', MANUAL: 'Manual updates' }[s.trackingMode] },
                    { label: 'Booked', value: formatDateTime(s.booking?.bookedAt, true) },
                    { label: 'Picked up', value: formatDateTime(s.pickedUpAt, true) },
                    { label: 'Delivered', value: formatDateTime(s.deliveredAt, true) },
                    { label: 'Last known location', value: s.lastKnownLocation ? `${s.lastKnownLocation} · ${relativeTime(s.lastTrackingUpdateAt)}` : '—' },
                  ]}
                />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader label="Purchase order" />
              <PanelBody>
                {s.purchaseOrder ? (
                  <Link to={`/purchase-orders/${s.purchaseOrder._id}`} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 hover:border-accent">
                    <span>
                      <span className="block font-mono text-sm">{s.purchaseOrder.poNumber}</span>
                      <span className="text-xs text-muted">{formatMoney(s.purchaseOrder.totalMinor, s.purchaseOrder.currency)}</span>
                    </span>
                    <PoStatusBadge status={s.purchaseOrder.status} />
                  </Link>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-muted"><ClipboardList className="h-4 w-4" /> Not linked to a purchase order</div>
                )}
              </PanelBody>
            </Panel>
          </div>

          {s.items.length > 0 && (
            <Panel className="lg:col-span-3">
              <PanelHeader label="Contents" title="Shipped items" />
              <Table>
                <thead><tr><Th>SKU</Th><Th>Description</Th><Th className="text-right">Quantity</Th></tr></thead>
                <tbody>
                  {s.items.map((i, idx) => (
                    <tr key={idx}><Td className="font-mono text-[13px]">{i.sku ?? '—'}</Td><Td>{i.description}</Td><Td className="text-right tabular">{i.quantity} {i.unitOfMeasure}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </div>
      )}

      {tab === 'offers' && <OffersTab shipment={s} />}

      {tab === 'tracking' && (
        <Panel>
          <PanelHeader
            label="Event history"
            title="Tracking timeline"
            actions={
              s.trackingMode === 'SIMULATED' ? (
                <SimulatedTag label="Sample tracking" />
              ) : s.trackingMode === 'LIVE' ? (
                <Badge tone="success">{fromSandbox ? 'Carrier test environment' : 'Live carrier API'}</Badge>
              ) : undefined
            }
          />
          <PanelBody>
            {eventsQ.isLoading ? (
              <SkeletonRows rows={5} />
            ) : eventsQ.isError ? (
              <ErrorState error={eventsQ.error} onRetry={() => eventsQ.refetch()} />
            ) : eventsQ.data!.length === 0 ? (
              <EmptyState title="No events yet" />
            ) : (
              <Timeline events={eventsQ.data!} />
            )}
          </PanelBody>
        </Panel>
      )}

      {s.status === 'QUOTED' && <BookingDialog shipment={s} open={dialog === 'book'} onClose={() => setDialog(null)} />}
      {inFlight && <ManualUpdateDialog shipment={s} open={dialog === 'update'} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'cancel'}
        title={`Cancel ${s.reference}?`}
        description={
          s.booking?.reference
            ? s.booking.provider === 'manual'
              ? 'This cancels the shipment in Fluxora only. Make sure you also cancel the booking directly with the carrier.'
              : s.booking.isSimulated
                ? 'The sample booking will be cancelled. This cannot be undone.'
                : 'Fluxora will request cancellation from the carrier. This cannot be undone.'
            : 'The shipment will be marked as cancelled. This cannot be undone.'
        }
        confirmLabel="Cancel shipment"
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
        onClose={() => setDialog(null)}
      >
        <Field label="Reason (optional)">{(p) => <Textarea {...p} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} />}</Field>
      </ConfirmDialog>
    </div>
  );
}
