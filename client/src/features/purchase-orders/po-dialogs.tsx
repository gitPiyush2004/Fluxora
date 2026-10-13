import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { SERVICE_LEVELS, SHIPMENT_TYPES } from '@/lib/constants';
import type { PurchaseOrder, Shipment, Supplier } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InlineNotice } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Table, Td, Th } from '@/components/ui/table';

const outstanding = (l: PurchaseOrder['lines'][number]) => Math.round((l.quantity - (l.receivedQuantity ?? 0)) * 1000) / 1000;

type DialogProps = { po: PurchaseOrder; open: boolean; onClose: () => void };

/** Dialog bodies mount only while open, so their form state always starts fresh. */
export function ReceiveDialog(props: DialogProps) {
  return props.open ? <ReceiveDialogBody {...props} /> : null;
}

export function CreateShipmentDialog(props: DialogProps) {
  return props.open ? <CreateShipmentDialogBody {...props} /> : null;
}

function ReceiveDialogBody({ po, open, onClose }: DialogProps) {
  const qc = useQueryClient();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const receive = useMutation({
    mutationFn: async () =>
      (
        await api.post<PurchaseOrder>(`/purchase-orders/${po._id}/receive`, {
          lines: Object.entries(qty).filter(([, v]) => v !== '' && Number(v) !== 0).map(([lineId, v]) => ({ lineId, quantity: Number(v) })),
          note: note.trim() || undefined,
        })
      ).data,
    onSuccess: (updated) => {
      void qc.invalidateQueries({ queryKey: keys.purchaseOrder(po._id) });
      void qc.invalidateQueries({ queryKey: keys.purchaseOrders.all });
      toast.success(updated.status === 'RECEIVED' ? 'All goods received — order complete' : 'Partial receipt recorded');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k.replace('lines.', ''), v])));
      } else toast.error(errorMessage(err));
    },
  });

  const validate = () => {
    const e: Record<string, string> = {};
    const entries = Object.entries(qty).filter(([, v]) => v !== '');
    for (const [lineId, v] of entries) {
      const line = po.lines.find((l) => l._id === lineId)!;
      const n = Number(v);
      if (!/^\d+(\.\d{1,3})?$/.test(v)) e[lineId] = 'Enter a non-negative quantity (max 3 decimals)';
      else if (n > outstanding(line)) e[lineId] = `Max ${outstanding(line)}`;
    }
    if (!entries.some(([, v]) => Number(v) > 0)) e._ = 'Enter a received quantity for at least one line';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Receive goods · ${po.poNumber}`}
      description="Record what physically arrived. Quantities cannot exceed what is outstanding."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={receive.isPending} onClick={() => validate() && receive.mutate()}>Record receipt</Button>
        </>
      }
    >
      {errors._ && <InlineNotice tone="danger" className="mb-3">{errors._}</InlineNotice>}
      <Table>
        <thead><tr><Th>Item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Outstanding</Th><Th>Receive now</Th></tr></thead>
        <tbody>
          {po.lines.map((l) => {
            const out = outstanding(l);
            return (
              <tr key={l._id}>
                <Td><div className="font-medium">{l.description}</div>{l.sku && <div className="font-mono text-[11px] text-subtle">{l.sku}</div>}</Td>
                <Td className="text-right tabular">{l.quantity}</Td>
                <Td className="text-right tabular">{l.receivedQuantity ?? 0}</Td>
                <Td className="text-right tabular">{out}</Td>
                <Td>
                  <Input
                    aria-label={`Quantity received for ${l.description}`}
                    inputMode="decimal"
                    disabled={out <= 0}
                    value={qty[l._id] ?? ''}
                    placeholder={out > 0 ? '0' : 'Complete'}
                    aria-invalid={!!errors[l._id] || undefined}
                    onChange={(e) => setQty({ ...qty, [l._id]: e.target.value })}
                    className="w-28"
                  />
                  {errors[l._id] && <div className="mt-1 text-xs text-danger" role="alert">{errors[l._id]}</div>}
                  {out > 0 && <button type="button" className="mt-1 text-[11px] text-accent hover:underline" onClick={() => setQty({ ...qty, [l._id]: String(out) })}>All outstanding</button>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <Field label="Receipt note" className="mt-4">{(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. 2 cartons damaged, photographed" />}</Field>
    </Dialog>
  );
}

function CreateShipmentDialogBody({ po, open, onClose }: DialogProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const supplier = po.supplierId as Supplier;
  const [items, setItems] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.lines.filter((l) => outstanding(l) > 0).map((l) => [l._id, String(outstanding(l))])),
  );
  const [spec, setSpec] = useState({ shipmentType: 'BOX', packageCount: '1', actualWeightKg: '', lengthCm: '', widthCm: '', heightCm: '', servicePreference: '', requiredDeliveryDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<Shipment>(`/purchase-orders/${po._id}/shipments`, {
          spec: {
            shipmentType: spec.shipmentType,
            packageCount: Number(spec.packageCount),
            actualWeightKg: Number(spec.actualWeightKg),
            lengthCm: spec.lengthCm ? Number(spec.lengthCm) : undefined,
            widthCm: spec.widthCm ? Number(spec.widthCm) : undefined,
            heightCm: spec.heightCm ? Number(spec.heightCm) : undefined,
            servicePreference: spec.servicePreference || null,
            requiredDeliveryDate: spec.requiredDeliveryDate || null,
            insuranceRequired: false,
            specialHandling: [],
          },
          items: Object.entries(items).filter(([, q]) => Number(q) > 0).map(([poLineId, q]) => ({ poLineId, quantity: Number(q) })),
        })
      ).data,
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.purchaseOrder(po._id) });
      void qc.invalidateQueries({ queryKey: keys.shipments.all });
      toast.success(`Shipment ${s.reference} created — compare carrier offers next`);
      navigate(`/shipments/${s._id}?tab=offers`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!(Number(spec.actualWeightKg) > 0)) e.actualWeightKg = 'Enter the actual shipment weight';
    if (!Number.isInteger(Number(spec.packageCount)) || Number(spec.packageCount) < 1) e.packageCount = 'Whole number ≥ 1';
    const dims = [spec.lengthCm, spec.widthCm, spec.heightCm].filter(Boolean).length;
    if (dims !== 0 && dims !== 3) e.lengthCm = 'Enter all three dimensions or none';
    if (!Object.values(items).some((q) => Number(q) > 0)) e.items = 'Select at least one line to ship';
    for (const l of po.lines) if (Number(items[l._id] ?? 0) > outstanding(l)) e[`item-${l._id}`] = `Max ${outstanding(l)}`;
    setErrors(e);
    if (!Object.keys(e).length) create.mutate();
  };

  const set = (k: keyof typeof spec) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setSpec({ ...spec, [k]: e.target.value });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Create shipment from ${po.poNumber}`}
      description={`Origin pre-filled from ${supplier?.name ?? 'the supplier'} (${supplier?.city}, ${supplier?.country}); destination from the order (${po.destination.city}, ${po.destination.country}).`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={submit}>Create shipment</Button></>}
    >
      <div className="space-y-5">
        <div>
          <div className="hud-label mb-2">Items to ship</div>
          {errors.items && <InlineNotice tone="danger" className="mb-2">{errors.items}</InlineNotice>}
          <Table>
            <thead><tr><Th>Item</Th><Th className="text-right">Outstanding</Th><Th>Ship quantity</Th></tr></thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l._id}>
                  <Td>{l.description}</Td>
                  <Td className="text-right tabular">{outstanding(l)} {l.unitOfMeasure}</Td>
                  <Td>
                    <Input aria-label={`Ship quantity for ${l.description}`} className="w-28" inputMode="decimal" disabled={outstanding(l) <= 0} value={items[l._id] ?? ''} onChange={(e) => setItems({ ...items, [l._id]: e.target.value })} />
                    {errors[`item-${l._id}`] && <div className="mt-1 text-xs text-danger">{errors[`item-${l._id}`]}</div>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Shipment type" required>{(p) => <Select {...p} value={spec.shipmentType} onChange={set('shipmentType')}>{SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}</Field>
          <Field label="Packages" required error={errors.packageCount}>{(p) => <Input {...p} inputMode="numeric" value={spec.packageCount} onChange={set('packageCount')} />}</Field>
          <Field label="Actual total weight (kg)" required error={errors.actualWeightKg}>{(p) => <Input {...p} inputMode="decimal" value={spec.actualWeightKg} onChange={set('actualWeightKg')} />}</Field>
          <Field label="Service level">{(p) => <Select {...p} value={spec.servicePreference} onChange={set('servicePreference')}><option value="">Any</option>{SERVICE_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>}</Field>
          <Field label="Length (cm)" error={errors.lengthCm}>{(p) => <Input {...p} inputMode="decimal" value={spec.lengthCm} onChange={set('lengthCm')} />}</Field>
          <Field label="Width (cm)">{(p) => <Input {...p} inputMode="decimal" value={spec.widthCm} onChange={set('widthCm')} />}</Field>
          <Field label="Height (cm)">{(p) => <Input {...p} inputMode="decimal" value={spec.heightCm} onChange={set('heightCm')} />}</Field>
          <Field label="Required delivery by" hint="Defaults to the PO expected date">{(p) => <Input {...p} type="date" value={spec.requiredDeliveryDate} onChange={set('requiredDeliveryDate')} />}</Field>
        </div>
        <p className="text-xs text-subtle">Cargo value is taken from the order subtotal. The purchase order and shipment remain separate, linked records — an order can have several shipments.</p>
      </div>
    </Dialog>
  );
}
