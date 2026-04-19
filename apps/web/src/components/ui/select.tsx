import { twMerge } from 'tailwind-merge';
import type { ComponentPropsWithoutRef } from 'react';

export function Select({ className, ...props }: ComponentPropsWithoutRef<'select'>) {
  return (
    <select
      data-slot="select"
      className={twMerge(
        'w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
