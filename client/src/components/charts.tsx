import type { ReactNode } from 'react';

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

export const axisProps = {
  stroke: 'var(--fg-subtle)',
  tick: { fill: 'var(--fg-subtle)', fontSize: 11, fontFamily: 'var(--font-mono)' },
  tickLine: false,
  axisLine: { stroke: 'var(--line)' },
} as const;

export const gridProps = { stroke: 'var(--chart-grid)', strokeDasharray: '3 3', vertical: false } as const;

/** Themed tooltip for Recharts. */
interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: { fill?: string };
}

export function ChartTooltip({
  active,
  payload,
  label,
  valueFormat,
  labelFormat,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  valueFormat?: (v: number, name: string) => ReactNode;
  labelFormat?: (l: string) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-float">
      {label !== undefined && <div className="hud-label mb-1">{labelFormat ? labelFormat(String(label)) : String(label)}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color ?? p.payload?.fill }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular text-fg">{valueFormat ? valueFormat(Number(p.value), String(p.name)) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartEmpty({ children, height = 240 }: { children: ReactNode; height?: number }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-line text-center text-sm text-muted" style={{ height }}>
      <div className="max-w-xs px-4">{children}</div>
    </div>
  );
}
