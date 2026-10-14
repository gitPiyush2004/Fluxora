import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { CARRIERS, SHIPMENT_TYPES } from '@/lib/constants';
import { COUNTRY_OPTIONS } from '@/lib/geo';
import { useMutation } from '@/lib/mutation';
import { keys } from '@/lib/query-keys';
import type { Shipment } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { useCarrierIntegrations } from './hooks';

const EMPTY = { carrierCode: 'DSV', trackingNumber: '', fromCity: '', fromCountry: '', toCity: '', toCountry: '', shipmentType: 'PARCEL', weightKg: '', contents: '' };

/** What tracking the user gets for a carrier, based on the server's connected integrations. */
const TRACKING_LABEL: Record<string, string> = { LIVE: 'live tracking', SANDBOX: 'test-environment tracking' };

type Props = { open: boolean; onClose: () => void };

/** "Track a shipment": follow a shipment booked outside Fluxora by its tracking number. */
export function TrackShipmentDialog(props: Props) {
  return props.open ? <TrackShipmentDialogBody {...props} /> : null;
}

function TrackShipmentDialogBody({ open, onClose }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const integrations = useCarrierIntegrations();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const trackingOf = (code: string) => TRACKING_LABEL[integrations.data?.find((c) => c.code === code)?.tracking ?? ''] ?? 'manual updates';

  const track = useMutation({
    mutationFn: async () =>
      api.post<Shipment>('/shipments/track', {
        carrierCode: form.carrierCode,
        trackingNumber: form.trackingNumber.trim(),
        origin: { city: form.fromCity.trim(), country: form.fromCountry },
        destination: { city: form.toCity.trim(), country: form.toCountry },
        shipmentType: form.shipmentType,
        actualWeightKg: form.weightKg ? Number(form.weightKg) : undefined,
        contentsDescription: form.contents.trim() || undefined,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: keys.shipments.all });
      const trackingError = (res.meta as { trackingError?: string } | undefined)?.trackingError;
      if (trackingError) toast.warning(`Added, but the carrier returned no events yet: ${trackingError}`);
      else toast.success(`Now tracking ${res.data.reference}`);
      navigate(`/shipments/${res.data._id}?tab=tracking`);
    },
    onError: (err) => {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else toast.error(errorMessage(err));
    },
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (form.trackingNumber.trim().length < 4) e.trackingNumber = 'Enter the tracking number from the carrier';
    if (!form.fromCity.trim()) e['origin.city'] = 'Required';
    if (!form.fromCountry) e['origin.country'] = 'Required';
    if (!form.toCity.trim()) e['destination.city'] = 'Required';
    if (!form.toCountry) e['destination.country'] = 'Required';
    if (form.weightKg && !(Number(form.weightKg) > 0)) e.weightKg = 'Must be greater than zero';
    setErrors(e);
    if (!Object.keys(e).length) track.mutate();
  };

  const country = (k: 'fromCountry' | 'toCountry') => (p: object) => (
    <Select {...p} value={form[k]} onChange={set(k)}>
      <option value="">Select country…</option>
      {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
    </Select>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Track a shipment"
      description="Already booked with the carrier? Add its tracking number and Fluxora follows it, with alerts when it's delayed or stuck."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={track.isPending} onClick={submit}>Start tracking</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Carrier" required hint={`This carrier gets ${trackingOf(form.carrierCode)}.`}>
          {(p) => <Select {...p} value={form.carrierCode} onChange={set('carrierCode')}>{CARRIERS.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>}
        </Field>
        <Field label="Tracking number" required error={errors.trackingNumber}>{(p) => <Input {...p} value={form.trackingNumber} onChange={set('trackingNumber')} placeholder="e.g. 40257145990010760574" />}</Field>
        <Field label="From city" required error={errors['origin.city']}>{(p) => <Input {...p} value={form.fromCity} onChange={set('fromCity')} />}</Field>
        <Field label="From country" required error={errors['origin.country']}>{country('fromCountry')}</Field>
        <Field label="To city" required error={errors['destination.city']}>{(p) => <Input {...p} value={form.toCity} onChange={set('toCity')} />}</Field>
        <Field label="To country" required error={errors['destination.country']}>{country('toCountry')}</Field>
        <Field label="Type">{(p) => <Select {...p} value={form.shipmentType} onChange={set('shipmentType')}>{SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>}</Field>
        <Field label="Weight (kg)" hint="Optional" error={errors.weightKg}>{(p) => <Input {...p} inputMode="decimal" value={form.weightKg} onChange={set('weightKg')} />}</Field>
        <Field label="Contents" hint="Optional" className="sm:col-span-2">{(p) => <Input {...p} value={form.contents} onChange={set('contents')} placeholder="e.g. Sample cartons for Q3 launch" />}</Field>
      </div>
    </Dialog>
  );
}
