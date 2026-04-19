import { tv } from 'tailwind-variants';
import type { ComponentPropsWithoutRef } from 'react';

type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'default';

const pill = tv({
  base: 'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
  variants: {
    tone: {
      ok: 'bg-success/10 text-success',
      warn: 'bg-warning/10 text-warning',
      bad: 'bg-destructive/10 text-destructive',
      accent: 'bg-accent-soft text-accent-ink',
      default: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: { tone: 'default' },
});

interface PillProps extends ComponentPropsWithoutRef<'span'> {
  tone?: Tone;
  dot?: boolean;
}

export function Pill({ tone = 'default', dot, children, className, ...props }: PillProps) {
  return (
    <span data-slot="pill" className={pill({ tone, className })} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
