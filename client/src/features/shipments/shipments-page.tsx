import { Link, useNavigate } from 'react-router';
import { ArrowRight, FlaskConical, PackagePlus, Search, Truck, X } from 'lucide-react';
import { CARRIERS, SHIPMENT_STATUS, SHIPMENT_STATUSES } from '@/lib/constants';
import { formatDate, formatMoney } from '@/lib/format';
import { placeLabel } from '@/lib/geo';
import { ButtonLink, Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Pagination, SortableTh, Table, Td, Th } from '@/components/ui/table';
import { useDebouncedSearch, useUrlState } from '../shared/hooks';
import { useShipments } from './hooks';

const DEFAULTS = { page: '1', sortBy: 'createdAt', sortDir: 'desc', search: '', status: '', carrier: '', from: '', to: '' };

export default function ShipmentsPage() {
  const navigate = useNavigate();
  const [state, update] = useUrlState(DEFAULTS);
  const [search, setSearch] = useDebouncedSearch(state.search, (value) => update({ search: value }));

  const query = useShipments({ ...state, pageSize: '20' });
  const sort = (field: string) => update({ sortBy: field, sortDir: state.sortBy === field && state.sortDir === 'desc' ? 'asc' : 'desc' }, false);
  const filtered = !!(state.search || state.status || state.carrier || state.from || state.to);

  return (
    <div>
      <PageHeader
        label="// Shipments"
        title="Shipments"
        description="Every movement from draft to delivery. Statuses only change through valid lifecycle transitions."
        actions={
          <ButtonLink to="/shipments/new" icon={<PackagePlus className="h-4 w-4" />}>
            New shipment
          </ButtonLink>
        }
      />

      <Panel>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search shipments" placeholder="Search reference, tracking #, PO, city, carrier…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Filter by status" value={state.status} onChange={(e) => update({ status: e.target.value })} className="w-auto min-w-[150px]">
            <option value="">All statuses</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{SHIPMENT_STATUS[s].label}</option>
            ))}
            <option value="PICKED_UP,IN_TRANSIT,OUT_FOR_DELIVERY">In motion (any)</option>
            <option value="DELAYED,EXCEPTION">Delayed or exception</option>
          </Select>
          <Select aria-label="Filter by carrier" value={state.carrier} onChange={(e) => update({ carrier: e.target.value })} className="w-auto min-w-[140px]">
            <option value="">All carriers</option>
            {CARRIERS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">
            Created from
            <Input type="date" value={state.from} onChange={(e) => update({ from: e.target.value })} className="w-auto" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">
            to
            <Input type="date" value={state.to} onChange={(e) => update({ to: e.target.value })} className="w-auto" />
          </label>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); update({ search: '', status: '', carrier: '', from: '', to: '' }); }} icon={<X className="h-3.5 w-3.5" />}>
              Clear
            </Button>
          )}
        </div>

        {query.isLoading ? (
          <SkeletonRows rows={8} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data!.data.length === 0 ? (
          <EmptyState
            icon={<Truck className="h-5 w-5" />}
            title={filtered ? 'No shipments match these filters' : 'No shipments yet'}
            description={filtered ? 'Try widening the date range or clearing filters.' : 'Create a shipment or start from a carrier comparison.'}
            action={!filtered && <ButtonLink to="/shipments/new">New shipment</ButtonLink>}
          />
        ) : (
          <>
            <Table className={query.isFetching ? 'opacity-70 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <SortableTh field="reference" label="Reference" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <Th>Route</Th>
                  <Th>Carrier</Th>
                  <SortableTh field="status" label="Status" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="expectedDeliveryDate" label="Expected" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="freightCostMinor" label="Cost" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} className="text-right" />
                  <SortableTh field="createdAt" label="Created" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                </tr>
              </thead>
              <tbody>
                {query.data!.data.map((s) => (
                  <tr
                    key={s._id}
                    className="cursor-pointer hover:bg-surface-2"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a')) return;
                      navigate(`/shipments/${s._id}`);
                    }}
                  >
                    <Td>
                      <Link to={`/shipments/${s._id}`} className="font-mono text-[13px] font-medium text-fg hover:text-accent">
                        {s.reference}
                      </Link>
                      {s.purchaseOrderNumber && <div className="font-mono text-[11px] text-subtle">{s.purchaseOrderNumber}</div>}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        {placeLabel(s.origin)} <ArrowRight className="h-3 w-3 text-subtle" /> {placeLabel(s.destination)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        {s.carrierName ?? <span className="text-subtle">Not selected</span>}
                        {s.quoteIsSimulated && <FlaskConical className="h-3.5 w-3.5 text-sim" aria-label="Simulated offer" />}
                      </div>
                      {s.serviceName && <div className="text-xs text-subtle">{s.serviceName}</div>}
                    </Td>
                    <Td><StatusBadge status={s.status} /></Td>
                    <Td className="whitespace-nowrap">{formatDate(s.expectedDeliveryDate)}</Td>
                    <Td className="text-right whitespace-nowrap tabular">{formatMoney(s.freightCostMinor, s.currency)}</Td>
                    <Td className="whitespace-nowrap text-muted">{formatDate(s.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={query.data!.meta} onPage={(p) => update({ page: String(p) }, false)} />
          </>
        )}
      </Panel>
    </div>
  );
}
