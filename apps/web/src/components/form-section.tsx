import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

interface FormSectionProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

export function FormSection({ title, subtitle, children, className }: FormSectionProps) {
  return (
    <div
      data-slot="form-section"
      className={twMerge('rounded-[10px] bg-surface-raised p-6', className)}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="mb-5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
