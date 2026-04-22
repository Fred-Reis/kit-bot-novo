import { useState } from 'react';
import { CustomButton } from '@/components/ui/btn';

interface ConfirmButtonProps {
  onConfirm: () => void;
  label: string;
  confirmLabel?: string;
  disabled?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel = 'Sim',
  disabled = false,
  className,
  children,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Confirmar?</span>
        <CustomButton
          variant="primary"
          size="sm"
          onClick={() => { setConfirming(false); onConfirm(); }}
          className="bg-[var(--color-destructive)] hover:opacity-90 text-[var(--color-destructive-foreground)]"
        >
          {confirmLabel}
        </CustomButton>
        <CustomButton variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Não
        </CustomButton>
      </div>
    );
  }

  return (
    <CustomButton
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={() => !disabled && setConfirming(true)}
      className={className}
    >
      {children ?? label}
    </CustomButton>
  );
}
