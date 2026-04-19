import { twMerge } from 'tailwind-merge';
import type { ComponentPropsWithoutRef } from 'react';

interface InputProps extends ComponentPropsWithoutRef<'input'> {
  mono?: boolean;
}

export function Input({ mono, className, ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      className={twMerge(
        'w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50',
        mono && 'font-mono',
        className,
      )}
      {...props}
    />
  );
}
