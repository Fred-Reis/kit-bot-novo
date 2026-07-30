import type { ServiceProviderType } from '@kit-manager/types';
import { useState } from 'react';
import { CustomButton } from '@/components/ui/btn';

const TYPE_LABEL: Record<ServiceProviderType, string> = {
  eletrica: 'Elétrica',
  hidraulica: 'Hidráulica',
  civil: 'Civil',
  limpeza_conservacao: 'Limpeza/Conservação',
};

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
}

export function ProviderFormModal({ open, onClose, onSubmit, initialValue }: ProviderFormModalProps) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [phone, setPhone] = useState(initialValue?.phone ?? '');
  const [type, setType] = useState<ServiceProviderType>(initialValue?.type ?? 'eletrica');

  if (!open) return null;

  return (
    <div data-slot="provider-form-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">
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
              {Object.entries(TYPE_LABEL).map(([value, label]) => (
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
          <CustomButton onClick={() => onSubmit({ name, phone, type })}>Salvar</CustomButton>
        </div>
      </div>
    </div>
  );
}
