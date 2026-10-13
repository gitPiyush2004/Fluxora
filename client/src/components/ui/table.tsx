import type { ReactNode, ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PageMeta } from '@/lib/api';
import { Button } from './button';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn('border-b border-line bg-surface-2 px-4 py-2.5 text-left align-middle hud-label whitespace-nowrap', className)} {...props}>
      {children}
    </th>
  );
}

export function SortableTh<F extends string>({
  field,
  label,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  field: F;
  label: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: F) => void;
  className?: string;
}) {
  const active = sortBy === field;
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <Th className={className} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 uppercase hover:text-fg">
        {label}
        <Icon className={cn('h-3 w-3', active ? 'text-accent' : 'opacity-50')} aria-hidden />
      </button>
    </Th>
  );
}

export function Td({ className, children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-line px-4 py-3 align-middle', className)} {...props}>
      {children}
    </td>
  );
}

export function Pagination({ meta, onPage }: { meta?: PageMeta; onPage: (page: number) => void }) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <nav className="flex items-center justify-between gap-3 px-4 py-3 text-[13px] text-muted" aria-label="Pagination">
      <span className="tabular">
        {from}–{to} of {meta.total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => onPage(meta.page - 1)} disabled={meta.page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular">
          Page {meta.page} / {meta.totalPages}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onPage(meta.page + 1)} disabled={meta.page >= meta.totalPages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
