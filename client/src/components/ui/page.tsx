import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; to?: string }[];
  meta?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumbs && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] text-subtle">
            {breadcrumbs.map((b, i) => (
              <li key={b.label} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                {b.to ? (
                  <Link to={b.to} className="hover:text-fg">
                    {b.label}
                  </Link>
                ) : (
                  <span aria-current="page" className="text-muted">
                    {b.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </div>
    </header>
  );
}

/** A row of key numbers in one bordered strip; the 1px gap over the line color draws the dividers. */
export function StatStrip({ className, children }: { className?: string; children: ReactNode }) {
  // On two-column phones a lone last stat spans the full row instead of leaving an empty cell.
  return <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line shadow-panel max-lg:[&>:last-child:nth-child(odd)]:col-span-2', className)}>{children}</div>;
}

/** One number in a StatStrip; links somewhere when there is a list to drill into. */
export function Stat({ label, value, sub, to }: { label: string; value: ReactNode; sub?: ReactNode; to?: string }) {
  const body = (
    <>
      <div className="meta-label">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight tabular text-fg">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="bg-surface px-5 py-4 transition-colors hover:bg-surface-2">{body}</Link>
  ) : (
    <div className="bg-surface px-5 py-4">{body}</div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
            value === t.value ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors', value === o.value ? 'bg-surface text-fg shadow-panel' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
