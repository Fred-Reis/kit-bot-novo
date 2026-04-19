import { twMerge } from 'tailwind-merge';

interface Cell {
  label: string;
  value: ReactNode;
}

import type { ReactNode } from 'react';

interface SpecBarProps {
  cells: Cell[];
  className?: string;
}

export function SpecBar({ cells, className }: SpecBarProps) {
  return (
    <div
      data-slot="spec-bar"
      className={twMerge(
        'grid divide-x divide-border rounded-[10px] bg-surface-raised',
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-0.5 px-4 py-3">
          <span className="text-xs text-muted-foreground">{cell.label}</span>
          <span className="font-mono text-sm font-medium text-foreground">{cell.value}</span>
        </div>
      ))}
    </div>
  );
}
