import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, required, hint, children, className }: FormFieldProps) {
  return (
    <div data-slot="form-field" className={twMerge('flex flex-col gap-1.5', className)}>
      <label className="text-xs font-medium text-foreground-subtle">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
