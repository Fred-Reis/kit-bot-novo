import type { ServiceProviderType } from '@kit-manager/types';
import { useEffect, useState } from 'react';
import { CustomButton } from '@/components/ui/btn';
import { SERVICE_TYPE_LABEL } from '@/lib/service-type-labels';

export interface ProviderFormValue {
  name: string;
  phone: string;
  type: ServiceProviderType;
}

interface ProviderFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: ProviderFormValue) => void;
  initialValue?: ProviderFormValue;
  isSubmitting?: boolean;
}

export function ProviderFormModal({
  open,
  onClose,
  onSubmit,
  initialValue,
  isSubmitting = false,
}: ProviderFormModalProps) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [phone, setPhone] = useState(initialValue?.phone ?? '');
  const [type, setType] = useState<ServiceProviderType>(initialValue?.type ?? 'eletrica');

  // The modal is kept mounted (see providers/index.tsx) and only hides via
  // `!open`, so useState's initial value alone never re-runs — switching
  // from editing one provider to another without closing in between would
  // otherwise keep showing the previous provider's data.
  useEffect(() => {
    if (!open) return;
    setName(initialValue?.name ?? '');
    setPhone(initialValue?.phone ?? '');
    setType(initialValue?.type ?? 'eletrica');
  }, [open, initialValue]);

  if (!open) return null;

  const canSubmit = name.trim().length > 0 && phone.trim().length > 0 && !isSubmitting;

  return (
    <div
      data-slot="provider-form-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-form-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-5">
        <h2 id="provider-form-modal-title" className="mb-4 text-sm font-medium text-foreground">
          {initialValue ? 'Editar prestador' : 'Novo prestador'}
        </h2>
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">
            Nome
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Telefone
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Tipo
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              value={type}
              onChange={(e) => setType(e.target.value as ServiceProviderType)}
            >
              {Object.entries(SERVICE_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <CustomButton variant="ghost" onClick={onClose}>
            Cancelar
          </CustomButton>
          <CustomButton
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), phone: phone.trim(), type })}
          >
            Salvar
          </CustomButton>
        </div>
      </div>
    </div>
  );
}
