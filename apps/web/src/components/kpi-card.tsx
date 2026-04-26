import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, Line } from 'recharts';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  delta?: number;
  subtext?: string;
  sparkData?: number[];
  up?: boolean;
  className?: string;
}

function MiniSpark({ data, up }: { data: number[]; up: boolean }) {
  const chartData = data.map((v) => ({ v }));
  return (
    <LineChart data={chartData} width={80} height={32}>
      <Line
        type="monotone"
        dataKey="v"
        stroke={up ? 'var(--color-success)' : 'var(--color-destructive)'}
        strokeWidth={1.5}
        dot={false}
        isAnimationActive={false}
      />
    </LineChart>
  );
}

export function KpiCard({ label, value, delta, subtext, sparkData, up = true, className }: KpiCardProps) {
  return (
    <div
      data-slot="kpi-card"
      className={twMerge(
        'relative overflow-hidden rounded-[10px] bg-surface-raised p-5',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          <span className="font-mono text-2xl font-semibold text-foreground">{value}</span>
          {delta !== undefined && (
            <div className="flex items-center gap-1">
              {delta >= 0 ? (
                <TrendingUp className="size-3 text-success" />
              ) : (
                <TrendingDown className="size-3 text-destructive" />
              )}
              <span className={`font-mono text-xs font-medium ${delta >= 0 ? 'text-success' : 'text-destructive'}`}>
                {delta >= 0 ? '+' : ''}{delta}%
              </span>
            </div>
          )}
          {subtext && (
            <span className="text-[11px] text-muted-foreground">{subtext}</span>
          )}
        </div>
        {sparkData && sparkData.length > 1 && (
          <div className="mt-1 opacity-80">
            <MiniSpark data={sparkData} up={up} />
          </div>
        )}
      </div>
    </div>
  );
}
