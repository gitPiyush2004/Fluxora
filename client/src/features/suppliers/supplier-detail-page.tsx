import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ClipboardPlus, Pencil } from 'lucide-react';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { countryName } from '@/lib/geo';
import { Badge, PoStatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/page';
import { DataList, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Table, Td, Th } from '@/components/ui/table';
import { useSupplier } from './hooks';
import { SupplierDialog } from './supplier-dialog';

export default function SupplierDetailPage() {
  const { id } = useParams();
  const [editing, setEditing] = useState(false);
  const q = useSupplier(id);
  if (q.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Suppliers', to: '/suppliers' }, { label: s.name }]}
        label={`// ${s.supplierRef}`}
        title={<>{s.name}<Badge tone={s.isActive ? 'success' : 'neutral'} dot>{s.isActive ? 'Active' : 'Inactive'}</Badge></>}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)} icon={<Pencil className="h-4 w-4" />}>Edit</Button>
            {s.isActive && <ButtonLink to={`/purchase-orders/new?supplierId=${s._id}`} icon={<ClipboardPlus className="h-4 w-4" />}>New purchase order</ButtonLink>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader label="Contact" />
          <PanelBody>
            <DataList columns={1} items={[
              { label: 'Contact person', value: s.contactPerson },
              { label: 'Email', value: <a href={`mailto:${s.email}`} className="text-accent hover:underline">{s.email}</a> },
              { label: 'Phone', value: s.phone },
              { label: 'Address', value: [s.address, s.city, s.postalCode].filter(Boolean).join(', ') },
              { label: 'Country', value: countryName(s.country) },
            ]} />
          </PanelBody>
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader label="Procurement" title="Recent purchase orders" />
          {s.recentOrders.length ? (
            <Table>
              <thead><tr><Th>PO</Th><Th>Ordered</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
              <tbody>
                {s.recentOrders.map((p) => (
                  <tr key={p._id} className="hover:bg-surface-2">
                    <Td><Link className="font-mono text-[13px] hover:text-accent" to={`/purchase-orders/${p._id}`}>{p.poNumber}</Link></Td>
                    <Td>{formatDate(p.orderDate)}</Td>
                    <Td><PoStatusBadge status={p.status} /></Td>
                    <Td className="text-right tabular">{formatMoney(p.totalMinor, p.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No purchase orders yet" />
          )}
        </Panel>
        <Panel className="lg:col-span-3">
          <PanelHeader label="Audit" title="Activity" />
          <PanelBody>
            {s.activity.length ? (
              <ul className="space-y-2 text-[13px]">
                {s.activity.map((a) => (
                  <li key={a._id} className="flex flex-wrap gap-x-3"><span className="font-mono text-xs text-subtle">{formatDateTime(a.createdAt, true)}</span><span>{a.summary}</span><span className="text-muted">{a.actorName}</span></li>
                ))}
              </ul>
            ) : <span className="text-sm text-muted">No activity recorded.</span>}
          </PanelBody>
        </Panel>
      </div>
      <SupplierDialog open={editing} supplier={s} onClose={() => setEditing(false)} />
    </div>
  );
}
