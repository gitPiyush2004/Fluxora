import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, ClipboardPlus, Clock, Gauge, GitCompareArrows, PackagePlus, Radar, Timer, Truck, TriangleAlert, Wallet } from 'lucide-react';
import { useSession } from '@/providers/auth';
import { exponentOf, formatDate, formatMoney, formatPercent, isPastBy, relativeTime } from '@/lib/format';
import { placeLabel } from '@/lib/geo';
import { ALERT_TYPE_LABEL, SHIPMENT_STATUS, SHIPMENT_STATUSES } from '@/lib/constants';
import { ButtonLink } from '@/components/ui/button';
import { Kpi, PageHeader, SegmentedControl } from '@/components/ui/page';
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

  return (
    <div className="space-y-6">
      <PageHeader
        label="// Mission control"
        title="Operations overview"
        description={`Shipments, exceptions and spend for ${me.organization.name} over the last 12 months.`}
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
        <div className="grid grid-cols-2 gap-4 content-start">
          {overview.isLoading ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)
          ) : overview.isError ? (
            <Panel className="col-span-2"><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></Panel>
          ) : (
            <>
              <Kpi label="Total shipments" value={o!.shipments.total} sub={`${o!.shipments.planning} in planning`} icon={<Truck className="h-4 w-4" />} />
              <Kpi label="In transit" value={o!.shipments.inTransit} sub="Picked up → out for delivery" icon={<Radar className="h-4 w-4" />} />
              <Kpi label="Delayed / exception" value={o!.shipments.delayedOrException} tone="danger" sub={`${o!.unresolvedAlerts} unresolved alerts`} icon={<TriangleAlert className="h-4 w-4" />} />
              <Kpi label="Delivered" value={o!.shipments.delivered} tone="success" sub={`On time ${formatPercent(o!.onTimeDelivery.rate)} (n=${o!.onTimeDelivery.eligibleCount})`} icon={<Gauge className="h-4 w-4" />} />
              <Kpi
                label="Freight spend"
                value={primarySpend ? formatMoney(primarySpend.totalMinor, primarySpend.currency, { compact: true }) : '—'}
                sub={o!.freightSpend.length > 1 ? `+ ${o!.freightSpend.slice(1).map((f) => formatMoney(f.totalMinor, f.currency, { compact: true })).join(', ')} (not converted)` : 'Recorded at booking'}
                icon={<Wallet className="h-4 w-4" />}
                tone="info"
              />
              <Kpi
                label="Avg transit"
                value={o!.averageTransit.days != null ? `${o!.averageTransit.days} d` : '—'}
                sub={`Pickup → delivery, n=${o!.averageTransit.eligibleCount}`}
                icon={<Timer className="h-4 w-4" />}
                tone="info"
              />
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            label="Freight expenditure"
            title={`Monthly recorded spend · ${currency}`}
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
                    <defs>
                      <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
                    <YAxis width={64} tickFormatter={(v: number) => formatMoney(v * scale, currency, { compact: true })} {...axisProps} />
                    <Tooltip content={<ChartTooltip valueFormat={(v) => formatMoney(v * scale, currency)} labelFormat={monthLabel} />} />
                    <Area type="monotone" dataKey="spend" name="Spend" stroke="var(--chart-1)" strokeWidth={2} fill="url(#spendFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader label="Fleet status" title="Shipment status distribution" />
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
                    <YAxis type="category" dataKey="label" width={104} {...axisProps} />
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

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader label="Activity" title="Recent shipments" actions={<Link to="/shipments" className="text-[13px] text-accent hover:underline">View all</Link>} />
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
          <PanelHeader label="Exceptions" title="Active alerts" actions={<Link to="/tracking" className="text-[13px] text-accent hover:underline">Open console</Link>} />
          {lists.isLoading ? (
            <SkeletonRows rows={4} />
          ) : lists.data?.activeAlerts.length ? (
            <ul className="divide-y divide-line">
              {lists.data.activeAlerts.map((a) => (
                <li key={a._id}>
                  <Link to={`/shipments/${a.shipmentId}`} className="block px-4 py-3 hover:bg-surface-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{ALERT_TYPE_LABEL[a.type]}</span>
                      <SeverityBadge severity={a.severity} />
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-muted">{a.message}</div>
                    <div className="mt-1 font-mono text-[11px] text-subtle">
                      {a.shipmentReference} · {relativeTime(a.detectedAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Radar className="h-5 w-5" />} title="All lanes nominal" description="No unresolved exceptions." />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader label="Next 7 days" title="Upcoming delivery deadlines" />
          {lists.isLoading ? (
            <SkeletonRows rows={4} />
          ) : lists.data?.upcomingDeliveries.length ? (
            <ul className="divide-y divide-line">
              {lists.data.upcomingDeliveries.map((s) => {
                const overdue = isPastBy(s.expectedDeliveryDate, 1);
                return (
                  <li key={s._id}>
                    <Link to={`/shipments/${s._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                      <CalendarClock className={overdue ? 'h-4 w-4 text-danger' : 'h-4 w-4 text-subtle'} />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[13px]">{s.reference}</div>
                        <div className="truncate text-xs text-muted">{placeLabel(s.destination)} · {s.carrierName}</div>
                      </div>
                      <div className="text-right">
                        <div className={overdue ? 'text-[13px] font-medium text-danger' : 'text-[13px]'}>{formatDate(s.expectedDeliveryDate)}</div>
                        <div className="text-[11px] text-subtle">{overdue ? 'Overdue' : relativeTime(s.expectedDeliveryDate)}</div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<Clock className="h-5 w-5" />} title="No deadlines this week" />
          )}
        </Panel>

        <Panel>
          <PanelHeader label="Procurement" title="Recent purchase orders" actions={<Link to="/purchase-orders" className="text-[13px] text-accent hover:underline">View all</Link>} />
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

        <Panel hud>
          <PanelHeader label="Quick actions" title="Get things moving" />
          <PanelBody className="grid gap-2">
            {[
              { to: '/compare', icon: GitCompareArrows, title: 'Compare carriers', text: 'Price a lane across five carriers' },
              { to: '/shipments/new', icon: PackagePlus, title: 'Create shipment', text: 'Plan a new movement' },
              { to: '/purchase-orders/new', icon: ClipboardPlus, title: 'Raise purchase order', text: 'Order from a supplier' },
              { to: '/tracking', icon: Radar, title: 'Review exceptions', text: 'Acknowledge and resolve alerts' },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-accent hover:bg-accent-soft">
                <a.icon className="h-4 w-4 text-accent" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{a.title}</span>
                  <span className="block text-xs text-muted">{a.text}</span>
                </span>
              </Link>
            ))}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
