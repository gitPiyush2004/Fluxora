import type { ReactNode } from 'react';
import { CircleAlert, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { errorMessage, ApiError } from '@/lib/api';
import { Button } from './button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-sm text-muted', className)}>
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 p-4', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl border border-line bg-surface-2 text-subtle">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-danger-soft text-danger">
        <CircleAlert className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">Couldn’t load this data</h3>
      <p className="mt-1 max-w-md text-sm text-muted">{errorMessage(error)}</p>
      {requestId && <p className="mt-1 font-mono text-[11px] text-subtle">Request ID {requestId}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineNotice({ tone = 'info', icon, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'sim' | 'success'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const styles = {
    info: 'border-info/30 bg-info-soft text-fg',
    warning: 'border-warning/30 bg-warning-soft text-fg',
    danger: 'border-danger/30 bg-danger-soft text-fg',
    sim: 'border-sim/30 bg-sim-soft text-fg',
    success: 'border-success/30 bg-success-soft text-fg',
  }[tone];
  return <div className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', styles, className)}>{icon && <span className="mt-0.5 shrink-0">{icon}</span>}<div className="min-w-0">{children}</div></div>;
}
