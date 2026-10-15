import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, CheckCircle2, GitCompareArrows, PackagePlus } from 'lucide-react';
import { useSession } from '@/providers/auth';
import { exponentOf, formatDate, formatMoney, formatPercent, isPastBy, relativeTime } from '@/lib/format';
import { placeLabel } from '@/lib/geo';
import { ALERT_TYPE_LABEL, SHIPMENT_STATUS, SHIPMENT_STATUSES } from '@/lib/constants';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader, SegmentedControl, Stat, StatStrip } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { PoStatusBadge, SeverityBadge, StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '@/components/ui/feedback';
import { GlobePanel } from '@/components/globe/globe-panel';
import { axisProps, ChartEmpty, ChartTooltip, gridProps } from '@/components/charts';
import { dominantCurrency, useDashboardLists, useFreight, useMapShipments, useOverview } from '../analytics/hooks';

const TONE_COLOR: Record<string, string> = {
  neutral: 'var(--fg-subtle)', accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', info: 'var(--info)', sim: 'var(--sim)',
};

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  return new Date(Date.UTC(Number(y), Number(mo) - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function DashboardPage() {
  const me = useSession();
  const overview = useOverview();
  const freight = useFreight();
  const lists = useDashboardLists();
  const map = useMapShipments();

  const currencies = useMemo(() => [...new Set((freight.data?.monthly ?? []).map((m) => m.currency))], [freight.data]);
  const [currencyPick, setCurrencyPick] = useState<string | null>(null);
  const currency = currencyPick ?? dominantCurrency(freight.data?.monthly ?? [], me.organization.settings.defaultCurrency);
  const scale = 10 ** exponentOf(currency);
  const trend = (freight.data?.monthly ?? []).filter((m) => m.currency === currency).map((m) => ({ month: m.month, spend: m.totalMinor / scale, count: m.shipmentCount }));

  const statusData = SHIPMENT_STATUSES.map((s) => ({ status: s, label: SHIPMENT_STATUS[s].label, count: overview.data?.shipments.byStatus[s] ?? 0, fill: TONE_COLOR[SHIPMENT_STATUS[s].tone] })).filter((d) => d.count > 0);

  const o = overview.data;
  const primarySpend = o?.freightSpend[0];
  const alerts = lists.data?.activeAlerts ?? [];
  const due = lists.data?.upcomingDeliveries ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations overview"
        description={`Shipments, alerts and freight spend for ${me.organization.name}.`}
        actions={
          <>
            <ButtonLink to="/compare" variant="outline" icon={<GitCompareArrows className="h-4 w-4" />}>
              Compare carriers
            </ButtonLink>
            <ButtonLink to="/shipments/new" icon={<PackagePlus className="h-4 w-4" />}>
              New shipment
            </ButtonLink>
          </>
        }
      />

      {overview.isLoading ? (
        <Skeleton className="h-[98px] rounded-xl" />
      ) : overview.isError ? (
        <Panel><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></Panel>
      ) : (
        <StatStrip className="lg:grid-cols-4">
          <Stat label="In transit" value={o!.shipments.inTransit} sub={`${o!.shipments.planning} more in planning`} to="/shipments" />
          <Stat label="Delayed" value={o!.shipments.delayedOrException} sub={plural(o!.unresolvedAlerts, 'open alert')} to="/tracking" />
          <Stat label="On-time delivery" value={formatPercent(o!.onTimeDelivery.rate)} sub={`of ${plural(o!.onTimeDelivery.eligibleCount, 'delivered shipment')}`} />
          <Stat
            label="Freight spend"
            value={primarySpend ? formatMoney(primarySpend.totalMinor, primarySpend.currency, { compact: true }) : '—'}
            sub={o!.freightSpend.length > 1 ? `+ ${o!.freightSpend.slice(1).map((f) => formatMoney(f.totalMinor, f.currency, { compact: true })).join(', ')} in other currencies` : 'Last 12 months, at booking'}
          />
        </StatStrip>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {map.isError ? (
            <Panel><ErrorState error={map.error} onRetry={() => map.refetch()} /></Panel>
          ) : map.isLoading ? (
            <Skeleton className="h-[440px] rounded-xl" />
          ) : (
            <GlobePanel shipments={map.data ?? []} height={440} />
          )}
        </div>

        {/* Same height as the globe (440px + borders): the list scrolls instead of stretching the row. */}
        <Panel className="flex flex-col lg:h-[442px]">
          <PanelHeader title="Needs attention" actions={<Link to="/tracking" className="text-[13px] text-accent hover:underline">All alerts</Link>} />
          {lists.isLoading ? (
            <SkeletonRows rows={5} />
          ) : lists.isError ? (
            <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
          ) : alerts.length + due.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Nothing needs attention" description="No open alerts and no deliveries due in the next 7 days." className="flex-1" />
          ) : (
            <div className="flex-1 overflow-y-auto pb-1">
              {alerts.length > 0 && (
                <section>
                  <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-subtle">Open alerts</h3>
                  <ul className="divide-y divide-line">
                    {alerts.map((a) => (
                      <li key={a._id}>
                        <Link to={`/shipments/${a.shipmentId}`} className="block px-4 py-3 hover:bg-surface-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{ALERT_TYPE_LABEL[a.type]}</span>
                            <SeverityBadge severity={a.severity} />
                          </div>
                          <div className="mt-0.5 truncate text-[13px] text-muted">{a.message}</div>
                          <div className="mt-1 text-xs text-subtle">
                            <span className="font-mono">{a.shipmentReference}</span> · {relativeTime(a.detectedAt)}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {due.length > 0 && (
                <section>
                  <h3 className="px-4 pt-3 pb-1 text-xs font-medium text-subtle">Due in the next 7 days</h3>
                  <ul className="divide-y divide-line">
                    {due.map((s) => {
                      const overdue = isPastBy(s.expectedDeliveryDate, 1);
                      return (
                        <li key={s._id}>
                          <Link to={`/shipments/${s._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                            <CalendarClock className={overdue ? 'h-4 w-4 text-danger' : 'h-4 w-4 text-subtle'} aria-hidden />
                            <div className="min-w-0 flex-1">
                              <div className="font-mono text-[13px]">{s.reference}</div>
                              <div className="truncate text-xs text-muted">{placeLabel(s.destination)} · {s.carrierName}</div>
                            </div>
                            <div className="text-right">
                              <div className={overdue ? 'text-[13px] font-medium text-danger' : 'text-[13px]'}>{formatDate(s.expectedDeliveryDate)}</div>
                              <div className="text-xs text-subtle">{overdue ? 'Overdue' : relativeTime(s.expectedDeliveryDate)}</div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Recent shipments" actions={<Link to="/shipments" className="text-[13px] text-accent hover:underline">View all</Link>} />
          {lists.isLoading ? (
            <SkeletonRows rows={5} />
          ) : lists.isError ? (
            <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
          ) : lists.data!.recentShipments.length === 0 ? (
            <EmptyState title="No shipments yet" description="Create a shipment or compare carriers to get started." action={<ButtonLink to="/shipments/new">New shipment</ButtonLink>} />
          ) : (
            <ul className="divide-y divide-line">
              {lists.data!.recentShipments.map((s) => (
                <li key={s._id}>
                  <Link to={`/shipments/${s._id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2">
                    <span className="w-[136px] font-mono text-[13px] font-medium text-fg">{s.reference}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted">
                      {placeLabel(s.origin)} → {placeLabel(s.destination)}
                    </span>
                    <span className="hidden w-28 truncate text-sm text-muted md:block">{s.carrierName ?? '—'}</span>
                    <StatusBadge status={s.status} />
                    <span className="w-24 text-right text-sm tabular">{formatMoney(s.freightCostMinor, s.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Recent purchase orders" actions={<Link to="/purchase-orders" className="text-[13px] text-accent hover:underline">View all</Link>} />
          {lists.isLoading ? (
            <SkeletonRows rows={4} />
          ) : lists.data?.recentPurchaseOrders.length ? (
            <ul className="divide-y divide-line">
              {lists.data.recentPurchaseOrders.map((p) => (
                <li key={p._id}>
                  <Link to={`/purchase-orders/${p._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[13px]">{p.poNumber}</div>
                      <div className="truncate text-xs text-muted">{p.supplierId?.name ?? 'Unknown supplier'}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <PoStatusBadge status={p.status} />
                      <span className="text-xs tabular text-muted">{formatMoney(p.totalMinor, p.currency)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No purchase orders yet" action={<ButtonLink to="/purchase-orders/new" size="sm">Create purchase order</ButtonLink>} />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title={`Freight spend by month · ${currency}`}
            actions={currencies.length > 1 ? <SegmentedControl label="Currency" value={currency} onChange={setCurrencyPick} options={currencies.map((c) => ({ value: c, label: c }))} /> : undefined}
          />
          <PanelBody>
            {freight.isLoading ? (
              <Skeleton className="h-[240px]" />
            ) : freight.isError ? (
              <ErrorState error={freight.error} onRetry={() => freight.refetch()} />
            ) : trend.length === 0 ? (
              <ChartEmpty>No booked shipments with recorded freight cost yet.</ChartEmpty>
            ) : (
              <div className="h-[240px]" role="img" aria-label={`Monthly freight spend in ${currency}`}>
                <ResponsiveContainer>
                  <AreaChart data={trend} margin={{ left: 4, right: 8, top: 8 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
                    <YAxis width={64} tickFormatter={(v: number) => formatMoney(v * scale, currency, { compact: true })} {...axisProps} />
                    <Tooltip content={<ChartTooltip valueFormat={(v) => formatMoney(v * scale, currency)} labelFormat={monthLabel} />} />
                    <Area type="linear" dataKey="spend" name="Spend" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.08} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Shipments by status" />
          <PanelBody>
            {overview.isLoading ? (
              <Skeleton className="h-[240px]" />
            ) : statusData.length === 0 ? (
              <ChartEmpty>No shipments in this period.</ChartEmpty>
            ) : (
              <div className="h-[240px]" role="img" aria-label="Shipments by status">
                <ResponsiveContainer>
                  <BarChart data={statusData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid {...gridProps} horizontal={false} vertical />
                    <XAxis type="number" allowDecimals={false} {...axisProps} />
                    <YAxis type="category" dataKey="label" width={116} {...axisProps} />
                    <Tooltip cursor={{ fill: 'var(--surface-3)' }} content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Shipments" radius={[0, 4, 4, 0]} barSize={14}>
                      {statusData.map((d) => (
                        <Cell key={d.status} fill={d.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
