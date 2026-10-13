import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Minimal accessible popover menu: toggled by its trigger, closes on outside click,
 * Escape (focus returns to the trigger) and item selection.
 */
export function Menu({
  trigger,
  children,
  align = 'right',
  label,
  className,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-controls': string; 'aria-haspopup': 'menu' }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        (ref.current?.querySelector('[aria-haspopup]') as HTMLElement | null)?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the first item for keyboard users.
    requestAnimationFrame(() => (ref.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus());
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-controls': id, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute z-50 mt-2 min-w-[220px] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-float',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onSelect, icon, children, danger }: { onSelect: () => void; icon?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-3 focus:bg-surface-3 focus:outline-none', danger ? 'text-danger' : 'text-fg')}
    >
      {icon && <span className="text-subtle">{icon}</span>}
      {children}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="hud-label px-3 pt-2 pb-1">{children}</div>;
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" role="separator" />;
}
