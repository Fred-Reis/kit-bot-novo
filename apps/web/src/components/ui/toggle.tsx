interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  'aria-label': string;
  className?: string;
}

export function Toggle({ checked, onChange, 'aria-label': label, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      data-slot="toggle"
      data-on={checked ? '' : undefined}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${checked ? 'bg-primary' : 'bg-muted'} ${className ?? ''}`}
    >
      <span
        className={`pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  );
}
