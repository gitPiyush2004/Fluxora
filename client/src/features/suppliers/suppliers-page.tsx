import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { Factory, Pencil, Plus, Power, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { COUNTRY_OPTIONS, countryName } from '@/lib/geo';
import { keys } from '@/lib/query-keys';
import type { Supplier } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Pagination, SortableTh, Table, Td, Th } from '@/components/ui/table';
import { useDebouncedSearch, useUrlState } from '../shared/hooks';
import { useSuppliers } from './hooks';
import { SupplierDialog } from './supplier-dialog';

const DEFAULTS = { page: '1', sortBy: 'name', sortDir: 'asc', search: '', status: 'all', country: '' };

export default function SuppliersPage() {
  const qc = useQueryClient();
  const [state, update] = useUrlState(DEFAULTS);
  const [search, setSearch] = useDebouncedSearch(state.search, (value) => update({ search: value }));
  const [editing, setEditing] = useState<Supplier | null | undefined>(undefined);
  const [toggling, setToggling] = useState<Supplier | null>(null);

  const query = useSuppliers(state);
  const toggle = useMutation({
    mutationFn: async (s: Supplier) => api.patch(`/suppliers/${s._id}/status`, { isActive: !s.isActive }),
    onSuccess: (_r, s) => {
      void qc.invalidateQueries({ queryKey: keys.suppliers.all });
      toast.success(`${s.name} ${s.isActive ? 'deactivated' : 'activated'}`);
      setToggling(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sort = (f: string) => update({ sortBy: f, sortDir: state.sortBy === f && state.sortDir === 'asc' ? 'desc' : 'asc' }, false);

  return (
    <div>
      <PageHeader
        label="// Lightweight ERP"
        title="Suppliers"
        description="Who you buy from. Inactive suppliers stay on historical orders but can’t receive new ones."
        actions={<Button onClick={() => setEditing(null)} icon={<Plus className="h-4 w-4" />}>New supplier</Button>}
      />
      <Panel>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search suppliers" placeholder="Search name, reference, email, city…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Status" value={state.status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Select aria-label="Country" value={state.country} onChange={(e) => update({ country: e.target.value })} className="w-auto max-w-[220px]">
            <option value="">All countries</option>
            {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </div>
        {query.isLoading ? (
          <SkeletonRows rows={6} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data!.data.length === 0 ? (
          <EmptyState icon={<Factory className="h-5 w-5" />} title="No suppliers found" description="Add the companies you purchase from." action={<Button onClick={() => setEditing(null)}>New supplier</Button>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <SortableTh field="supplierRef" label="Ref" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="name" label="Supplier" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <Th>Contact</Th>
                  <SortableTh field="country" label="Location" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {query.data!.data.map((s) => (
                  <tr key={s._id} className="hover:bg-surface-2">
                    <Td className="font-mono text-[13px]">{s.supplierRef}</Td>
                    <Td><Link to={`/suppliers/${s._id}`} className="font-medium hover:text-accent">{s.name}</Link></Td>
                    <Td className="text-[13px]">
                      {s.contactPerson ?? '—'}
                      <div className="text-xs text-muted">{s.email}</div>
                    </Td>
                    <Td className="text-[13px]">{s.city}, {countryName(s.country)}</Td>
                    <Td><Badge tone={s.isActive ? 'success' : 'neutral'} dot>{s.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setToggling(s)} icon={<Power className="h-3.5 w-3.5" />}>{s.isActive ? 'Deactivate' : 'Activate'}</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={query.data!.meta} onPage={(p) => update({ page: String(p) }, false)} />
          </>
        )}
      </Panel>
      <SupplierDialog open={editing !== undefined} supplier={editing} onClose={() => setEditing(undefined)} />
      <ConfirmDialog
        open={!!toggling}
        title={toggling?.isActive ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        description={toggling?.isActive ? 'Deactivated suppliers can’t be used on new purchase orders or approvals. Existing orders are unaffected.' : 'The supplier becomes available for new purchase orders.'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
