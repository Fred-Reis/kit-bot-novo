import { twMerge } from 'tailwind-merge';
import type { ComponentPropsWithoutRef } from 'react';

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={twMerge(
        'w-full resize-y rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
