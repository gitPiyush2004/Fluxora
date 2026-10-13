import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Panel({ className, hud, children, ...props }: HTMLAttributes<HTMLDivElement> & { hud?: boolean }) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface shadow-panel', hud && 'hud-frame', className)} {...props}>
      {children}
    </div>
  );
}

export function PanelHeader({ title, label, actions, className }: { title?: ReactNode; label?: string; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 border-b border-line px-4 py-3', className)}>
      <div className="min-w-0">
        {label && <div className="hud-label">{label}</div>}
        {title && <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}

/** Key/value list used on detail pages. */
export function DataList({ items, columns = 2 }: { items: { label: string; value: ReactNode; mono?: boolean }[]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="hud-label">{i.label}</dt>
          <dd className={cn('mt-0.5 text-sm break-words text-fg', i.mono && 'font-mono text-[13px]')}>{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
