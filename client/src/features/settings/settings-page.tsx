import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@/lib/mutation';
import { Building2, ExternalLink, KeyRound, LogOut, Monitor, Moon, PlugZap, Shield, Sun, Trash2, UserPlus, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { keys } from '@/lib/query-keys';
import { CURRENCIES } from '@/lib/constants';
import { formatDate, relativeTime } from '@/lib/format';
import type { Member, OrgSettings, Role } from '@/lib/types';
import { useAuth, useSession } from '@/providers/auth';
import { useTheme } from '@/providers/theme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState, InlineNotice, SkeletonRows } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form';
import { PageHeader, SegmentedControl, Tabs } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Table, Td, Th } from '@/components/ui/table';
import { useCarrierIntegrations } from '../shipments/hooks';
import { useMembers } from './hooks';

type Tab = 'organization' | 'recommendations' | 'exceptions' | 'members' | 'integrations' | 'account';

function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name?: string; settings?: Partial<OrgSettings> }) => api.patch('/organizations/current', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.auth.session });
      toast.success('Settings saved');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function ReadOnlyNotice() {
  const { isAdmin } = useAuth();
  return isAdmin ? null : <InlineNotice tone="info" icon={<Shield className="h-4 w-4 text-info" />}>Only organization admins can change these settings.</InlineNotice>;
}

function OrganizationTab() {
  const me = useSession();
  const { isAdmin } = useAuth();
  const save = useSaveSettings();
  const [name, setName] = useState(me.organization.name);
  const [currency, setCurrency] = useState(me.organization.settings.defaultCurrency);
  const nameError = name.trim().length < 2 ? 'At least 2 characters' : undefined;
  return (
    <Panel>
      <PanelHeader label="Organization" title="Profile & defaults" />
      <PanelBody className="space-y-4">
        <ReadOnlyNotice />
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Organization name" error={nameError}>{(p) => <Input {...p} value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Default currency" hint="Pre-selected for new shipments and orders">{(p) => <Select {...p} value={currency} disabled={!isAdmin} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        </div>
        {me.organization.isDemo && <InlineNotice tone="sim">This organization contains seeded demonstration data (fictional suppliers, orders and simulated shipments).</InlineNotice>}
        {isAdmin && <Button loading={save.isPending} disabled={!!nameError} onClick={() => save.mutate({ name: name.trim(), settings: { defaultCurrency: currency } })}>Save</Button>}
      </PanelBody>
    </Panel>
  );
}

function RecommendationsTab() {
  const me = useSession();
  const { isAdmin } = useAuth();
  const save = useSaveSettings();
  const s = me.organization.settings;
  const [w, setW] = useState(s.recommendationWeights);
  const [minSamples, setMinSamples] = useState(String(s.reliabilityMinSamples));
  const [divisor, setDivisor] = useState(String(s.volumetricDivisor));
  const total = w.cost + w.transit + w.reliability;
  const errors = {
    weights: total <= 0 ? 'At least one weight must be above zero' : undefined,
    minSamples: !/^\d+$/.test(minSamples) || Number(minSamples) < 1 || Number(minSamples) > 1000 ? '1–1000' : undefined,
    divisor: !/^\d+$/.test(divisor) || Number(divisor) < 1000 || Number(divisor) > 10000 ? '1000–10000' : undefined,
  };
  return (
    <Panel>
      <PanelHeader label="Carrier comparison" title="Recommendation defaults" />
      <PanelBody className="space-y-5">
        <ReadOnlyNotice />
        <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
          {(['cost', 'transit', 'reliability'] as const).map((k) => (
            <Field key={k} label={`${k === 'transit' ? 'Transit time' : k[0]!.toUpperCase() + k.slice(1)} weight`} hint={total > 0 ? `${Math.round((w[k] / total) * 100)}% of score` : undefined}>
              {(p) => <Input {...p} type="number" min={0} max={100} step={5} disabled={!isAdmin} value={w[k]} onChange={(e) => setW({ ...w, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />}
            </Field>
          ))}
        </div>
        {errors.weights && <p className="text-xs text-danger">{errors.weights}</p>}
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label="Minimum deliveries for reliability" error={errors.minSamples} hint="Below this, a carrier's reliability is “unavailable” and excluded from scoring">
            {(p) => <Input {...p} inputMode="numeric" disabled={!isAdmin} value={minSamples} onChange={(e) => setMinSamples(e.target.value)} />}
          </Field>
          <Field label="Volumetric divisor (cm³/kg)" error={errors.divisor} hint="Used for estimates; 5000 is common for express parcels, 6000 for some air services">
            {(p) => <Input {...p} inputMode="numeric" disabled={!isAdmin} value={divisor} onChange={(e) => setDivisor(e.target.value)} />}
          </Field>
        </div>
        {isAdmin && (
          <Button loading={save.isPending} disabled={Object.values(errors).some(Boolean)} onClick={() => save.mutate({ settings: { recommendationWeights: w, reliabilityMinSamples: Number(minSamples), volumetricDivisor: Number(divisor) } })}>
            Save
          </Button>
        )}
      </PanelBody>
    </Panel>
  );
}

const STUCK_LABELS: Record<string, string> = { BOOKED: 'Booked (awaiting pickup)', PICKED_UP: 'Picked up', IN_TRANSIT: 'In transit', OUT_FOR_DELIVERY: 'Out for delivery', DELAYED: 'Delayed', EXCEPTION: 'Exception' };

function ExceptionsTab() {
  const me = useSession();
  const { isAdmin } = useAuth();
  const save = useSaveSettings();
  const r = me.organization.settings.exceptionRules;
  const [stuck, setStuck] = useState<Record<string, string>>(Object.fromEntries(Object.entries(r.stuckThresholdsHours).map(([k, v]) => [k, String(v)])));
  const [stale, setStale] = useState(String(r.trackingStaleHours));
  const [grace, setGrace] = useState(String(r.overdueGraceHours));
  const invalid = (v: string, min = 1) => !/^\d+$/.test(v) || Number(v) < min || Number(v) > 1440;
  const hasError = Object.values(stuck).some((v) => invalid(v)) || invalid(stale) || invalid(grace, 0);
  return (
    <Panel>
      <PanelHeader label="Exception detection" title="Alert rules" />
      <PanelBody className="space-y-5">
        <ReadOnlyNotice />
        <p className="max-w-3xl text-sm text-muted">Transparent, rule-based checks run on a schedule and whenever tracking events arrive. Duplicate alerts for the same unresolved condition are never created.</p>
        <div>
          <div className="mb-2 text-[13px] font-medium">Stuck in status — alert after (hours)</div>
          <div className="grid max-w-4xl gap-4 sm:grid-cols-3">
            {Object.keys(STUCK_LABELS).map((k) => (
              <Field key={k} label={STUCK_LABELS[k]!} error={invalid(stuck[k] ?? '') ? '1–1440' : undefined}>
                {(p) => <Input {...p} inputMode="numeric" disabled={!isAdmin} value={stuck[k] ?? ''} onChange={(e) => setStuck({ ...stuck, [k]: e.target.value })} />}
              </Field>
            ))}
          </div>
        </div>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label="Missing tracking updates — alert after (hours)" error={invalid(stale) ? '1–1440' : undefined}>{(p) => <Input {...p} inputMode="numeric" disabled={!isAdmin} value={stale} onChange={(e) => setStale(e.target.value)} />}</Field>
          <Field label="Grace after expected delivery date (hours)" error={invalid(grace, 0) ? '0–1440' : undefined}>{(p) => <Input {...p} inputMode="numeric" disabled={!isAdmin} value={grace} onChange={(e) => setGrace(e.target.value)} />}</Field>
        </div>
        {isAdmin && (
          <Button
            loading={save.isPending}
            disabled={hasError}
            onClick={() =>
              save.mutate({
                settings: {
                  exceptionRules: { stuckThresholdsHours: Object.fromEntries(Object.entries(stuck).map(([k, v]) => [k, Number(v)])), trackingStaleHours: Number(stale), overdueGraceHours: Number(grace) },
                },
              })
            }
          >
            Save rules
          </Button>
        )}
      </PanelBody>
    </Panel>
  );
}

function MembersTab() {
  const me = useSession();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const q = useMembers();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('MEMBER');
  const [removing, setRemoving] = useState<Member | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: keys.members });
  const invite = useMutation({
    mutationFn: async () => api.post<{ status: string }>('/organizations/current/invites', { email, role }),
    onSuccess: (r) => { refresh(); setEmail(''); toast.success(r.data.status === 'ACCEPTED' ? 'Existing user added to the organization' : 'Invite created — they join at their first Google sign-in'); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const changeRole = useMutation({ mutationFn: async (v: { userId: string; role: Role }) => api.patch(`/organizations/current/members/${v.userId}`, { role: v.role }), onSuccess: () => { refresh(); toast.success('Role updated'); }, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: async (userId: string) => api.del(`/organizations/current/members/${userId}`), onSuccess: () => { refresh(); setRemoving(null); toast.success('Member removed'); }, onError: (e) => toast.error(errorMessage(e)) });
  const revoke = useMutation({ mutationFn: async (id: string) => api.del(`/organizations/current/invites/${id}`), onSuccess: () => { refresh(); toast.success('Invite revoked'); }, onError: (e) => toast.error(errorMessage(e)) });
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <Panel>
          <PanelHeader label="Invite" title="Add a teammate" />
          <PanelBody className="flex flex-wrap items-end gap-3">
            <Field label="Google account email" className="min-w-[260px] flex-1">{(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />}</Field>
            <Field label="Role">{(p) => <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select>}</Field>
            <Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!emailValid} icon={<UserPlus className="h-4 w-4" />}>Invite</Button>
          </PanelBody>
        </Panel>
      )}
      <Panel>
        <PanelHeader label="Access" title="Members" actions={<Users className="h-4 w-4 text-subtle" />} />
        {q.isLoading ? <SkeletonRows rows={3} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Role</Th><Th>Joined</Th><Th>Last sign-in</Th>{isAdmin && <Th className="text-right">Actions</Th>}</tr></thead>
            <tbody>
              {q.data!.members.map((m) => (
                <tr key={m.userId}>
                  <Td><div className="font-medium">{m.name}{m.userId === me.user.id && <span className="ml-2 text-xs text-subtle">(you)</span>}</div><div className="text-xs text-muted">{m.email}</div></Td>
                  <Td>
                    {isAdmin && m.userId !== me.user.id ? (
                      <Select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value as Role })} className="h-8 w-auto"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select>
                    ) : <Badge tone={m.role === 'ADMIN' ? 'accent' : 'neutral'}>{m.role === 'ADMIN' ? 'Admin' : 'Member'}</Badge>}
                  </Td>
                  <Td className="text-[13px]">{formatDate(m.joinedAt)}</Td>
                  <Td className="text-[13px]">{m.lastLoginAt ? relativeTime(m.lastLoginAt) : '—'}</Td>
                  {isAdmin && <Td className="text-right">{m.userId !== me.user.id && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(m)} icon={<Trash2 className="h-3.5 w-3.5" />}>Remove</Button>}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {q.data && q.data.invites.length > 0 && (
          <div className="border-t border-line p-4">
            <div className="hud-label mb-2">Pending invites</div>
            <ul className="space-y-2">
              {q.data.invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 text-[13px]">
                  <span className="font-medium">{i.email}</span><Badge>{i.role.toLowerCase()}</Badge><span className="text-subtle">{relativeTime(i.createdAt)}</span>
                  {isAdmin && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => revoke.mutate(i.id)}>Revoke</Button>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
      <ConfirmDialog open={!!removing} title={`Remove ${removing?.name}?`} description="They lose access to this organization immediately. Their past activity stays in the audit history." confirmLabel="Remove member" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.userId)} onClose={() => setRemoving(null)} />
    </div>
  );
}

function modeTone(mode: string) {
  return mode === 'LIVE' ? 'success' : mode === 'SANDBOX' ? 'info' : mode === 'SIMULATED' ? 'sim' : 'neutral';
}

function IntegrationsTab() {
  const q = useCarrierIntegrations();
  if (q.isLoading) return <Panel><SkeletonRows rows={5} /></Panel>;
  if (q.isError) return <Panel><ErrorState error={q.error} onRetry={() => q.refetch()} /></Panel>;
  return (
    <div className="space-y-4">
      <InlineNotice tone="info" icon={<KeyRound className="h-4 w-4 text-info" />}>
        Carrier credentials are configured on the server (environment variables) and never sent to the browser. Capabilities without a verified integration fall back to the clearly-labelled simulator.
      </InlineNotice>
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data!.map((c) => (
          <Panel key={c.code}>
            <PanelHeader label={c.code} title={c.name} actions={<a href={c.portal} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline">Developer portal <ExternalLink className="h-3 w-3" /></a>} />
            <PanelBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(['quotes', 'booking', 'tracking', 'cancellation'] as const).map((k) => (
                  <span key={k} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[12px]">
                    <span className="capitalize text-muted">{k}</span>
                    <Badge tone={modeTone(c[k]) as 'success'}>{c[k].toLowerCase()}</Badge>
                  </span>
                ))}
              </div>
              <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              {c.requirements.length > 0 && (
                <div className="rounded-lg bg-surface-2 p-3 text-[13px]">
                  <div className="hud-label mb-1">Access requirements</div>
                  <ul className="list-disc pl-4 text-muted">{c.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              )}
            </PanelBody>
          </Panel>
        ))}
      </div>
    </div>
  );
}

function AccountTab() {
  const me = useSession();
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader label="Appearance" title="Theme" />
        <PanelBody>
          <SegmentedControl label="Theme" value={preference} onChange={setPreference} options={[
            { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" />Light</span> },
            { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" />Dark</span> },
            { value: 'system', label: <span className="flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" />System</span> },
          ]} />
          <p className="mt-2 text-xs text-subtle">Stored in this browser only.</p>
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader label="Session" title={me.user.name} />
        <PanelBody className="space-y-3 text-[13px]">
          <div className="text-muted">{me.user.email} · {me.role === 'ADMIN' ? 'Organization admin' : 'Member'} of {me.organization.name}</div>
          <Button variant="outline" icon={<LogOut className="h-4 w-4" />} onClick={async () => { await signOut(); navigate('/login', { replace: true }); toast.success('Signed out'); }}>Sign out</Button>
        </PanelBody>
      </Panel>
    </div>
  );
}

export default function SettingsPage() {
  const me = useSession();
  return <SettingsView key={me.organization.id} />;
}

function SettingsView() {
  const me = useSession();
  const [tab, setTab] = useState<Tab>('organization');
  return (
    <div className="space-y-6">
      <PageHeader label="// Configuration" title="Settings" description={`Manage ${me.organization.name}: defaults, alert rules, members and carrier integrations.`} actions={<Badge tone="accent"><Building2 className="h-3 w-3" />{me.role === 'ADMIN' ? 'Admin' : 'Member'}</Badge>} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'organization', label: 'Organization' },
          { value: 'recommendations', label: 'Recommendations' },
          { value: 'exceptions', label: 'Alert rules' },
          { value: 'members', label: 'Members' },
          { value: 'integrations', label: <span className="flex items-center gap-1.5"><PlugZap className="h-3.5 w-3.5" />Carrier integrations</span> },
          { value: 'account', label: 'Account & theme' },
        ]}
      />
      {tab === 'organization' && <OrganizationTab key={me.organization.id} />}
      {tab === 'recommendations' && <RecommendationsTab key={me.organization.id} />}
      {tab === 'exceptions' && <ExceptionsTab key={me.organization.id} />}
      {tab === 'members' && <MembersTab />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}
