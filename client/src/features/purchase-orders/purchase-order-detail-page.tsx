import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { Ban, CheckCircle2, FlaskConical, PackageCheck, Pencil, Send, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PO_STATUS } from '@/lib/constants';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { countryName } from '@/lib/geo';
import type { PoStatus, PurchaseOrder, Supplier } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth';
import { Badge, PoStatusBadge, StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, InlineNotice, Spinner } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { DataList, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Table, Td, Th } from '@/components/ui/table';
import { usePurchaseOrder } from './hooks';
import { CreateShipmentDialog, ReceiveDialog } from './po-dialogs';

const FLOW: PoStatus[] = ['DRAFT', 'APPROVED', 'READY_TO_SHIP', 'PARTIALLY_RECEIVED', 'RECEIVED'];

export default function PurchaseOrderDetailPage() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = usePurchaseOrder(id);
  const [dialog, setDialog] = useState<'approve' | 'ready' | 'cancel' | 'receive' | 'ship' | null>(null);
  const [reason, setReason] = useState('');

  const action = useMutation({
    mutationFn: async (kind: 'approve' | 'ready-to-ship' | 'cancel') => (await api.post<PurchaseOrder>(`/purchase-orders/${id}/${kind}`, kind === 'cancel' ? { reason: reason.trim() || undefined } : {})).data,
    onSuccess: (po) => {
      void qc.invalidateQueries({ queryKey: keys.purchaseOrder(id) });
      void qc.invalidateQueries({ queryKey: keys.purchaseOrders.all });
      toast.success(`${po.poNumber} is now ${PO_STATUS[po.status].label.toLowerCase()}`);
      setDialog(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const po = q.data!;
  const supplier = po.supplierId as Supplier;
  const shippable = po.status === 'READY_TO_SHIP' || po.status === 'PARTIALLY_RECEIVED';
  const cancellable = ['DRAFT', 'APPROVED', 'READY_TO_SHIP'].includes(po.status) && !po.lines.some((l) => l.receivedQuantity > 0);
  const flowIndex = FLOW.indexOf(po.status);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Purchase orders', to: '/purchase-orders' }, { label: po.poNumber }]}
        label="// Purchase order"
        title={<><span className="font-mono">{po.poNumber}</span><PoStatusBadge status={po.status} /></>}
        meta={po.isDemo ? <Badge tone="sim"><FlaskConical className="h-3 w-3" /> Seeded demo record</Badge> : undefined}
        actions={
          <>
            {po.status === 'DRAFT' && <ButtonLink to={`/purchase-orders/${po._id}/edit`} variant="outline" icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink>}
            {po.status === 'DRAFT' && (
              <Button onClick={() => setDialog('approve')} disabled={!isAdmin} title={isAdmin ? undefined : 'Only organization admins can approve purchase orders'} icon={<CheckCircle2 className="h-4 w-4" />}>
                Approve
              </Button>
            )}
            {po.status === 'APPROVED' && <Button onClick={() => setDialog('ready')} icon={<Send className="h-4 w-4" />}>Mark ready to ship</Button>}
            {shippable && <Button onClick={() => setDialog('ship')} icon={<Truck className="h-4 w-4" />}>Create shipment</Button>}
            {shippable && <Button variant="outline" onClick={() => setDialog('receive')} icon={<PackageCheck className="h-4 w-4" />}>Receive goods</Button>}
            {cancellable && isAdmin && <Button variant="ghost" className="text-danger" onClick={() => setDialog('cancel')} icon={<Ban className="h-4 w-4" />}>Cancel</Button>}
          </>
        }
      />

      {po.status === 'DRAFT' && !isAdmin && <InlineNotice tone="info">Waiting for approval by an organization admin.</InlineNotice>}
      {po.status === 'CANCELLED' && <InlineNotice tone="warning">Cancelled {formatDate(po.cancelledAt)}{po.cancellationReason ? ` — ${po.cancellationReason}` : ''}.</InlineNotice>}

      {po.status !== 'CANCELLED' && (
        <Panel hud className="overflow-x-auto">
          <ol className="flex min-w-[560px] items-center p-4" aria-label="Purchase order lifecycle">
            {FLOW.map((s, i) => (
              <li key={s} className="flex flex-1 items-center last:flex-none">
                <span className={cn('flex items-center gap-2 text-[13px]', i <= flowIndex ? 'text-fg' : 'text-subtle')} aria-current={i === flowIndex ? 'step' : undefined}>
                  <span className={cn('h-2.5 w-2.5 rounded-full', i < flowIndex ? 'bg-accent' : i === flowIndex ? 'bg-accent ring-4 ring-[var(--accent-soft)]' : 'bg-line-strong')} />
                  {PO_STATUS[s].label}
                </span>
                {i < FLOW.length - 1 && <span className={cn('mx-3 h-px flex-1', i < flowIndex ? 'bg-accent' : 'bg-line')} />}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader label="Supplier" title={<Link to={`/suppliers/${supplier._id}`} className="hover:text-accent">{supplier.name}</Link>} />
          <PanelBody>
            <DataList columns={1} items={[
              { label: 'Reference', value: supplier.supplierRef, mono: true },
              { label: 'Contact', value: [supplier.contactPerson, supplier.email].filter(Boolean).join(' · ') },
              { label: 'Ships from', value: `${supplier.city}, ${countryName(supplier.country)}` },
            ]} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader label="Delivery" title={po.destination.name ?? po.destination.city} />
          <PanelBody>
            <DataList columns={1} items={[
              { label: 'Address', value: [po.destination.address, po.destination.city, po.destination.postalCode].filter(Boolean).join(', ') },
              { label: 'Country', value: countryName(po.destination.country) },
              { label: 'Order date', value: formatDate(po.orderDate) },
              { label: 'Expected delivery', value: formatDate(po.expectedDeliveryDate) },
            ]} />
          </PanelBody>
        </Panel>
        <Panel hud>
          <PanelHeader label="Totals" title={formatMoney(po.totalMinor, po.currency)} />
          <PanelBody className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular">{formatMoney(po.subtotalMinor, po.currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax ({po.taxRateBps / 100}%)</span><span className="tabular">{formatMoney(po.taxMinor, po.currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Additional charges</span><span className="tabular">{formatMoney(po.additionalChargesMinor, po.currency)}</span></div>
            <div className="flex justify-between border-t border-line pt-1.5 font-semibold"><span>Total</span><span className="tabular">{formatMoney(po.totalMinor, po.currency)}</span></div>
            {po.notes && <p className="pt-2 text-[13px] text-muted">{po.notes}</p>}
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader label="Lines" title="Order lines & receiving" />
        <Table>
          <thead><tr><Th>SKU</Th><Th>Description</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit price</Th><Th className="text-right">Line total</Th><Th className="text-right">Received</Th><Th className="text-right">Outstanding</Th></tr></thead>
          <tbody>
            {po.lines.map((l) => {
              const out = Math.round((l.quantity - l.receivedQuantity) * 1000) / 1000;
              return (
                <tr key={l._id}>
                  <Td className="font-mono text-[13px]">{l.sku ?? '—'}</Td>
                  <Td>{l.description}</Td>
                  <Td className="text-right tabular">{l.quantity} <span className="text-xs text-subtle">{l.unitOfMeasure}</span></Td>
                  <Td className="text-right tabular">{formatMoney(l.unitPriceMinor, po.currency)}</Td>
                  <Td className="text-right tabular">{formatMoney(l.lineTotalMinor, po.currency)}</Td>
                  <Td className="text-right tabular">{l.receivedQuantity}</Td>
                  <Td className={cn('text-right tabular', out === 0 && 'text-success')}>{out === 0 ? 'Complete' : out}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader label="Logistics" title="Linked shipments" actions={shippable ? <Button size="sm" variant="outline" onClick={() => setDialog('ship')}>Create shipment</Button> : undefined} />
          {po.shipments?.length ? (
            <ul className="divide-y divide-line">
              {po.shipments.map((s) => (
                <li key={s._id}>
                  <Link to={`/shipments/${s._id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <span className="font-mono text-[13px]">{s.reference}</span>
                    <StatusBadge status={s.status} />
                    {s.quoteIsSimulated && <FlaskConical className="h-3.5 w-3.5 text-sim" aria-label="Simulated" />}
                    <span className="ml-auto text-xs text-muted">{s.carrierName ?? 'No carrier yet'} · {formatMoney(s.freightCostMinor, s.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Truck className="h-5 w-5" />} title="No shipments yet" description={shippable ? 'Create a shipment to move these goods.' : 'Shipments can be created once the order is ready to ship.'} />
          )}
        </Panel>
        <Panel>
          <PanelHeader label="Audit" title="Activity history" />
          <PanelBody>
            <ul className="space-y-3">
              {[...(po.receipts ?? []).map((r) => ({ id: r._id, at: r.receivedAt, text: `Goods receipt: ${r.lines.map((x) => `${x.quantity} × ${po.lines.find((l) => l._id === x.lineId)?.description ?? 'line'}`).join(', ')}${r.note ? ` — ${r.note}` : ''}`, who: r.receivedByName })),
                ...(po.activity ?? []).filter((a) => a.action !== 'GOODS_RECEIVED' && !a.summary.startsWith('Goods received')).map((a) => ({ id: a._id, at: a.createdAt, text: a.summary, who: a.actorName }))]
                .sort((a, b) => b.at.localeCompare(a.at))
                .map((e) => (
                  <li key={e.id} className="text-[13px]">
                    <div>{e.text}</div>
                    <div className="font-mono text-[11px] text-subtle">{formatDateTime(e.at, true)}{e.who ? ` · ${e.who}` : ''}</div>
                  </li>
                ))}
            </ul>
          </PanelBody>
        </Panel>
      </div>

      <ConfirmDialog open={dialog === 'approve'} tone="primary" title={`Approve ${po.poNumber}?`} description={`Approving commits ${formatMoney(po.totalMinor, po.currency)} with ${supplier.name}. The order can no longer be edited.`} confirmLabel="Approve order" loading={action.isPending} onConfirm={() => action.mutate('approve')} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'ready'} tone="primary" title="Mark ready to ship?" description="Confirms the supplier has the goods ready. You can then create shipments and receive goods." confirmLabel="Mark ready" loading={action.isPending} onConfirm={() => action.mutate('ready-to-ship')} onClose={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'cancel'} title={`Cancel ${po.poNumber}?`} description="Cancelled orders cannot be reopened. Orders with received goods or active shipments cannot be cancelled." confirmLabel="Cancel order" loading={action.isPending} onConfirm={() => action.mutate('cancel')} onClose={() => setDialog(null)}>
        <Field label="Reason">{(p) => <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
      </ConfirmDialog>
      {shippable && <ReceiveDialog po={po} open={dialog === 'receive'} onClose={() => setDialog(null)} />}
      {shippable && <CreateShipmentDialog po={po} open={dialog === 'ship'} onClose={() => setDialog(null)} />}
    </div>
  );
}
