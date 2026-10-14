import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpen, Gauge, PiggyBank, Timer, Truck, Wallet, X } from 'lucide-react';
import { CARRIERS, PO_STATUS, PO_STATUSES, SHIPMENT_STATUS, SHIPMENT_STATUSES } from '@/lib/constants';
import { exponentOf, formatMoney, formatPercent } from '@/lib/format';
import type { PoStatus } from '@/lib/types';
import { useSession } from '@/providers/auth';
import { Button } from '@/components/ui/button';
import { ErrorState, InlineNotice, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { Kpi, PageHeader, SegmentedControl } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Table, Td, Th } from '@/components/ui/table';
import { axisProps, CHART_COLORS, ChartEmpty, ChartTooltip, gridProps } from '@/components/charts';
import { useUrlState } from '../shared/hooks';
import { dominantCurrency, useCarrierPerf, useFreight, useOverview, usePoAnalytics, useSavings, type AnalyticsFilters } from './hooks';

const yearAgo = () => new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
const DEFAULTS = { from: '', to: '', carrier: '', status: '', poStatus: '' };

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  return new Date(Date.UTC(Number(y), Number(mo) - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

const DEFINITIONS = [
  ['Shipments in period', 'Shipments created within the selected dates (status/carrier filters applied).'],
  ['Freight expenditure', 'Sum of recorded freight cost of shipments booked within the period, excluding cancelled ones. Reported per currency — never converted or added across currencies.'],
  ['On-time delivery rate', 'Shipments delivered on or before the end of their expected delivery day ÷ delivered shipments with both dates recorded. “n” is that denominator.'],
  ['Average transit time', 'Mean time from recorded pickup to delivery for shipments delivered in the period with both timestamps. “n” shows how many qualified.'],
  ['Carrier reliability', 'The same on-time rate per carrier from your own history. Used in recommendations only once a carrier has the configured minimum number of deliveries.'],
  ['Potential savings (hypothetical)', 'Selected offer price minus the cheapest eligible offer from the same comparison and currency. It is not realised savings — faster or more reliable offers are often worth the premium.'],
];

export default function AnalyticsPage() {
  const me = useSession();
  const [state, update] = useUrlState(DEFAULTS);
  const filters: AnalyticsFilters = useMemo(() => ({ from: state.from || yearAgo(), to: state.to || undefined, carrier: state.carrier || undefined, status: state.status || undefined, poStatus: state.poStatus || undefined }), [state]);

  const overview = useOverview(filters);
  const freight = useFreight(filters);
  const carriers = useCarrierPerf(filters);
  const pos = usePoAnalytics(filters);
  const savings = useSavings(filters);

  const currencies = useMemo(() => [...new Set((freight.data?.monthly ?? []).map((m) => m.currency))], [freight.data]);
  const [currencyPick, setCurrencyPick] = useState<string | null>(null);
  const currency = currencyPick && currencies.includes(currencyPick) ? currencyPick : dominantCurrency(freight.data?.monthly ?? [], me.organization.settings.defaultCurrency);
  const scale = 10 ** exponentOf(currency);

  const monthlyByCarrier = useMemo(() => {
    // Per-month spend for the selected currency (single series; carrier split is in the table).
    return (freight.data?.monthly ?? []).filter((m) => m.currency === currency).map((m) => ({ month: m.month, spend: m.totalMinor / scale, shipments: m.shipmentCount }));
  }, [freight.data, currency, scale]);

  const onTimeData = (carriers.data ?? []).filter((c) => c.onTime.eligibleCount > 0).map((c) => ({ name: c.carrierName, rate: Math.round((c.onTime.rate ?? 0) * 100), n: c.onTime.eligibleCount }));
  const poStatusData = PO_STATUSES.map((s) => ({ status: PO_STATUS[s].label, count: pos.data?.byStatus[s as PoStatus]?.count ?? 0 })).filter((d) => d.count > 0);
  const o = overview.data;
  const filtered = Object.values(state).some(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader label="// Logistics analytics" title="Analytics" description="All figures are computed from your recorded data with MongoDB aggregations. Denominators are shown so small samples are obvious." />

      <Panel>
        <PanelBody className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-subtle">From<Input type="date" value={state.from || yearAgo()} onChange={(e) => update({ from: e.target.value }, false)} className="w-auto" /></label>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">To<Input type="date" value={state.to} onChange={(e) => update({ to: e.target.value }, false)} className="w-auto" /></label>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">Carrier
            <Select value={state.carrier} onChange={(e) => update({ carrier: e.target.value }, false)} className="w-auto"><option value="">All carriers</option>{CARRIERS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">Shipment status
            <Select value={state.status} onChange={(e) => update({ status: e.target.value }, false)} className="w-auto"><option value="">All</option>{SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS[s].label}</option>)}</Select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">PO status
            <Select value={state.poStatus} onChange={(e) => update({ poStatus: e.target.value }, false)} className="w-auto"><option value="">All</option>{PO_STATUSES.map((s) => <option key={s} value={s}>{PO_STATUS[s].label}</option>)}</Select>
          </label>
          {filtered && <Button variant="ghost" size="sm" onClick={() => update({ from: '', to: '', carrier: '', status: '', poStatus: '' }, false)} icon={<X className="h-3.5 w-3.5" />}>Reset</Button>}
        </PanelBody>
      </Panel>

      {overview.isError ? (
        <Panel><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></Panel>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {!o ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />) : (
            <>
              <Kpi label="Shipments" value={o.shipments.total} sub={`${o.shipments.inTransit} in transit · ${o.shipments.delivered} delivered`} icon={<Truck className="h-4 w-4" />} />
              <Kpi label="Delayed / exception" value={o.shipments.delayedOrException} tone="danger" sub="Current status" />
              <Kpi label="On-time rate" value={formatPercent(o.onTimeDelivery.rate)} tone="success" sub={`${o.onTimeDelivery.onTimeCount} of ${o.onTimeDelivery.eligibleCount} deliveries`} icon={<Gauge className="h-4 w-4" />} />
              <Kpi label="Avg transit" value={o.averageTransit.days != null ? `${o.averageTransit.days} days` : '—'} tone="info" sub={`n=${o.averageTransit.eligibleCount}`} icon={<Timer className="h-4 w-4" />} />
              <Kpi label="Freight spend" value={o.freightSpend.length ? o.freightSpend.map((f) => formatMoney(f.totalMinor, f.currency, { compact: true })).join(' · ') : '—'} tone="info" sub={o.freightSpend.length > 1 ? 'Shown per currency — not converted' : 'Recorded at booking'} icon={<Wallet className="h-4 w-4" />} />
            </>
          )}
        </div>
      )}
      {o && o.dataProvenance.simulatedOfferShipments > 0 && (
        <p className="text-xs text-subtle">Costs for {o.dataProvenance.simulatedOfferShipments} of {o.shipments.total} shipments in this period use sample rates.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader label="Freight" title={`Monthly expenditure · ${currency}`} actions={currencies.length > 1 ? <SegmentedControl label="Currency" value={currency} onChange={setCurrencyPick} options={currencies.map((c) => ({ value: c, label: c }))} /> : undefined} />
          <PanelBody>
            {freight.isLoading ? <Skeleton className="h-[260px]" /> : freight.isError ? <ErrorState error={freight.error} onRetry={() => freight.refetch()} /> : monthlyByCarrier.length === 0 ? <ChartEmpty height={260}>No recorded freight spend in this period.</ChartEmpty> : (
              <div className="h-[260px]" role="img" aria-label={`Monthly freight spend in ${currency}`}>
                <ResponsiveContainer>
                  <BarChart data={monthlyByCarrier}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps} />
                    <YAxis width={64} tickFormatter={(v: number) => formatMoney(v * scale, currency, { compact: true })} {...axisProps} />
                    <Tooltip cursor={{ fill: 'var(--surface-3)' }} content={<ChartTooltip labelFormat={monthLabel} valueFormat={(v, name) => (name === 'Spend' ? formatMoney(v * scale, currency) : v)} />} />
                    <Bar dataKey="spend" name="Spend" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader label="Performance" title="On-time delivery by carrier" />
          <PanelBody>
            {carriers.isLoading ? <Skeleton className="h-[260px]" /> : carriers.isError ? <ErrorState error={carriers.error} onRetry={() => carriers.refetch()} /> : onTimeData.length === 0 ? <ChartEmpty height={260}>Not enough delivered shipments with expected dates to compare carriers.</ChartEmpty> : (
              <div className="h-[260px]" role="img" aria-label="On-time rate by carrier">
                <ResponsiveContainer>
                  <BarChart data={onTimeData}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} width={44} {...axisProps} />
                    <Tooltip cursor={{ fill: 'var(--surface-3)' }} content={<ChartTooltip valueFormat={(v) => `${v}%`} />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="rate" name="On-time %" fill="var(--chart-4)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader label="Carriers" title="Carrier cost & performance" />
        {carriers.isLoading || freight.isLoading ? <PanelBody><Skeleton className="h-40" /></PanelBody> : (carriers.data?.length ?? 0) === 0 ? <PanelBody><ChartEmpty height={120}>No booked shipments in this period.</ChartEmpty></PanelBody> : (
          <Table>
            <thead><tr><Th>Carrier</Th><Th className="text-right">Booked</Th><Th className="text-right">Delivered</Th><Th className="text-right">On-time</Th><Th className="text-right">Avg transit</Th><Th className="text-right" title="Shipments with at least one exception">Exceptions</Th><Th className="text-right">Spend</Th><Th className="text-right" title="Average freight cost per billable kg">Cost / kg</Th></tr></thead>
            <tbody>
              {carriers.data!.map((c) => {
                const spend = (freight.data?.byCarrier ?? []).filter((f) => f.carrierCode === c.carrierCode);
                return (
                  <tr key={c.carrierCode}>
                    <Td className="font-medium">{c.carrierName}</Td>
                    <Td className="text-right tabular">{c.bookedShipments}{c.cancelled ? <div className="text-xs whitespace-nowrap text-subtle">{c.cancelled} cancelled</div> : null}</Td>
                    <Td className="text-right tabular">{c.delivered}</Td>
                    <Td className="text-right tabular">{formatPercent(c.onTime.rate)} <span className="text-xs text-subtle">n={c.onTime.eligibleCount}</span></Td>
                    <Td className="text-right tabular">{c.averageTransitDays.value != null ? `${c.averageTransitDays.value} d` : '—'} <span className="text-xs text-subtle">n={c.averageTransitDays.eligibleCount}</span></Td>
                    <Td className="text-right tabular">{c.shipmentsWithExceptions}</Td>
                    <Td className="text-right text-[13px] whitespace-nowrap tabular">{spend.length ? spend.map((s) => <div key={s.currency}>{formatMoney(s.totalMinor, s.currency)}</div>) : '—'}</Td>
                    <Td className="text-right text-[13px] whitespace-nowrap tabular">{spend.length ? spend.map((s) => <div key={s.currency}>{s.avgCostPerKgMinor != null ? `${formatMoney(s.avgCostPerKgMinor, s.currency)}/kg` : '—'}</div>) : '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader label="Procurement" title="Purchase orders by status" />
          <PanelBody className="space-y-4">
            {pos.isLoading ? <Skeleton className="h-[220px]" /> : pos.isError ? <ErrorState error={pos.error} onRetry={() => pos.refetch()} /> : poStatusData.length === 0 ? <ChartEmpty height={220}>No purchase orders in this period.</ChartEmpty> : (
              <>
                <div className="h-[200px]" role="img" aria-label="Purchase orders by status">
                  <ResponsiveContainer>
                    <BarChart data={poStatusData}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="status" {...axisProps} />
                      <YAxis allowDecimals={false} width={32} {...axisProps} />
                      <Tooltip cursor={{ fill: 'var(--surface-3)' }} content={<ChartTooltip />} />
                      <Bar dataKey="count" name="Orders" radius={[4, 4, 0, 0]}>{poStatusData.map((d, i) => <Cell key={d.status} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}</Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid gap-2 text-[13px] sm:grid-cols-2">
                  <div className="rounded-lg border border-line p-3"><div className="hud-label">Order value (excl. cancelled)</div>{pos.data!.totals.map((t) => <div key={t.currency} className="tabular">{formatMoney(t.totalMinor, t.currency)} <span className="text-subtle">· {t.count} orders</span></div>)}</div>
                  <div className="rounded-lg border border-line p-3"><div className="hud-label">Open commitments</div>{pos.data!.openCommitments.length ? pos.data!.openCommitments.map((t) => <div key={t.currency} className="tabular">{formatMoney(t.totalMinor, t.currency)}</div>) : <div className="text-muted">None</div>}<div className="text-xs text-subtle">Approved → partially received</div></div>
                </div>
              </>
            )}
          </PanelBody>
        </Panel>

        <Panel hud>
          <PanelHeader label="Hypothetical" title="Potential savings from alternative offers" actions={<PiggyBank className="h-4 w-4 text-subtle" />} />
          <PanelBody className="space-y-3">
            {savings.isLoading ? <Skeleton className="h-32" /> : savings.isError ? <ErrorState error={savings.error} onRetry={() => savings.refetch()} /> : savings.data!.byCurrency.length === 0 ? <ChartEmpty height={140}>No booked shipments with recorded comparisons in this period.</ChartEmpty> : (
              <>
                {savings.data!.byCurrency.map((s) => (
                  <div key={s.currency} className="rounded-lg border border-line p-3">
                    <div className="flex items-baseline justify-between"><span className="hud-label">{s.currency}</span><span className="text-xl font-semibold tabular">{formatMoney(s.potentialSavingsMinor, s.currency)}</span></div>
                    <div className="mt-1 text-[13px] text-muted">{s.shipmentsWithCheaperAlternative} of {s.comparedShipments} compared shipments had a cheaper eligible option · selected spend {formatMoney(s.selectedTotalMinor, s.currency)}</div>
                  </div>
                ))}
                <InlineNotice tone="warning">{savings.data!.definition}</InlineNotice>
              </>
            )}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader label="Methodology" title="Metric definitions" actions={<BookOpen className="h-4 w-4 text-subtle" />} />
        <PanelBody>
          <dl className="grid gap-4 md:grid-cols-2">
            {DEFINITIONS.map(([t, d]) => (
              <div key={t}><dt className="text-sm font-medium">{t}</dt><dd className="mt-0.5 text-[13px] text-muted">{d}</dd></div>
            ))}
          </dl>
        </PanelBody>
      </Panel>
    </div>
  );
}
