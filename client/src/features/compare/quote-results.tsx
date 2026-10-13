import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@/lib/mutation';
import { ChevronDown, CircleAlert, CircleCheck, Clock, FlaskConical, Info, RotateCcw, Timer, TriangleAlert, Zap } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate, formatDateTime, formatMoney, formatPercent, formatWeight, relativeTime } from '@/lib/format';
import type { CurrencyGroup, Quote, QuoteResponse, RankedQuote, Weights } from '@/lib/types';
import { Badge, SourceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineNotice } from '@/components/ui/feedback';
import { SegmentedControl } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { useDebounced } from '../shared/hooks';

type Mode = 'BALANCED' | 'CHEAPEST' | 'FASTEST';

const PROVIDER_STATUS: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  OK: { tone: 'success', label: 'OK' },
  EMPTY: { tone: 'neutral', label: 'No offers' },
  TIMEOUT: { tone: 'warning', label: 'Timed out' },
  RATE_LIMITED: { tone: 'warning', label: 'Rate limited' },
  AUTH: { tone: 'danger', label: 'Auth failed' },
  ERROR: { tone: 'danger', label: 'Error' },
  NOT_CONFIGURED: { tone: 'neutral', label: 'Not configured' },
  UNSUPPORTED: { tone: 'neutral', label: 'Unsupported' },
};

function CarrierMonogram({ code }: { code: string }) {
  const label = { DHL: 'DHL', FEDEX: 'FX', UPS: 'UPS', DSV: 'DSV', KUEHNE_NAGEL: 'K+N', CEVA: 'CV' }[code] ?? code.slice(0, 3);
  return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[11px] font-semibold text-fg">{label}</span>;
}

function ScoreBar({ ranked }: { ranked: RankedQuote }) {
  const parts = [
    { key: 'cost', label: 'Cost', short: 'COST', color: 'var(--chart-1)', value: ranked.contributions.cost },
    { key: 'transit', label: 'Speed', short: 'SPEED', color: 'var(--chart-2)', value: ranked.contributions.transit },
    { key: 'reliability', label: 'Reliability', short: 'REL', color: 'var(--chart-3)', value: ranked.contributions.reliability },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="hud-label">Score</span>
        <span className="font-mono text-lg font-semibold tabular">{ranked.score.toFixed(1)}</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`Score ${ranked.score.toFixed(1)} of 100`}>
        {parts.map((p) => (p.value ? <span key={p.key} style={{ width: `${p.value}%`, background: p.color }} title={`${p.label}: ${p.value} pts`} /> : null))}
      </div>
      <div className="mt-1 flex gap-3 font-mono text-[10px] text-subtle">
        {parts.map((p) => (
          <span key={p.key}>
            {p.short} {p.value == null ? 'n/a' : p.value.toFixed(0)}
          </span>
        ))}
      </div>
    </div>
  );
}

function QuoteCard({ quote, ranked, selected, onSelect, selecting, canSelect, selectLabel }: { quote: Quote; ranked: RankedQuote; selected: boolean; onSelect?: () => void; selecting: boolean; canSelect: boolean; selectLabel: string }) {
  const [open, setOpen] = useState(false);
  const best = ranked.badges.includes('BEST_BALANCED');
  return (
    <article className={cn('rounded-xl border bg-surface shadow-panel transition-colors', selected ? 'border-accent ring-2 ring-[var(--ring)]' : best ? 'border-accent/50' : 'border-line')} aria-label={`${quote.carrierName} ${quote.serviceName}`}>
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <CarrierMonogram code={quote.carrierCode} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{quote.carrierName}</span>
              <span className="text-sm text-muted">{quote.serviceName}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ranked.badges.includes('BEST_BALANCED') && <Badge tone="accent"><Zap className="h-3 w-3" /> Best balanced</Badge>}
              {ranked.badges.includes('CHEAPEST') && <Badge tone="success">Cheapest</Badge>}
              {ranked.badges.includes('FASTEST') && <Badge tone="info"><Timer className="h-3 w-3" /> Fastest</Badge>}
              <SourceBadge sourceType={quote.provenance.sourceType} compact />
              {quote.provenance.fromCache && <Badge title={`Retrieved ${formatDateTime(quote.provenance.retrievedAt)}`}>Cached</Badge>}
              {quote.isExpired && <Badge tone="warning">Expired</Badge>}
            </div>
          </div>
        </div>
        <div>
          <div className="hud-label">Total</div>
          <div className="text-xl font-semibold tabular">{formatMoney(quote.totalMinor, quote.currency)}</div>
          <div className="text-xs text-subtle">{quote.serviceLevel.toLowerCase()} · {quote.currency}</div>
        </div>
        <div>
          <div className="hud-label">Est. delivery</div>
          <div className="text-sm font-medium">{formatDate(quote.estimatedDeliveryDate)}</div>
          <div className="text-xs text-subtle">{quote.transitDays != null ? `${quote.transitDays} business days` : 'Transit not provided'}</div>
        </div>
        <div className="flex flex-col gap-3 md:w-[190px]">
          <ScoreBar ranked={ranked} />
          {onSelect && (
            <Button size="sm" variant={selected ? 'secondary' : best ? 'primary' : 'outline'} disabled={!canSelect || selected || quote.isExpired} loading={selecting} onClick={onSelect}>
              {selected ? <><CircleCheck className="h-4 w-4" /> Selected</> : selectLabel}
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <ul className="grid gap-1 text-[13px] text-muted sm:grid-cols-2">
          {ranked.explanation.map((e) => (
            <li key={e} className="flex gap-2"><span className="text-accent">›</span>{e}</li>
          ))}
          {ranked.tradeoffs.map((t) => (
            <li key={t} className="flex gap-2"><span className="text-warning">⇄</span>{t}</li>
          ))}
        </ul>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} /> Price breakdown, provenance & limitations
        </button>
        {open && (
          <div className="mt-3 grid gap-4 rounded-lg bg-surface-2 p-3 text-[13px] md:grid-cols-3">
            <div>
              <div className="hud-label mb-1">Charges</div>
              {quote.breakdown.length ? (
                <ul className="space-y-0.5">
                  {quote.breakdown.map((b) => (
                    <li key={b.label} className="flex justify-between gap-2"><span className="text-muted">{b.label}</span><span className="tabular">{formatMoney(b.amountMinor, quote.currency)}</span></li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted">Not itemised by the source.</span>
              )}
              {quote.billableWeightKg != null && <div className="mt-2 text-xs text-subtle">Billable weight {formatWeight(quote.billableWeightKg)}</div>}
            </div>
            <div>
              <div className="hud-label mb-1">Provenance</div>
              <dl className="space-y-0.5 text-muted">
                <div>Source: <span className="text-fg">{quote.provenance.sourceType}</span></div>
                <div>Provider: <span className="font-mono text-[12px] text-fg">{quote.provenance.provider}</span></div>
                <div>Retrieved: <span className="text-fg">{formatDateTime(quote.provenance.retrievedAt, true)}</span></div>
                <div>Valid until: <span className="text-fg">{quote.provenance.validUntil ? `${formatDateTime(quote.provenance.validUntil)} (${relativeTime(quote.provenance.validUntil)})` : 'Not supplied'}</span></div>
                <div>
                  Reliability:{' '}
                  <span className="text-fg">
                    {quote.reliability?.onTimeRate != null
                      ? `${formatPercent(quote.reliability.onTimeRate)} on time (n=${quote.reliability.sampleSize})`
                      : `unavailable (n=${quote.reliability?.sampleSize ?? 0}, min ${quote.reliability?.minSamples ?? 5})`}
                  </span>
                </div>
              </dl>
            </div>
            <div>
              <div className="hud-label mb-1">Known limitations</div>
              {quote.provenance.limitations.length ? (
                <ul className="list-disc space-y-0.5 pl-4 text-muted">
                  {quote.provenance.limitations.map((l) => <li key={l}>{l}</li>)}
                </ul>
              ) : (
                <span className="text-muted">None reported.</span>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function WeightControls({ weights, defaults, onChange }: { weights: Weights; defaults: Weights; onChange: (w: Weights) => void }) {
  const items: { key: keyof Weights; label: string; color: string }[] = [
    { key: 'cost', label: 'Cost', color: 'var(--chart-1)' },
    { key: 'transit', label: 'Transit time', color: 'var(--chart-2)' },
    { key: 'reliability', label: 'Reliability', color: 'var(--chart-3)' },
  ];
  const total = weights.cost + weights.transit + weights.reliability;
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      {items.map((i) => (
        <label key={i.key} className="block">
          <span className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ background: i.color }} />{i.label}</span>
            <span className="font-mono text-xs tabular text-muted">{weights[i.key]}{total > 0 ? ` · ${Math.round((weights[i.key] / total) * 100)}%` : ''}</span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={weights[i.key]}
            onChange={(e) => onChange({ ...weights, [i.key]: Number(e.target.value) })}
            className="mt-2 w-full accent-[var(--accent)]"
            aria-label={`${i.label} weight`}
          />
        </label>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange(defaults)} icon={<RotateCcw className="h-3.5 w-3.5" />}>
        Defaults
      </Button>
    </div>
  );
}

interface Props {
  data: QuoteResponse;
  defaultWeights: Weights;
  /** Remount (via `key`) for a different quote request. Re-rank endpoint, e.g. /quotes/requests/:id/rank or /shipments/:id/quotes/rank */
  rankPath: string;
  rankBody?: (w: Weights) => object;
  selectedQuoteId?: string;
  onSelect?: (quote: Quote) => void;
  selectingId?: string | null;
  canSelect?: boolean;
  selectLabel?: string;
}

export function QuoteResults({ data: initial, defaultWeights, rankPath, rankBody, selectedQuoteId, onSelect, selectingId, canSelect = true, selectLabel = 'Select offer' }: Props) {
  const [data, setData] = useState(initial);
  const [weights, setWeights] = useState<Weights>(initial.recommendation.weights);
  const [mode, setMode] = useState<Mode>('BALANCED');
  const [groupIdx, setGroupIdx] = useState(0);
  const debounced = useDebounced(weights, 250);

  const rank = useMutation({
    mutationFn: async (w: Weights) => (await api.post<QuoteResponse>(rankPath, rankBody ? rankBody(w) : { weights: w })).data,
    onSuccess: setData,
  });
  const { mutate: rerank } = rank;

  useEffect(() => {
    const cur = data.recommendation.weights;
    if (debounced.cost === cur.cost && debounced.transit === cur.transit && debounced.reliability === cur.reliability) return;
    if (debounced.cost + debounced.transit + debounced.reliability <= 0) return;
    rerank(debounced);
  }, [debounced, data.recommendation.weights, rerank]);

  const groups = data.recommendation.groups;
  const group: CurrencyGroup | undefined = groups[Math.min(groupIdx, groups.length - 1)];
  const quoteById = useMemo(() => new Map(data.quotes.map((q) => [q.id, q])), [data.quotes]);
  const ineligible = data.quotes.filter((q) => !q.eligibility.eligible);
  const failedProviders = data.providers.filter((p) => !['OK', 'EMPTY'].includes(p.status));

  return (
    <div className="space-y-4">
      {data.allSimulated && (
        <InlineNotice tone="sim" icon={<FlaskConical className="h-4 w-4 text-sim" />}>
          <b>All offers below are simulated demonstration data.</b> No carrier credentials are configured, so prices, transit times and limits come from the Fluxora simulator. They are not quotes from the carriers and cannot be honoured by them.
        </InlineNotice>
      )}

      <Panel>
        <PanelHeader label="Providers" title={`Queried ${data.providers.length} carriers · ${data.quotes.length} offers · ${data.quotes.length - ineligible.length} eligible`} actions={<span className="text-xs text-subtle">Requested {relativeTime(data.createdAt)}</span>} />
        <PanelBody className="flex flex-wrap gap-2">
          {data.providers.map((p) => {
            const s = PROVIDER_STATUS[p.status] ?? PROVIDER_STATUS.ERROR!;
            return (
              <div key={p.carrierCode} className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px]" title={p.message}>
                <span className="font-medium">{p.carrierName}</span>
                <Badge tone={s.tone === 'neutral' ? 'neutral' : s.tone}>{s.label}</Badge>
                <span className="font-mono text-[10.5px] text-subtle">{p.mode}{p.fromCache ? ' · CACHE' : ''} · {p.durationMs}ms</span>
              </div>
            );
          })}
        </PanelBody>
        {failedProviders.length > 0 && (
          <div className="px-4 pb-4">
            <InlineNotice tone="warning" icon={<TriangleAlert className="h-4 w-4 text-warning" />}>
              {failedProviders.map((p) => `${p.carrierName}: ${p.message ?? p.status}`).join(' · ')} — other carriers are unaffected.
            </InlineNotice>
          </div>
        )}
      </Panel>

      <Panel hud>
        <PanelHeader
          label="Recommendation weights"
          title="Tune how “best balanced” is scored"
          actions={rank.isPending ? <span className="text-xs text-muted">Re-ranking…</span> : rank.isError ? <span className="text-xs text-danger">{errorMessage(rank.error)}</span> : null}
        />
        <PanelBody className="space-y-3">
          <WeightControls weights={weights} defaults={defaultWeights} onChange={setWeights} />
          {group?.excludedMetrics.map((e) => (
            <InlineNotice key={e.metric} tone="info" icon={<Info className="h-4 w-4 text-info" />}>
              <b className="capitalize">{e.metric}</b> excluded from scoring: {e.reason}. Remaining weights were renormalised — a missing value is never treated as perfect.
            </InlineNotice>
          ))}
          {group && (
            <div className="font-mono text-[11px] text-subtle">
              APPLIED · COST {(group.appliedWeights.cost * 100).toFixed(0)}% · TRANSIT {(group.appliedWeights.transit * 100).toFixed(0)}% · RELIABILITY {(group.appliedWeights.reliability * 100).toFixed(0)}%
            </div>
          )}
        </PanelBody>
      </Panel>

      {data.recommendation.notes.map((n) => (
        <InlineNotice key={n} tone="warning" icon={<CircleAlert className="h-4 w-4 text-warning" />}>{n}</InlineNotice>
      ))}

      {group ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Sort offers by"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'BALANCED', label: 'Best balanced' },
                { value: 'CHEAPEST', label: 'Cheapest' },
                { value: 'FASTEST', label: 'Fastest' },
              ]}
            />
            {groups.length > 1 && (
              <SegmentedControl label="Currency group" value={String(groupIdx)} onChange={(v) => setGroupIdx(Number(v))} options={groups.map((g, i) => ({ value: String(i), label: g.currency }))} />
            )}
          </div>
          <div className="space-y-3">
            {group.order[mode].map((id) => {
              const quote = quoteById.get(id);
              const ranked = group.quotes.find((r) => r.id === id);
              if (!quote || !ranked) return null;
              return (
                <QuoteCard
                  key={id}
                  quote={quote}
                  ranked={ranked}
                  selected={selectedQuoteId === id}
                  onSelect={onSelect ? () => onSelect(quote) : undefined}
                  selecting={selectingId === id}
                  canSelect={canSelect && !selectingId}
                  selectLabel={selectLabel}
                />
              );
            })}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-subtle">
            <Clock className="h-3.5 w-3.5" /> Estimates and badges describe the offers as returned — they are not delivery guarantees.
          </p>
        </>
      ) : (
        <InlineNotice tone="warning" icon={<TriangleAlert className="h-4 w-4 text-warning" />}>
          No offer meets all hard constraints. Review the excluded offers below — relax the deadline, budget, service level or handling requirements and compare again.
        </InlineNotice>
      )}

      {ineligible.length > 0 && (
        <details className="rounded-xl border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            {ineligible.length} offers excluded by hard constraints
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {ineligible.map((q) => (
              <li key={q.id} className="grid gap-2 px-4 py-3 text-[13px] md:grid-cols-[1.4fr_0.6fr_2fr]">
                <span>
                  <b>{q.carrierName}</b> <span className="text-muted">{q.serviceName}</span>
                </span>
                <span className="tabular text-muted">{formatMoney(q.totalMinor, q.currency)}</span>
                <span className="text-muted">{q.eligibility.reasons.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
