import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { Lock, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import type { Shipment } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { useSession } from '@/providers/auth';
import { Button } from '@/components/ui/button';
import { ErrorState, InlineNotice, Spinner } from '@/components/ui/feedback';
import { Field, FormSection, Input, Textarea } from '@/components/ui/form';
import { PageHeader } from '@/components/ui/page';
import { Panel, PanelBody } from '@/components/ui/panel';
import { useShipment } from './hooks';
import { applyServerErrors, defaultSpecValues, SpecFields, specValuesFromShipment, toSpecPayload, useSpecForm } from './spec-form';

export default function ShipmentFormPage() {
  const { id } = useParams();
  const existing = useShipment(id);
  if (id && existing.isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (id && existing.isError) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;
  return <ShipmentForm key={existing.data?._id ?? 'new'} existing={id ? existing.data : undefined} />;
}

/** The form initialises its state from props once; the loader above remounts it per record. */
function ShipmentForm({ existing }: { existing?: Shipment }) {
  const id = existing?._id;
  const isEdit = !!existing;
  const me = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useSpecForm(existing ? specValuesFromShipment(existing) : defaultSpecValues(me.organization.settings.defaultCurrency));
  const [contents, setContents] = useState(existing?.contentsDescription ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const specEditable = !isEdit || ['DRAFT', 'QUOTED'].includes(existing.status);

  const save = useMutation({
    mutationFn: async () => {
      const spec = toSpecPayload(form.getValues());
      if (isEdit) {
        return (await api.patch<Shipment>(`/shipments/${id}`, { ...(specEditable && form.formState.isDirty ? { spec } : {}), contentsDescription: contents, notes })).data;
      }
      return (await api.post<Shipment>('/shipments', { spec, contentsDescription: contents || undefined, notes: notes || undefined })).data;
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.shipments.all });
      void qc.invalidateQueries({ queryKey: keys.shipment(s._id) });
      toast.success(isEdit ? 'Shipment updated' : `Shipment ${s.reference} created`);
      navigate(`/shipments/${s._id}${isEdit ? '' : '?tab=offers'}`);
    },
    onError: (err) => {
      if (!applyServerErrors(form, err)) toast.error(errorMessage(err));
    },
  });

  const submit = specEditable ? form.handleSubmit(() => save.mutate()) : (e: React.FormEvent) => { e.preventDefault(); save.mutate(); };

  return (
    <div>
      <PageHeader
        label={isEdit ? `// ${existing.reference}` : '// New shipment'}
        title={isEdit ? 'Edit shipment' : 'Create shipment'}
        breadcrumbs={[{ label: 'Shipments', to: '/shipments' }, ...(isEdit ? [{ label: existing.reference, to: `/shipments/${id}` }] : []), { label: isEdit ? 'Edit' : 'New' }]}
        description={isEdit ? undefined : 'Describe the movement. You can compare carrier offers right after saving.'}
      />
      <form noValidate onSubmit={submit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>
          <PanelBody className="space-y-8 p-5 sm:p-6">
            {isEdit && existing.status === 'QUOTED' && (
              <InlineNotice tone="warning">Changing route, cargo or requirements clears the selected offer and returns the shipment to <b>Draft</b> — you’ll need to compare again.</InlineNotice>
            )}
            {specEditable ? (
              <SpecFields form={form} divisor={me.organization.settings.volumetricDivisor} />
            ) : (
              <InlineNotice tone="info" icon={<Lock className="h-4 w-4 text-info" />}>
                This shipment is <b>{existing?.status.toLowerCase().replace(/_/g, ' ')}</b>. Route, cargo and requirements are locked after booking; you can still edit the contents description and notes.
              </InlineNotice>
            )}
            <FormSection title="05 · Contents & notes">
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Contents description" hint="Shown on documents and to the carrier">
                  {(p) => <Input {...p} value={contents} maxLength={500} onChange={(e) => setContents(e.target.value)} placeholder="e.g. 400 × USB-C hubs, boxed" />}
                </Field>
                <Field label="Internal notes">
                  {(p) => <Textarea {...p} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />}
                </Field>
              </div>
            </FormSection>
          </PanelBody>
        </Panel>
        <div className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <Panel hud>
            <PanelBody className="space-y-3">
              <div className="hud-label">{isEdit ? 'Save changes' : 'Create as draft'}</div>
              <Button type="submit" className="w-full" loading={save.isPending} icon={<Save className="h-4 w-4" />}>
                {isEdit ? 'Save changes' : 'Create shipment'}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => navigate(isEdit ? `/shipments/${id}` : '/shipments')}>
                Cancel
              </Button>
            </PanelBody>
          </Panel>
        </div>
      </form>
    </div>
  );
}
