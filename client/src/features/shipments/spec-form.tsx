import { useEffect, type ReactNode } from 'react';
import { useForm, useWatch, type Path, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Scale } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { CURRENCIES, SERVICE_LEVELS, SHIPMENT_TYPES, SPECIAL_HANDLING } from '@/lib/constants';
import { formatWeight, fromMinorUnits, toDateInput, toMinorUnits } from '@/lib/format';
import { COUNTRY_OPTIONS, countryName } from '@/lib/geo';
import type { Shipment, ShipmentSpec, ShipmentType, ServiceLevel, SpecialHandling } from '@/lib/types';
import { Checkbox, Field, FormSection, Input, Select } from '@/components/ui/form';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { useDebounced } from '../shared/hooks';
import { useBillableWeight } from './hooks';

/* ----------------------------------------------------------------------------
   Form model: everything is a string while editing; `toSpecPayload` converts to
   the API shape (numbers, integer minor units). The server re-validates all of it.
---------------------------------------------------------------------------- */
const num = (opts: { required?: boolean; int?: boolean; max: number; label: string }) =>
  z.string().trim().superRefine((v, ctx) => {
    if (v === '') {
      if (opts.required) ctx.addIssue({ code: 'custom', message: `${opts.label} is required` });
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) ctx.addIssue({ code: 'custom', message: `${opts.label} must be greater than zero` });
    else if (opts.int && !Number.isInteger(n)) ctx.addIssue({ code: 'custom', message: `${opts.label} must be a whole number` });
    else if (n > opts.max) ctx.addIssue({ code: 'custom', message: `${opts.label} must be at most ${opts.max}` });
  });

const money = z.string().trim().refine((v) => v === '' || /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount like 1250.00');

const place = z.object({
  name: z.string().max(160),
  address: z.string().max(300),
  city: z.string().trim().min(1, 'City is required').max(120),
  postalCode: z.string().trim().max(20).regex(/^[A-Za-z0-9 -]*$/, 'Invalid postal code'),
  country: z.string().min(2, 'Select a country'),
});

export const specFormSchema = z
  .object({
    origin: place,
    destination: place,
    shipmentType: z.enum(['PARCEL', 'BOX', 'PALLET', 'FREIGHT']),
    packageCount: num({ required: true, int: true, max: 10_000, label: 'Package count' }),
    actualWeightKg: num({ required: true, max: 1_000_000, label: 'Weight' }),
    lengthCm: num({ max: 2000, label: 'Length' }),
    widthCm: num({ max: 2000, label: 'Width' }),
    heightCm: num({ max: 2000, label: 'Height' }),
    requiredDeliveryDate: z.string(),
    servicePreference: z.enum(['', 'ECONOMY', 'STANDARD', 'EXPRESS']),
    currency: z.string().length(3),
    cargoValue: money,
    cargoCurrency: z.string(),
    insuranceRequired: z.boolean(),
    specialHandling: z.array(z.enum(['DANGEROUS_GOODS', 'TEMPERATURE_CONTROLLED', 'FRAGILE', 'OVERSIZED', 'LIFTGATE'])),
    maxBudget: money,
  })
  .superRefine((v, ctx) => {
    const dims = [v.lengthCm, v.widthCm, v.heightCm].filter((d) => d !== '').length;
    if (dims !== 0 && dims !== 3) ctx.addIssue({ code: 'custom', path: ['lengthCm'], message: 'Enter length, width and height together (or leave all empty)' });
    if (v.insuranceRequired && v.cargoValue === '') ctx.addIssue({ code: 'custom', path: ['cargoValue'], message: 'Cargo value is required for insurance' });
    if (v.requiredDeliveryDate && v.requiredDeliveryDate < new Date().toISOString().slice(0, 10)) {
      ctx.addIssue({ code: 'custom', path: ['requiredDeliveryDate'], message: 'Date is in the past' });
    }
    if (v.origin.country === v.destination.country && v.origin.city.trim().toLowerCase() === v.destination.city.trim().toLowerCase() && v.origin.postalCode === v.destination.postalCode && v.origin.city) {
      ctx.addIssue({ code: 'custom', path: ['destination', 'city'], message: 'Destination must differ from origin' });
    }
  });

export type SpecFormValues = z.infer<typeof specFormSchema>;

const emptyPlace = { name: '', address: '', city: '', postalCode: '', country: '' };

export function defaultSpecValues(currency: string): SpecFormValues {
  return {
    origin: { ...emptyPlace },
    destination: { ...emptyPlace },
    shipmentType: 'BOX',
    packageCount: '1',
    actualWeightKg: '',
    lengthCm: '',
    widthCm: '',
    heightCm: '',
    requiredDeliveryDate: '',
    servicePreference: '',
    currency,
    cargoValue: '',
    cargoCurrency: currency,
    insuranceRequired: false,
    specialHandling: [],
    maxBudget: '',
  };
}

export function specValuesFromShipment(s: Pick<Shipment, keyof ShipmentSpec> | ShipmentSpec): SpecFormValues {
  const p = (x: ShipmentSpec['origin']) => ({ name: x.name ?? '', address: x.address ?? '', city: x.city, postalCode: x.postalCode ?? '', country: x.country });
  return {
    origin: p(s.origin),
    destination: p(s.destination),
    shipmentType: s.shipmentType,
    packageCount: String(s.packageCount),
    actualWeightKg: String(s.actualWeightKg),
    lengthCm: s.lengthCm ? String(s.lengthCm) : '',
    widthCm: s.widthCm ? String(s.widthCm) : '',
    heightCm: s.heightCm ? String(s.heightCm) : '',
    requiredDeliveryDate: toDateInput(s.requiredDeliveryDate ?? undefined),
    servicePreference: (s.servicePreference ?? '') as SpecFormValues['servicePreference'],
    currency: s.currency,
    cargoValue: s.cargoValueMinor ? fromMinorUnits(s.cargoValueMinor, s.cargoCurrency ?? s.currency) : '',
    cargoCurrency: s.cargoCurrency ?? s.currency,
    insuranceRequired: !!s.insuranceRequired,
    specialHandling: [...(s.specialHandling ?? [])],
    maxBudget: s.maxBudgetMinor ? fromMinorUnits(s.maxBudgetMinor, s.currency) : '',
  };
}

const opt = (v: string) => (v.trim() === '' ? undefined : v.trim());

export function toSpecPayload(v: SpecFormValues): ShipmentSpec {
  const place = (p: SpecFormValues['origin']) => ({ name: opt(p.name), address: opt(p.address), city: p.city.trim(), postalCode: opt(p.postalCode), country: p.country });
  return {
    origin: place(v.origin),
    destination: place(v.destination),
    shipmentType: v.shipmentType as ShipmentType,
    packageCount: Number(v.packageCount),
    actualWeightKg: Number(v.actualWeightKg),
    lengthCm: v.lengthCm ? Number(v.lengthCm) : undefined,
    widthCm: v.widthCm ? Number(v.widthCm) : undefined,
    heightCm: v.heightCm ? Number(v.heightCm) : undefined,
    requiredDeliveryDate: v.requiredDeliveryDate || null,
    servicePreference: (v.servicePreference || null) as ServiceLevel | null,
    cargoValueMinor: v.cargoValue ? toMinorUnits(v.cargoValue, v.cargoCurrency || v.currency) : null,
    cargoCurrency: v.cargoValue ? v.cargoCurrency || v.currency : null,
    insuranceRequired: v.insuranceRequired,
    specialHandling: v.specialHandling as SpecialHandling[],
    maxBudgetMinor: v.maxBudget ? toMinorUnits(v.maxBudget, v.currency) : null,
    currency: v.currency,
  };
}

/** Maps server field errors (e.g. "spec.origin.city") back onto the form. */
export function applyServerErrors(form: UseFormReturn<SpecFormValues>, err: unknown, prefix = 'spec.'): boolean {
  if (!(err instanceof ApiError)) return false;
  let applied = false;
  for (const [path, message] of Object.entries(err.fieldErrors)) {
    const key = path.startsWith(prefix) ? path.slice(prefix.length) : path;
    const mapped = key.replace('cargoValueMinor', 'cargoValue').replace('maxBudgetMinor', 'maxBudget');
    form.setError(mapped as Path<SpecFormValues>, { message });
    applied = true;
  }
  return applied;
}

export function useSpecForm(initial: SpecFormValues) {
  return useForm<SpecFormValues>({ resolver: zodResolver(specFormSchema), defaultValues: initial, mode: 'onTouched' });
}

function PlaceFields({ form, prefix, title, lockedHint }: { form: UseFormReturn<SpecFormValues>; prefix: 'origin' | 'destination'; title: string; lockedHint?: string }) {
  const { register, formState: { errors } } = form;
  const e = errors[prefix];
  return (
    <FormSection title={title} description={lockedHint}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country" required error={e?.country?.message}>
          {(p) => (
            <Select {...p} {...register(`${prefix}.country`)}>
              <option value="">Select country…</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="City" required error={e?.city?.message}>
          {(p) => <Input {...p} autoComplete="off" placeholder={prefix === 'origin' ? 'e.g. Shenzhen' : 'e.g. Newark'} {...register(`${prefix}.city`)} />}
        </Field>
        <Field label="Postal code" error={e?.postalCode?.message}>
          {(p) => <Input {...p} autoComplete="off" {...register(`${prefix}.postalCode`)} />}
        </Field>
        <Field label="Name / facility" error={e?.name?.message}>
          {(p) => <Input {...p} autoComplete="off" placeholder="Optional" {...register(`${prefix}.name`)} />}
        </Field>
      </div>
    </FormSection>
  );
}

/** The full specification form body (route, cargo, requirements). */
export function SpecFields({ form, divisor, routeLocked }: { form: UseFormReturn<SpecFormValues>; divisor: number; routeLocked?: boolean }) {
  const { register, formState: { errors }, control, setValue } = form;
  const [insurance, handling, currency] = useWatch({ control, name: ['insuranceRequired', 'specialHandling', 'currency'] });

  // Keep cargo currency aligned by default.
  useEffect(() => {
    if (!form.getValues('cargoValue')) setValue('cargoCurrency', currency);
  }, [currency, form, setValue]);

  // Cross-field rules ("all three dimensions or none", insurance needs a value) must re-run
  // when a sibling field changes, otherwise a stale error lingers.
  const [len, wid, hei, cargoValue] = useWatch({ control, name: ['lengthCm', 'widthCm', 'heightCm', 'cargoValue'] });
  useEffect(() => {
    if (form.getFieldState('lengthCm').error) void form.trigger('lengthCm');
  }, [len, wid, hei, form]);
  useEffect(() => {
    if (form.getFieldState('cargoValue').error) void form.trigger('cargoValue');
  }, [insurance, cargoValue, form]);

  return (
    <div className="grid gap-8">
      {routeLocked ? null : (
        <div className="grid gap-8 lg:grid-cols-2">
          <PlaceFields form={form} prefix="origin" title="Origin" />
          <PlaceFields form={form} prefix="destination" title="Destination" />
        </div>
      )}

      <FormSection title="Cargo" description="Weight is the total actual weight of all packages. Dimensions are per package.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Shipment type" required error={errors.shipmentType?.message}>
            {(p) => (
              <Select {...p} {...register('shipmentType')}>
                {SHIPMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Packages" required error={errors.packageCount?.message}>
            {(p) => <Input {...p} inputMode="numeric" {...register('packageCount')} />}
          </Field>
          <Field label="Total weight (kg)" required error={errors.actualWeightKg?.message}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="e.g. 32.5" {...register('actualWeightKg')} />}
          </Field>
          <div className="hidden lg:block" />
          <Field label="Length (cm)" error={errors.lengthCm?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...register('lengthCm')} />}
          </Field>
          <Field label="Width (cm)" error={errors.widthCm?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...register('widthCm')} />}
          </Field>
          <Field label="Height (cm)" error={errors.heightCm?.message}>
            {(p) => <Input {...p} inputMode="decimal" {...register('heightCm')} />}
          </Field>
        </div>
        <WeightPreview form={form} divisor={divisor} />
      </FormSection>

      <FormSection title="Requirements" description="Offers that can’t meet these are left out of the ranking.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Required delivery by" error={errors.requiredDeliveryDate?.message}>
            {(p) => <Input {...p} type="date" {...register('requiredDeliveryDate')} />}
          </Field>
          <Field label="Service level" hint="Leave on “Any” to compare all levels">
            {(p) => (
              <Select {...p} {...register('servicePreference')}>
                <option value="">Any service level</option>
                {SERVICE_LEVELS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Quote currency" required>
            {(p) => (
              <Select {...p} {...register('currency')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </Field>
          <Field label={`Maximum budget (${currency})`} error={errors.maxBudget?.message} hint="Optional">
            {(p) => <Input {...p} inputMode="decimal" placeholder="No limit" {...register('maxBudget')} />}
          </Field>
          <Field label="Cargo value" error={errors.cargoValue?.message} hint={insurance ? 'Required for insurance' : 'Optional'}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="0.00" {...register('cargoValue')} />}
          </Field>
          <Field label="Cargo value currency">
            {(p) => (
              <Select {...p} {...register('cargoCurrency')}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </Field>
          <div className="flex items-end pb-2 sm:col-span-2">
            <Checkbox label="Insure this shipment" {...register('insuranceRequired')} />
          </div>
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium">Special handling</div>
          <div className="flex flex-wrap gap-2">
            {SPECIAL_HANDLING.map((h) => {
              const checked = handling.includes(h.value);
              return (
                <label key={h.value} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${checked ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-line-strong'}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() =>
                      setValue('specialHandling', checked ? handling.filter((x) => x !== h.value) : [...handling, h.value], { shouldDirty: true })
                    }
                  />
                  {h.label}
                </label>
              );
            })}
          </div>
        </div>
      </FormSection>
    </div>
  );
}

function WeightPreview({ form, divisor }: { form: UseFormReturn<SpecFormValues>; divisor: number }) {
  const [w, n, l, wd, h] = useWatch({ control: form.control, name: ['actualWeightKg', 'packageCount', 'lengthCm', 'widthCm', 'heightCm'] });
  const input = useDebounced({ w, n, l, wd, h }, 350);
  const valid = Number(input.w) > 0 && Number.isInteger(Number(input.n)) && Number(input.n) >= 1;
  const { data } = useBillableWeight(
    {
      actualWeightKg: Number(input.w),
      packageCount: Number(input.n),
      lengthCm: Number(input.l) || undefined,
      widthCm: Number(input.wd) || undefined,
      heightCm: Number(input.h) || undefined,
      divisor,
    },
    valid,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-dashed border-line bg-surface-2 px-4 py-3 text-[13px]">
      <span className="flex items-center gap-2 meta-label">
        <Scale className="h-3.5 w-3.5" /> Billable weight estimate
      </span>
      {valid && data ? (
        <>
          <span>Actual <b className="tabular">{formatWeight(data.actualWeightKg)}</b></span>
          <span>Volumetric <b className="tabular">{data.volumetricWeightKg != null ? formatWeight(data.volumetricWeightKg) : 'n/a (no dimensions)'}</b></span>
          <span className="text-accent">Billable <b className="tabular">{formatWeight(data.billableWeightKg)}</b> ({data.basis.toLowerCase()})</span>
          <span className="text-xs text-subtle">Divisor {divisor} cm³/kg · each carrier applies its own rules</span>
        </>
      ) : (
        <span className="text-muted">Enter weight and package count to estimate.</span>
      )}
    </div>
  );
}

/** Compact route + cargo summary shown beside forms and on result pages. */
export function SpecSummary({ spec, children }: { spec: ShipmentSpec; children?: ReactNode }) {
  return (
    <Panel>
      <PanelHeader title={<span className="flex items-center gap-2">{spec.origin.city} <ArrowRight className="h-3.5 w-3.5 text-accent" /> {spec.destination.city}</span>} />
      <PanelBody className="space-y-1.5 text-[13px] text-muted">
        <div>{countryName(spec.origin.country)} → {countryName(spec.destination.country)}</div>
        <div>
          {spec.packageCount} × {spec.shipmentType.toLowerCase()} · {formatWeight(spec.actualWeightKg)}
          {spec.lengthCm ? ` · ${spec.lengthCm}×${spec.widthCm}×${spec.heightCm} cm` : ''}
        </div>
        {spec.requiredDeliveryDate && <div>Deliver by {toDateInput(spec.requiredDeliveryDate)}</div>}
        {spec.specialHandling.length > 0 && <div>Handling: {spec.specialHandling.map((s) => s.replace(/_/g, ' ').toLowerCase()).join(', ')}</div>}
        {children}
      </PanelBody>
    </Panel>
  );
}
