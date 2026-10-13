import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { CalendarCheck, FlaskConical, Send } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage, newIdempotencyKey } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Shipment } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { InlineNotice } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { SegmentedControl } from '@/components/ui/page';
import { useCarrierIntegrations } from './hooks';

/**
 * Books the selected offer. One idempotency key is generated per dialog opening, so
 * double-clicks and network retries can never create two bookings.
 */
type Props = { shipment: Shipment; open: boolean; onClose: () => void };

export function BookingDialog(props: Props) {
  // Mounting per opening gives every booking attempt a fresh idempotency key and form.
  return props.open ? <BookingDialogBody {...props} /> : null;
}

function BookingDialogBody({ shipment, open, onClose }: Props) {
  const qc = useQueryClient();
  const carriers = useCarrierIntegrations();
  const integration = carriers.data?.find((c) => c.code === shipment.carrierCode);
  const providerBookingAvailable = shipment.quoteIsSimulated ? integration?.booking === 'SIMULATED' : integration?.booking === 'LIVE' || integration?.booking === 'SANDBOX';
  const [modeChoice, setMode] = useState<'PROVIDER' | 'MANUAL' | null>(null);
  const mode = modeChoice ?? (carriers.data && !providerBookingAvailable ? 'MANUAL' : 'PROVIDER');
  const [key, setKey] = useState(newIdempotencyKey);
  const [manual, setManual] = useState({ bookingReference: '', trackingNumber: '', expectedDeliveryDate: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const book = useMutation({
    mutationFn: async () => {
      const body =
        mode === 'PROVIDER'
          ? { mode }
          : { mode, bookingReference: manual.bookingReference.trim(), trackingNumber: manual.trackingNumber.trim() || undefined, expectedDeliveryDate: manual.expectedDeliveryDate || undefined };
      return (await api.post<Shipment>(`/shipments/${shipment._id}/book`, body, { 'Idempotency-Key': key })).data;
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.shipment(shipment._id) });
      void qc.invalidateQueries({ queryKey: keys.shipmentEvents(shipment._id) });
      void qc.invalidateQueries({ queryKey: keys.shipments.all });
      toast.success(s.booking?.isSimulated ? `Simulated booking ${s.booking.reference} created` : `Booking ${s.booking?.reference} recorded`);
      onClose();
    },
    onError: (err) => {
      // A failed attempt gets a fresh key so the user can retry deliberately.
      setKey(newIdempotencyKey());
      toast.error(errorMessage(err));
    },
  });

  const submit = () => {
    if (mode === 'MANUAL') {
      const e: Record<string, string> = {};
      if (manual.bookingReference.trim().length < 2) e.bookingReference = 'Enter the carrier’s booking reference';
      if (manual.trackingNumber && !/^[A-Za-z0-9-]{4,}$/.test(manual.trackingNumber.trim())) e.trackingNumber = 'Letters, numbers and dashes only';
      setErrors(e);
      if (Object.keys(e).length) return;
    }
    book.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Book shipment"
      description={`${shipment.carrierName} · ${shipment.serviceName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={book.isPending}>Cancel</Button>
          <Button onClick={submit} loading={book.isPending} icon={mode === 'PROVIDER' ? <Send className="h-4 w-4" /> : <CalendarCheck className="h-4 w-4" />}>
            {mode === 'PROVIDER' ? (shipment.quoteIsSimulated ? 'Create simulated booking' : 'Book with carrier') : 'Record booking'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-2 p-3 text-[13px]">
          <div><div className="hud-label">Price</div><div className="font-semibold tabular">{formatMoney(shipment.freightCostMinor, shipment.currency)}</div></div>
          <div><div className="hud-label">Est. delivery</div><div>{formatDate(shipment.expectedDeliveryDate)}</div></div>
          <div><div className="hud-label">Source</div><div>{shipment.quoteSourceType?.replace('_', ' ').toLowerCase()}</div></div>
        </div>

        <SegmentedControl
          label="Booking method"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'PROVIDER', label: shipment.quoteIsSimulated ? 'Simulated booking' : 'Book via API' },
            { value: 'MANUAL', label: 'Record manual booking' },
          ]}
        />

        {mode === 'PROVIDER' ? (
          providerBookingAvailable ? (
            shipment.quoteIsSimulated ? (
              <InlineNotice tone="sim" icon={<FlaskConical className="h-4 w-4 text-sim" />}>
                This offer is simulated, so Fluxora will create a <b>simulated booking</b> with a demo booking reference and simulated tracking. <b>Nothing is booked with {shipment.carrierName}.</b>
              </InlineNotice>
            ) : (
              <InlineNotice tone="info">Fluxora will submit the booking to {shipment.carrierName}. If the carrier rejects it, the shipment stays unbooked and the error is shown.</InlineNotice>
            )
          ) : (
            <InlineNotice tone="warning">
              Booking through the {shipment.carrierName} API isn’t available in this installation. Book directly with the carrier, then record the booking reference here.
            </InlineNotice>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <InlineNotice tone="info" className="sm:col-span-2">Use this when you booked directly with the carrier (portal, phone or email). Fluxora records the reference; it does not contact the carrier.</InlineNotice>
            <Field label="Carrier booking reference" required error={errors.bookingReference}>
              {(p) => <Input {...p} value={manual.bookingReference} onChange={(e) => setManual({ ...manual, bookingReference: e.target.value })} />}
            </Field>
            <Field label="Tracking number" error={errors.trackingNumber} hint="Enables live tracking if the carrier’s tracking API is configured">
              {(p) => <Input {...p} value={manual.trackingNumber} onChange={(e) => setManual({ ...manual, trackingNumber: e.target.value })} />}
            </Field>
            <Field label="Carrier’s expected delivery date" hint="Optional — overrides the quote estimate">
              {(p) => <Input {...p} type="date" value={manual.expectedDeliveryDate} onChange={(e) => setManual({ ...manual, expectedDeliveryDate: e.target.value })} />}
            </Field>
          </div>
        )}
        <p className="font-mono text-[10.5px] text-subtle">IDEMPOTENCY KEY {key.slice(0, 12)}… · repeated submissions are executed once</p>
      </div>
    </Dialog>
  );
}
