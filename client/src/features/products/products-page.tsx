import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { z } from 'zod';
import { Boxes, Pencil, Plus, Power, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { CURRENCIES, UNITS_OF_MEASURE } from '@/lib/constants';
import { formatMoney, fromMinorUnits, toMinorUnits } from '@/lib/format';
import { keys } from '@/lib/query-keys';
import type { Product } from '@/lib/types';
import { useSession } from '@/providers/auth';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Pagination, SortableTh, Table, Td, Th } from '@/components/ui/table';
import { useDebouncedSearch, useUrlState } from '../shared/hooks';
import { useProducts } from './hooks';

const schema = z.object({
  sku: z.string().trim().min(1, 'Required').max(64).regex(/^[A-Za-z0-9._/-]+$/, 'Letters, numbers and . _ / - only'),
  name: z.string().trim().min(1, 'Required').max(160),
  description: z.string().trim().max(1000),
  category: z.string().trim().max(80),
  unitOfMeasure: z.enum(UNITS_OF_MEASURE),
  unitCost: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 12.50'),
  currency: z.enum(CURRENCIES),
});
type Values = z.infer<typeof schema>;

function ProductDialog({ open, onClose, product, categories }: { open: boolean; onClose: () => void; product: Product | null; categories: string[] }) {
  const me = useSession();
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<Values>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (!open) return;
    reset(
      product
        ? { sku: product.sku, name: product.name, description: product.description ?? '', category: product.category ?? '', unitOfMeasure: product.unitOfMeasure as Values['unitOfMeasure'], unitCost: fromMinorUnits(product.defaultUnitCostMinor, product.currency), currency: product.currency as Values['currency'] }
        : { sku: '', name: '', description: '', category: '', unitOfMeasure: 'EA', unitCost: '', currency: me.organization.settings.defaultCurrency as Values['currency'] },
    );
  }, [open, product, reset, me.organization.settings.defaultCurrency]);

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const body = { sku: v.sku, name: v.name, description: v.description || undefined, category: v.category || undefined, unitOfMeasure: v.unitOfMeasure, currency: v.currency, defaultUnitCostMinor: toMinorUnits(v.unitCost, v.currency) };
      return product ? (await api.patch<Product>(`/products/${product._id}`, body)).data : (await api.post<Product>('/products', body)).data;
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: keys.products.all });
      toast.success(product ? 'Product updated' : `Product ${p.sku} created`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setError('sku', { message: 'This SKU already exists' });
      else toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={product ? `Edit ${product.sku}` : 'New product'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>{product ? 'Save changes' : 'Create product'}</Button></>}
    >
      <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" required error={errors.sku?.message}>{(p) => <Input {...p} {...register('sku')} />}</Field>
        <Field label="Name" required error={errors.name?.message}>{(p) => <Input {...p} {...register('name')} />}</Field>
        <Field label="Category" error={errors.category?.message}>
          {(p) => (
            <>
              <Input {...p} list="product-categories" {...register('category')} />
              <datalist id="product-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Unit of measure" required>{(p) => <Select {...p} {...register('unitOfMeasure')}>{UNITS_OF_MEASURE.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
        <Field label="Default unit cost" required error={errors.unitCost?.message}>{(p) => <Input {...p} inputMode="decimal" {...register('unitCost')} />}</Field>
        <Field label="Currency" required>{(p) => <Select {...p} {...register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Description" className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...register('description')} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

const DEFAULTS = { page: '1', sortBy: 'name', sortDir: 'asc', search: '', status: 'all', category: '' };

export default function ProductsPage() {
  const qc = useQueryClient();
  const [state, update] = useUrlState(DEFAULTS);
  const [search, setSearch] = useDebouncedSearch(state.search, (value) => update({ search: value }));
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [toggling, setToggling] = useState<Product | null>(null);

  const query = useProducts(state);
  const categories = query.data?.meta?.categories ?? [];
  const toggle = useMutation({
    mutationFn: async (p: Product) => api.patch(`/products/${p._id}/status`, { isActive: !p.isActive }),
    onSuccess: (_r, p) => { void qc.invalidateQueries({ queryKey: keys.products.all }); toast.success(`${p.sku} ${p.isActive ? 'deactivated' : 'activated'}`); setToggling(null); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sort = (f: string) => update({ sortBy: f, sortDir: state.sortBy === f && state.sortDir === 'asc' ? 'desc' : 'asc' }, false);

  return (
    <div>
      <PageHeader label="// Lightweight ERP" title="Products" description="A reference catalogue for purchase order lines — not an inventory system." actions={<Button onClick={() => setEditing(null)} icon={<Plus className="h-4 w-4" />}>New product</Button>} />
      <Panel>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search products" placeholder="Search SKU, name or category…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select aria-label="Category" value={state.category} onChange={(e) => update({ category: e.target.value })} className="w-auto">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </Select>
          <Select aria-label="Status" value={state.status} onChange={(e) => update({ status: e.target.value })} className="w-auto">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </div>
        {query.isLoading ? (
          <SkeletonRows rows={6} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data!.data.length === 0 ? (
          <EmptyState icon={<Boxes className="h-5 w-5" />} title="No products found" action={<Button onClick={() => setEditing(null)}>New product</Button>} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <SortableTh field="sku" label="SKU" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="name" label="Product" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <SortableTh field="category" label="Category" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} />
                  <Th>UoM</Th>
                  <SortableTh field="defaultUnitCostMinor" label="Unit cost" sortBy={state.sortBy} sortDir={state.sortDir as 'asc' | 'desc'} onSort={sort} className="text-right" />
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {query.data!.data.map((p) => (
                  <tr key={p._id} className="hover:bg-surface-2">
                    <Td className="font-mono text-[13px]">{p.sku}</Td>
                    <Td><div className="font-medium">{p.name}</div>{p.description && <div className="max-w-[320px] truncate text-xs text-muted">{p.description}</div>}</Td>
                    <Td className="text-[13px]">{p.category ?? '—'}</Td>
                    <Td className="font-mono text-[12px]">{p.unitOfMeasure}</Td>
                    <Td className="text-right tabular">{formatMoney(p.defaultUnitCostMinor, p.currency)}</Td>
                    <Td><Badge tone={p.isActive ? 'success' : 'neutral'} dot>{p.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                      <Button size="sm" variant="ghost" onClick={() => setToggling(p)} icon={<Power className="h-3.5 w-3.5" />}>{p.isActive ? 'Deactivate' : 'Activate'}</Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination meta={query.data!.meta} onPage={(pg) => update({ page: String(pg) }, false)} />
          </>
        )}
      </Panel>
      <ProductDialog open={editing !== undefined} product={editing ?? null} onClose={() => setEditing(undefined)} categories={categories} />
      <ConfirmDialog
        open={!!toggling}
        title={toggling?.isActive ? `Deactivate ${toggling?.sku}?` : `Activate ${toggling?.sku}?`}
        description={toggling?.isActive ? 'Inactive products are hidden from new purchase order lines. Existing orders keep their lines.' : 'The product becomes available for new purchase order lines.'}
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        loading={toggle.isPending}
        onConfirm={() => toggling && toggle.mutate(toggling)}
        onClose={() => setToggling(null)}
      />
    </div>
  );
}
