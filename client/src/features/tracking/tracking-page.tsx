import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { CheckCheck, Eye, Radar, ScanLine, ShieldAlert, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { ALERT_TYPE_LABEL, SEVERITY } from '@/lib/constants';
import { keys } from '@/lib/query-keys';
import { formatDate, formatDateTime, relativeTime } from '@/lib/format';
import { placeLabel } from '@/lib/geo';
import type { Alert, AlertSeverity } from '@/lib/types';
import { useAuth } from '@/providers/auth';
import { useRealtimeStatus } from '@/providers/realtime';
import { Badge, SeverityBadge, SimulatedTag, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Kpi, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Pagination, Table, Td, Th } from '@/components/ui/table';
import { useInFlightShipments } from '../shipments/hooks';
import { useUrlState } from '../shared/hooks';
import { useAlerts, useAlertSummary, useEventFeed } from './hooks';
import { Timeline } from './timeline';

const DEFAULTS = { page: '1', status: 'UNRESOLVED', severity: '', type: '' };

export default function TrackingPage() {
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const realtime = useRealtimeStatus();
  const [state, update] = useUrlState(DEFAULTS);
  const [resolving, setResolving] = useState<Alert | null>(null);
  const [note, setNote] = useState('');

  const summary = useAlertSummary();
  const alerts = useAlerts(state);
  const feed = useEventFeed();
  const active = useInFlightShipments();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: keys.alerts.all });
    void qc.invalidateQueries({ queryKey: keys.analytics.all });
  };
  const ack = useMutation({
    mutationFn: async (id: string) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => { invalidate(); toast.success('Alert acknowledged'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const resolve = useMutation({
    mutationFn: async () => api.post(`/alerts/${resolving!._id}/resolve`, { note: note.trim() || undefined }),
    onSuccess: () => { invalidate(); setResolving(null); setNote(''); toast.success('Alert resolved'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const scan = useMutation({
    mutationFn: async () => (await api.post<{ scanned: number; created: number; autoResolved: number }>('/alerts/scan')).data,
    onSuccess: (r) => { invalidate(); toast.success(`Scanned ${r.scanned} shipments · ${r.created} new · ${r.autoResolved} auto-resolved`); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sev = summary.data?.bySeverity;
  return (
    <div className="space-y-6">
      <PageHeader
        label="// Tracking & exceptions"
        title="Tracking & alerts"
        description="Rule-based exception detection: stuck statuses, missed delivery dates, carrier-reported delays and silent tracking. Alerts are de-duplicated and auto-resolve when the condition clears."
        actions={
          <>
            <Badge tone={realtime === 'live' ? 'success' : 'neutral'} dot>{realtime === 'live' ? 'Live updates on' : 'Live updates off'}</Badge>
            {isAdmin && <Button variant="outline" onClick={() => scan.mutate()} loading={scan.isPending} icon={<ScanLine className="h-4 w-4" />}>Run exception scan</Button>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Unresolved" value={summary.data?.unresolved ?? '—'} icon={<ShieldAlert className="h-4 w-4" />} tone="danger" sub={`${summary.data?.open ?? 0} open · ${summary.data?.acknowledged ?? 0} acknowledged`} />
        <Kpi label="Critical" value={sev?.CRITICAL ?? '—'} tone="danger" icon={<TriangleAlert className="h-4 w-4" />} />
        <Kpi label="High" value={sev?.HIGH ?? '—'} tone="warning" />
        <Kpi label="Medium / low" value={sev ? sev.MEDIUM + sev.LOW : '—'} tone="info" />
      </div>

      <Panel>
        <PanelHeader label="Exceptions" title="Alert queue" />
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Select aria-label="Alert status" value={state.status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
            <option value="UNRESOLVED">Unresolved</option>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved (history)</option>
            <option value="ALL">All</option>
          </Select>
          <Select aria-label="Severity" value={state.severity} onChange={(e) => update({ severity: e.target.value })} className="w-auto">
            <option value="">All severities</option>
            {(Object.keys(SEVERITY) as AlertSeverity[]).map((s) => <option key={s} value={s}>{SEVERITY[s].label}</option>)}
          </Select>
          <Select aria-label="Alert type" value={state.type} onChange={(e) => update({ type: e.target.value })} className="w-auto">
            <option value="">All types</option>
            {Object.entries(ALERT_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {alerts.isLoading ? (
          <SkeletonRows rows={5} />
        ) : alerts.isError ? (
          <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
        ) : alerts.data!.data.length === 0 ? (
          <EmptyState icon={<Radar className="h-5 w-5" />} title={state.status === 'UNRESOLVED' ? 'No unresolved exceptions' : 'No alerts match'} description="Fluxora scans in-flight shipments on a schedule and whenever new tracking events arrive." />
        ) : (
          <>
            <Table>
              <thead>
                <tr><Th>Severity</Th><Th>Exception</Th><Th>Shipment</Th><Th>Recommended next action</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr>
              </thead>
              <tbody>
                {alerts.data!.data.map((a) => (
                  <tr key={a._id} className="align-top">
                    <Td><SeverityBadge severity={a.severity} /></Td>
                    <Td>
                      <div className="font-medium">{ALERT_TYPE_LABEL[a.type]}</div>
                      <div className="max-w-[260px] text-xs text-muted">{a.message}</div>
                      <div className="mt-0.5 text-xs text-subtle" title={formatDateTime(a.detectedAt, true)}>Detected {relativeTime(a.detectedAt)}</div>
                      {a.isSimulatedSource && <div className="mt-1"><SimulatedTag label="Simulated tracking" /></div>}
                    </Td>
                    <Td><Link to={`/shipments/${a.shipmentId}`} className="whitespace-nowrap font-mono text-[13px] text-accent hover:underline">{a.shipmentReference}</Link></Td>
                    <Td className="max-w-[260px] text-[13px] text-muted">{a.recommendedAction}</Td>
                    <Td className="text-[13px]">
                      <Badge tone={a.status === 'OPEN' ? 'danger' : a.status === 'ACKNOWLEDGED' ? 'warning' : 'success'}>{a.status.toLowerCase()}</Badge>
                      {a.status === 'ACKNOWLEDGED' && a.acknowledgedByName && <div className="mt-1 text-xs text-subtle">by {a.acknowledgedByName}</div>}
                      {a.status === 'RESOLVED' && <div className="mt-1 max-w-[180px] text-xs text-subtle">{a.autoResolved ? 'Auto-resolved' : `by ${a.resolvedByName ?? '—'}`}{a.resolutionNote ? ` · ${a.resolutionNote}` : ''}</div>}
                    </Td>
                    <Td>
                      <div className="flex flex-col items-end gap-1.5">
                        {a.status === 'OPEN' && (
                          <Button size="sm" variant="ghost" onClick={() => ack.mutate(a._id)} loading={ack.isPending && ack.variables === a._id} icon={<Eye className="h-3.5 w-3.5" />}>Acknowledge</Button>
                        )}
                        {a.status !== 'RESOLVED' && (
                          <Button size="sm" variant="outline" onClick={() => setResolving(a)} icon={<CheckCheck className="h-3.5 w-3.5" />}>Resolve</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={alerts.data!.meta} onPage={(p) => update({ page: String(p) }, false)} />
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="lg:col-span-3">
          <PanelHeader label="In flight" title="Active shipments" actions={<Link to="/shipments?status=BOOKED,PICKED_UP,IN_TRANSIT,OUT_FOR_DELIVERY,DELAYED,EXCEPTION" className="text-[13px] text-accent hover:underline">View all</Link>} />
          {active.isLoading ? (
            <SkeletonRows rows={5} />
          ) : active.isError ? (
            <ErrorState error={active.error} onRetry={() => active.refetch()} />
          ) : active.data!.length === 0 ? (
            <EmptyState title="Nothing in flight" />
          ) : (
            <Table>
              <thead><tr><Th>Shipment</Th><Th>Status</Th><Th>Last known</Th><Th>Expected</Th></tr></thead>
              <tbody>
                {active.data!.map((s) => (
                  <tr key={s._id} className="hover:bg-surface-2">
                    <Td>
                      <Link to={`/shipments/${s._id}?tab=tracking`} className="font-mono text-[13px] text-fg hover:text-accent">{s.reference}</Link>
                      <div className="text-xs text-muted">{placeLabel(s.origin)} → {placeLabel(s.destination)}</div>
                    </Td>
                    <Td><StatusBadge status={s.status} /></Td>
                    <Td className="text-[13px]">
                      {s.lastKnownLocation ?? '—'}
                      <div className="text-xs text-subtle">{s.lastTrackingUpdateAt ? relativeTime(s.lastTrackingUpdateAt) : 'No updates'} · {s.trackingMode.toLowerCase()}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-[13px]">{formatDate(s.expectedDeliveryDate)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader label="Event stream" title="Latest tracking events" />
          <PanelBody className="max-h-[560px] overflow-y-auto">
            {feed.isLoading ? <SkeletonRows rows={5} /> : feed.isError ? <ErrorState error={feed.error} onRetry={() => feed.refetch()} /> : feed.data!.length ? <Timeline events={feed.data!} showShipment /> : <EmptyState title="No tracking events yet" />}
          </PanelBody>
        </Panel>
      </div>

      <ConfirmDialog
        open={!!resolving}
        title="Resolve alert"
        tone="primary"
        description={resolving ? `${ALERT_TYPE_LABEL[resolving.type]} on ${resolving.shipmentReference}: ${resolving.message}` : ''}
        confirmLabel="Resolve"
        loading={resolve.isPending}
        onConfirm={() => resolve.mutate()}
        onClose={() => setResolving(null)}
      >
        <Field label="Resolution note" hint="What was done? Visible in the alert history.">
          {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Carrier confirmed new ETA of Friday; customer informed" />}
        </Field>
      </ConfirmDialog>
    </div>
  );
}
