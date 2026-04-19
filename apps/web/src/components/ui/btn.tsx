import { tv } from 'tailwind-variants';
import type { ComponentPropsWithoutRef } from 'react';

const customButton = tv({
  base: 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50',
  variants: {
    variant: {
      primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
      secondary: 'bg-muted text-foreground hover:bg-border',
      ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
      icon: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    },
    size: {
      sm: 'h-8 px-3 text-sm',
      md: 'h-9 px-4 text-sm',
    },
  },
  compoundVariants: [
    { variant: 'icon', size: 'sm', class: 'size-8 p-0' },
    { variant: 'icon', size: 'md', class: 'size-9 p-0' },
  ],
  defaultVariants: { variant: 'secondary', size: 'md' },
});

interface CustomButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  size?: 'sm' | 'md';
}

export function CustomButton({ variant, size, className, ...props }: CustomButtonProps) {
  return (
    <button
      data-slot="btn"
      type="button"
      className={customButton({ variant, size, className })}
      {...props}
    />
  );
}
