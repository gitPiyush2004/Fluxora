import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { z } from 'zod';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/lib/api';
import { COUNTRY_OPTIONS } from '@/lib/geo';
import type { Supplier } from '@/lib/types';
import { keys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

const schema = z.object({
  supplierRef: z.string().trim().min(1, 'Required').max(40).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, dashes or underscores'),
  name: z.string().trim().min(1, 'Required').max(160),
  contactPerson: z.string().trim().max(120),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z.string().trim().max(40).regex(/^[0-9+()\-.\s]*$/, 'Invalid phone number'),
  country: z.string().min(2, 'Select a country'),
  city: z.string().trim().min(1, 'Required').max(120),
  postalCode: z.string().trim().max(20),
  address: z.string().trim().max(300),
});
type Values = z.infer<typeof schema>;

const empty: Values = { supplierRef: '', name: '', contactPerson: '', email: '', phone: '', country: '', city: '', postalCode: '', address: '' };

export function SupplierDialog({ open, onClose, supplier }: { open: boolean; onClose: () => void; supplier?: Supplier | null }) {
  const qc = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: empty });
  const { register, handleSubmit, reset, setError, formState: { errors } } = form;

  useEffect(() => {
    if (open) reset(supplier ? { ...empty, ...Object.fromEntries(Object.entries(supplier).filter(([k]) => k in empty).map(([k, v]) => [k, v ?? ''])) } : empty);
  }, [open, supplier, reset]);

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const body = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val === '' && !['supplierRef', 'name', 'email', 'country', 'city'].includes(k) ? undefined : val]));
      return supplier ? (await api.patch<Supplier>(`/suppliers/${supplier._id}`, body)).data : (await api.post<Supplier>('/suppliers', body)).data;
    },
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: keys.suppliers.all });
      void qc.invalidateQueries({ queryKey: keys.supplier(s._id) });
      toast.success(supplier ? 'Supplier updated' : `Supplier ${s.name} created`);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) setError('supplierRef', { message: 'This supplier reference is already in use' });
      else if (err instanceof ApiError && Object.keys(err.fieldErrors).length) Object.entries(err.fieldErrors).forEach(([k, m]) => setError(k as keyof Values, { message: m }));
      else toast.error(errorMessage(err));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={supplier ? `Edit ${supplier.name}` : 'New supplier'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit((v) => save.mutate(v))} loading={save.isPending}>{supplier ? 'Save changes' : 'Create supplier'}</Button>
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))} className="grid gap-4 sm:grid-cols-2">
        <Field label="Supplier reference" required error={errors.supplierRef?.message}>{(p) => <Input {...p} placeholder="SUP-001" {...register('supplierRef')} />}</Field>
        <Field label="Supplier name" required error={errors.name?.message}>{(p) => <Input {...p} {...register('name')} />}</Field>
        <Field label="Contact person" error={errors.contactPerson?.message}>{(p) => <Input {...p} {...register('contactPerson')} />}</Field>
        <Field label="Email" required error={errors.email?.message}>{(p) => <Input {...p} type="email" {...register('email')} />}</Field>
        <Field label="Phone" error={errors.phone?.message}>{(p) => <Input {...p} type="tel" {...register('phone')} />}</Field>
        <Field label="Country" required error={errors.country?.message}>
          {(p) => (
            <Select {...p} {...register('country')}>
              <option value="">Select country…</option>
              {COUNTRY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="City" required error={errors.city?.message}>{(p) => <Input {...p} {...register('city')} />}</Field>
        <Field label="Postal code" error={errors.postalCode?.message}>{(p) => <Input {...p} {...register('postalCode')} />}</Field>
        <Field label="Address" error={errors.address?.message} className="sm:col-span-2">{(p) => <Textarea {...p} rows={2} {...register('address')} />}</Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
