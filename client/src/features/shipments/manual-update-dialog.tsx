import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { SHIPMENT_STATUS } from '@/lib/constants';
import { COUNTRY_OPTIONS } from '@/lib/geo';
import type { Shipment, ShipmentStatus } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

/** Mirrors the server's allowed transitions so users only see valid choices (server still enforces). */
const NEXT: Partial<Record<ShipmentStatus, ShipmentStatus[]>> = {
  BOOKED: ['PICKED_UP', 'IN_TRANSIT', 'DELAYED', 'EXCEPTION'],
  PICKED_UP: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', 'EXCEPTION', 'DELIVERED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'DELAYED', 'EXCEPTION', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELAYED', 'EXCEPTION', 'IN_TRANSIT'],
  DELAYED: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'],
  EXCEPTION: ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELAYED', 'DELIVERED'],
};

function nowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

type Props = { shipment: Shipment; open: boolean; onClose: () => void };

export function ManualUpdateDialog(props: Props) {
  return props.open ? <ManualUpdateDialogBody {...props} /> : null;
}

function ManualUpdateDialogBody({ shipment, open, onClose }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => ({ status: '', description: '', occurredAt: nowLocal(), city: '', country: '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const options = NEXT[shipment.status] ?? [];
  const save = useMutation({
    mutationFn: async () =>
      api.post(`/shipments/${shipment._id}/events`, {
        status: form.status || undefined,
        description: form.description.trim(),
        occurredAt: new Date(form.occurredAt).toISOString(),
        city: form.city.trim() || undefined,
        country: form.country || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.shipment(shipment._id) });
      void qc.invalidateQueries({ queryKey: keys.shipmentEvents(shipment._id) });
      toast.success('Update recorded');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record tracking update"
      description="For carriers without a tracking integration. Entries are labelled “entered by user”."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              const e: Record<string, string> = {};
              if (!form.description.trim()) e.description = 'Describe what happened';
              if (new Date(form.occurredAt).getTime() > Date.now() + 5 * 60_000) e.occurredAt = 'Cannot be in the future';
              setErrors(e);
              if (!Object.keys(e).length) save.mutate();
            }}
          >
            Record update
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New status" hint="Leave unchanged to add a note only" className="sm:col-span-2">
          {(p) => (
            <Select {...p} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="">No status change (note)</option>
              {options.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS[s].label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Description" required error={errors.description} className="sm:col-span-2">
          {(p) => <Textarea {...p} value={form.description} maxLength={500} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Carrier confirmed arrival at destination terminal" />}
        </Field>
        <Field label="Occurred at" error={errors.occurredAt}>
          {(p) => <Input {...p} type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />}
        </Field>
        <Field label="City">
          {(p) => <Input {...p} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}
        </Field>
        <Field label="Country">
          {(p) => (
            <Select {...p} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
              <option value="">—</option>
              {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
