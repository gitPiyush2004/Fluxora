import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useFieldArray, useForm, useWatch, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { z } from 'zod';
import { Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { CURRENCIES, UNITS_OF_MEASURE } from '@/lib/constants';
import { formatMoney, fromMinorUnits, toDateInput, toMinorUnits } from '@/lib/format';
import { COUNTRY_OPTIONS } from '@/lib/geo';
import { previewLineTotal, previewTotals } from '@/lib/po-math';
import type { PurchaseOrder, Supplier } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { useSession } from '@/providers/auth';
import { Button } from '@/components/ui/button';
import { ErrorState, InlineNotice, Spinner } from '@/components/ui/feedback';
import { Field, FormSection, Input, Select, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { useActiveProducts, useActiveSuppliers, usePurchaseOrder } from './hooks';

const amount = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount like 12.50');
const schema = z
  .object({
    supplierId: z.string().min(1, 'Select a supplier'),
    orderDate: z.string().min(1, 'Required'),
    expectedDeliveryDate: z.string(),
    currency: z.enum(CURRENCIES),
    destination: z.object({
      name: z.string().max(160),
      address: z.string().max(300),
      city: z.string().trim().min(1, 'Required').max(120),
      postalCode: z.string().max(20),
      country: z.string().min(2, 'Select a country'),
    }),
    lines: z
      .array(
        z.object({
          productId: z.string(),
          description: z.string().trim().min(1, 'Required').max(300),
          quantity: z.string().trim().refine((v) => /^\d+(\.\d{1,3})?$/.test(v) && Number(v) > 0, 'Quantity > 0, max 3 decimals'),
          unitOfMeasure: z.enum(UNITS_OF_MEASURE),
          unitPrice: amount,
        }),
      )
      .min(1, 'Add at least one line'),
    taxRate: z.string().trim().refine((v) => v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100), '0–100 with up to 2 decimals'),
    charges: z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 25.00'),
    notes: z.string().max(2000),
  })
  .superRefine((v, ctx) => {
    if (v.expectedDeliveryDate && v.orderDate && v.expectedDeliveryDate < v.orderDate) ctx.addIssue({ code: 'custom', path: ['expectedDeliveryDate'], message: 'Must be on or after the order date' });
    v.lines.forEach((l, i) => {
      if (Number.isNaN(toMinorUnits(l.unitPrice, v.currency))) ctx.addIssue({ code: 'custom', path: ['lines', i, 'unitPrice'], message: `Too many decimals for ${v.currency}` });
    });
  });
type Values = z.infer<typeof schema>;

const emptyLine = { productId: '', description: '', quantity: '1', unitOfMeasure: 'EA' as const, unitPrice: '' };

function fromPo(po: PurchaseOrder): Values {
  const supplier = po.supplierId as Supplier | string;
  return {
    supplierId: typeof supplier === 'string' ? supplier : supplier._id,
    orderDate: toDateInput(po.orderDate),
    expectedDeliveryDate: toDateInput(po.expectedDeliveryDate),
    currency: po.currency as Values['currency'],
    destination: { name: po.destination.name ?? '', address: po.destination.address ?? '', city: po.destination.city, postalCode: po.destination.postalCode ?? '', country: po.destination.country },
    lines: po.lines.map((l) => ({ productId: l.productId ?? '', description: l.description, quantity: String(l.quantity), unitOfMeasure: l.unitOfMeasure as Values['lines'][number]['unitOfMeasure'], unitPrice: fromMinorUnits(l.unitPriceMinor, po.currency) })),
    taxRate: po.taxRateBps ? String(po.taxRateBps / 100) : '',
    charges: po.additionalChargesMinor ? fromMinorUnits(po.additionalChargesMinor, po.currency) : '',
    notes: po.notes ?? '',
  };
}

export default function PurchaseOrderFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isEdit = !!id;
  const me = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = usePurchaseOrder(id);
  const suppliers = useActiveSuppliers();
  const products = useActiveProducts();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      supplierId: params.get('supplierId') ?? '',
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: '',
      currency: me.organization.settings.defaultCurrency as Values['currency'],
      destination: { name: '', address: '', city: '', postalCode: '', country: '' },
      lines: [{ ...emptyLine }],
      taxRate: '',
      charges: '',
      notes: '',
    },
  });
  const { register, control, handleSubmit, reset, setValue, setError, formState: { errors } } = form;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const [lines, currency, taxRate, charges] = useWatch({ control, name: ['lines', 'currency', 'taxRate', 'charges'] });

  useEffect(() => {
    if (existing.data) reset(fromPo(existing.data));
  }, [existing.data, reset]);

  const totals = previewTotals(
    lines.map((l) => ({ quantity: Number(l.quantity), unitPriceMinor: toMinorUnits(l.unitPrice || '0', currency) })),
    Math.round(Number(taxRate || 0) * 100),
    toMinorUnits(charges || '0', currency),
  );

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const body = {
        supplierId: v.supplierId,
        orderDate: v.orderDate,
        expectedDeliveryDate: v.expectedDeliveryDate || null,
        currency: v.currency,
        destination: { ...v.destination, name: v.destination.name || undefined, address: v.destination.address || undefined, postalCode: v.destination.postalCode || undefined },
        lines: v.lines.map((l) => ({ productId: l.productId || undefined, description: l.description, quantity: Number(l.quantity), unitOfMeasure: l.unitOfMeasure, unitPriceMinor: toMinorUnits(l.unitPrice, v.currency) })),
        taxRateBps: Math.round(Number(v.taxRate || 0) * 100),
        additionalChargesMinor: v.charges ? toMinorUnits(v.charges, v.currency) : 0,
        notes: v.notes || undefined,
        ...(isEdit ? { version: existing.data?.__v } : {}),
      };
      return isEdit ? (await api.patch<PurchaseOrder>(`/purchase-orders/${id}`, body)).data : (await api.post<PurchaseOrder>('/purchase-orders', body)).data;
    },
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: keys.purchaseOrders.all });
      void qc.invalidateQueries({ queryKey: keys.purchaseOrder(po._id) });
      toast.success(isEdit ? 'Purchase order updated' : `Purchase order ${po.poNumber} created as draft`);
      navigate(`/purchase-orders/${po._id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        for (const [path, message] of Object.entries(err.fieldErrors)) setError(path.replace('unitPriceMinor', 'unitPrice') as Path<Values>, { message });
      }
      toast.error(errorMessage(err));
    },
  });

  if (isEdit && existing.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (isEdit && existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  if (isEdit && existing.data && existing.data.status !== 'DRAFT') {
    return <InlineNotice tone="warning">Only draft purchase orders can be edited. {existing.data.poNumber} is {existing.data.status.toLowerCase().replace(/_/g, ' ')}.</InlineNotice>;
  }

  const onProduct = (index: number, productId: string) => {
    const p = products.data?.find((x) => x._id === productId);
    setValue(`lines.${index}.productId`, productId);
    if (!p) return;
    setValue(`lines.${index}.description`, p.name, { shouldValidate: true });
    setValue(`lines.${index}.unitOfMeasure`, p.unitOfMeasure as Values['lines'][number]['unitOfMeasure']);
    if (p.currency === currency) setValue(`lines.${index}.unitPrice`, fromMinorUnits(p.defaultUnitCostMinor, p.currency), { shouldValidate: true });
    else toast.message(`Default cost for ${p.sku} is in ${p.currency}; enter the ${currency} price manually.`);
  };

  return (
    <div>
      <PageHeader
        label={isEdit ? `// ${existing.data?.poNumber}` : '// New purchase order'}
        title={isEdit ? 'Edit purchase order' : 'Create purchase order'}
        breadcrumbs={[{ label: 'Purchase orders', to: '/purchase-orders' }, ...(isEdit ? [{ label: existing.data!.poNumber, to: `/purchase-orders/${id}` }] : []), { label: isEdit ? 'Edit' : 'New' }]}
      />
      <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Panel>
            <PanelBody className="space-y-8 p-5 sm:p-6">
              <FormSection title="01 · Supplier & dates">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Supplier" required error={errors.supplierId?.message} className="lg:col-span-2" hint={suppliers.data?.length === 0 ? 'Create an active supplier first' : undefined}>
                    {(p) => (
                      <Select {...p} {...register('supplierId')}>
                        <option value="">Select supplier…</option>
                        {suppliers.data?.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.supplierRef})</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Order date" required error={errors.orderDate?.message}>{(p) => <Input {...p} type="date" {...register('orderDate')} />}</Field>
                  <Field label="Expected delivery" error={errors.expectedDeliveryDate?.message}>{(p) => <Input {...p} type="date" {...register('expectedDeliveryDate')} />}</Field>
                  <Field label="Currency" required>{(p) => <Select {...p} {...register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
                </div>
              </FormSection>
              <FormSection title="02 · Deliver to">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Facility name" className="lg:col-span-2">{(p) => <Input {...p} {...register('destination.name')} />}</Field>
                  <Field label="Address" className="lg:col-span-2">{(p) => <Input {...p} {...register('destination.address')} />}</Field>
                  <Field label="City" required error={errors.destination?.city?.message}>{(p) => <Input {...p} {...register('destination.city')} />}</Field>
                  <Field label="Postal code">{(p) => <Input {...p} {...register('destination.postalCode')} />}</Field>
                  <Field label="Country" required error={errors.destination?.country?.message} className="lg:col-span-2">
                    {(p) => <Select {...p} {...register('destination.country')}><option value="">Select country…</option>{COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>}
                  </Field>
                </div>
              </FormSection>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader label="03 · Line items" title={`${fields.length} line${fields.length === 1 ? '' : 's'}`} actions={<Button size="sm" variant="outline" onClick={() => append({ ...emptyLine })} icon={<Plus className="h-3.5 w-3.5" />}>Add line</Button>} />
            <div className="divide-y divide-line">
              {fields.map((f, i) => {
                const le = errors.lines?.[i];
                const lineTotal = previewLineTotal(toMinorUnits(lines[i]?.unitPrice || '0', currency), Number(lines[i]?.quantity));
                return (
                  <div key={f.id} className="grid gap-3 p-4 md:grid-cols-[1.2fr_2fr_0.7fr_0.7fr_0.9fr_auto] md:items-start">
                    <Field label="Product">
                      {(p) => (
                        <Select {...p} value={lines[i]?.productId ?? ''} onChange={(e) => onProduct(i, e.target.value)}>
                          <option value="">Free-text item</option>
                          {products.data?.map((pr) => <option key={pr._id} value={pr._id}>{pr.sku} — {pr.name}</option>)}
                        </Select>
                      )}
                    </Field>
                    <Field label="Description" required error={le?.description?.message}>{(p) => <Input {...p} {...register(`lines.${i}.description`)} />}</Field>
                    <Field label="Qty" required error={le?.quantity?.message}>{(p) => <Input {...p} inputMode="decimal" {...register(`lines.${i}.quantity`)} />}</Field>
                    <Field label="UoM">{(p) => <Select {...p} {...register(`lines.${i}.unitOfMeasure`)}>{UNITS_OF_MEASURE.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
                    <Field label={`Unit price (${currency})`} required error={le?.unitPrice?.message}>{(p) => <Input {...p} inputMode="decimal" {...register(`lines.${i}.unitPrice`)} />}</Field>
                    <div className="flex items-end gap-2 md:flex-col md:items-end">
                      <div className="text-right"><div className="hud-label">Line total</div><div className="text-sm font-medium tabular">{formatMoney(lineTotal, currency)}</div></div>
                      <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => remove(i)} disabled={fields.length === 1}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {errors.lines?.root?.message && <p className="px-4 pb-4 text-xs text-danger">{errors.lines.root.message}</p>}
          </Panel>

          <Panel>
            <PanelBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Tax rate (%)" error={errors.taxRate?.message}>{(p) => <Input {...p} inputMode="decimal" placeholder="0" {...register('taxRate')} />}</Field>
              <Field label={`Additional charges (${currency})`} error={errors.charges?.message}>{(p) => <Input {...p} inputMode="decimal" placeholder="0.00" {...register('charges')} />}</Field>
              <Field label="Notes" className="sm:col-span-3">{(p) => <Textarea {...p} {...register('notes')} />}</Field>
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <Panel hud>
            <PanelHeader label="Order total (preview)" />
            <PanelBody className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular">{formatMoney(totals.subtotal, currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Tax ({taxRate || 0}%)</span><span className="tabular">{formatMoney(totals.tax, currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted">Additional charges</span><span className="tabular">{formatMoney(totals.charges, currency)}</span></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><span>Total</span><span className="tabular">{formatMoney(totals.total, currency)}</span></div>
              <p className="text-xs text-subtle">Totals are recalculated by the server on save using integer minor units.</p>
              <Button type="submit" className="mt-2 w-full" loading={save.isPending} icon={<Save className="h-4 w-4" />}>{isEdit ? 'Save draft' : 'Create draft'}</Button>
              <Button variant="ghost" className="w-full" onClick={() => navigate(isEdit ? `/purchase-orders/${id}` : '/purchase-orders')}>Cancel</Button>
            </PanelBody>
          </Panel>
        </div>
      </form>
    </div>
  );
}
