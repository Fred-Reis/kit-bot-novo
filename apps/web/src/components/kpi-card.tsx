import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Spark } from './spark';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  delta?: number;
  subtext?: string;
  seed: number;
  up?: boolean;
  className?: string;
}

export function KpiCard({ label, value, delta, subtext, seed, up = true, className }: KpiCardProps) {
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
              <span
                className={`font-mono text-xs font-medium ${delta >= 0 ? 'text-success' : 'text-destructive'}`}
              >
                {delta >= 0 ? '+' : ''}
                {delta}%
              </span>
            </div>
          )}
          {subtext && (
            <span className="text-[11px] text-muted-foreground">{subtext}</span>
          )}
        </div>
        <Spark seed={seed} up={up} className="mt-1 opacity-80" />
      </div>
    </div>
  );
}
