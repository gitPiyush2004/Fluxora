import { Link, useNavigate } from 'react-router';
import { ClipboardList, ClipboardPlus, Search, X } from 'lucide-react';
import { PO_STATUS, PO_STATUSES } from '@/lib/constants';
import { formatDate, formatMoney } from '@/lib/format';
import type { Supplier } from '@/lib/types';
import { Button, ButtonLink } from '@/components/ui/button';
import { PoStatusBadge } from '@/components/ui/badge';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Pagination, SortableTh, Table, Td, Th } from '@/components/ui/table';
import { useDebouncedSearch, useUrlState } from '../shared/hooks';
import { useActiveSuppliers, usePurchaseOrders } from './hooks';

const DEFAULTS = { page: '1', sortBy: 'orderDate', sortDir: 'desc', search: '', status: '', supplierId: '', from: '', to: '' };

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [state, update] = useUrlState(DEFAULTS);
  const [search, setSearch] = useDebouncedSearch(state.search, (value) => update({ search: value }));
  const query = usePurchaseOrders(state);
  const suppliers = useActiveSuppliers();
  const sort = (f: string) => update({ sortBy: f, sortDir: state.sortBy === f && state.sortDir === 'desc' ? 'asc' : 'desc' }, false);
  const filtered = !!(state.search || state.status || state.supplierId || state.from || state.to);

  return (
    <div>
      <PageHeader
        title="Purchase orders"
        description="Orders to your suppliers, from draft through approval to goods received."
        actions={<ButtonLink to="/purchase-orders/new" icon={<ClipboardPlus className="h-4 w-4" />}>New purchase order</ButtonLink>}
      />
      <Panel>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search purchase orders" placeholder="Search PO number, supplier, item or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Status" value={state.status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
            <option value="">All statuses</option>
            {PO_STATUSES.map((s) => <option key={s} value={s}>{PO_STATUS[s].label}</option>)}
            <option value="APPROVED,READY_TO_SHIP,PARTIALLY_RECEIVED">Open (approved → partially received)</option>
          </Select>
          <Select aria-label="Supplier" value={state.supplierId} onChange={(e) => update({ supplierId: e.target.value })} className="w-auto max-w-[220px]">
            <option value="">All suppliers</option>
            {suppliers.data?.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </Select>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">Ordered from<Input type="date" value={state.from} onChange={(e) => update({ from: e.target.value })} className="w-auto" /></label>
          <label className="flex flex-col gap-1 text-[11px] text-subtle">to<Input type="date" value={state.to} onChange={(e) => update({ to: e.target.value })} className="w-auto" /></label>
          {filtered && <Button variant="ghost" size="sm" onClick={() => { setSearch(''); update({ search: '', status: '', supplierId: '', from: '', to: '' }); }} icon={<X className="h-3.5 w-3.5" />}>Clear</Button>}
        </div>
        {query.isLoading ? (
          <SkeletonRows rows={6} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data!.data.length === 0 ? (
          <EmptyState icon={<ClipboardList className="h-5 w-5" />} title={filtered ? 'No purchase orders match' : 'No purchase orders yet'} action={!filtered && <ButtonLink to="/purchase-orders/new">New purchase order</ButtonLink>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <SortableTh field="poNumber" label="PO number" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <Th>Supplier</Th>
                  <SortableTh field="orderDate" label="Ordered" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="expectedDeliveryDate" label="Expected" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="status" label="Status" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="totalMinor" label="Total" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} className="text-right" />
                </tr>
              </thead>
              <tbody>
                {query.data!.data.map((po) => {
                  const supplier = po.supplierId as Supplier | undefined;
                  return (
                    <tr key={po._id} className="cursor-pointer hover:bg-surface-2" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) navigate(`/purchase-orders/${po._id}`); }}>
                      <Td><Link to={`/purchase-orders/${po._id}`} className="font-mono text-[13px] font-medium hover:text-accent">{po.poNumber}</Link></Td>
                      <Td className="text-[13px]">{supplier?.name ?? '—'}</Td>
                      <Td className="whitespace-nowrap">{formatDate(po.orderDate)}</Td>
                      <Td className="whitespace-nowrap">{formatDate(po.expectedDeliveryDate)}</Td>
                      <Td><PoStatusBadge status={po.status} /></Td>
                      <Td className="text-right tabular whitespace-nowrap">{formatMoney(po.totalMinor, po.currency)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination meta={query.data!.meta} onPage={(p) => update({ page: String(p) }, false)} />
          </>
        )}
      </Panel>
    </div>
  );
}
