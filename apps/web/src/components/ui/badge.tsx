import { twMerge } from 'tailwind-merge';
import type { ComponentPropsWithoutRef } from 'react';

interface BadgeProps extends ComponentPropsWithoutRef<'span'> {
  count: number;
}

export function Badge({ count, className, ...props }: BadgeProps) {
  if (count === 0) return null;
  return (
    <span
      data-slot="badge"
      className={twMerge(
        'inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 py-px font-mono text-[10px] font-medium leading-none text-primary-foreground',
        className,
      )}
      {...props}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
