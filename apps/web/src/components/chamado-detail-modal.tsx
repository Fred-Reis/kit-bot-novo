import { MAINTENANCE_RESPONSIBILITIES } from '@kit-manager/types';
import type { Complaint, MaintenanceRequest, MaintenanceResponsibility } from '@kit-manager/types';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CustomButton } from '@/components/ui/btn';
import { RESPONSIBILITY_LABEL } from '@/lib/maintenance-labels';
import { isImageUrl } from '@/lib/media';
import { SERVICE_TYPE_LABEL } from '@/lib/service-type-labels';

export type ChamadoDetailItem =
  | { kind: 'complaint'; data: Complaint }
  | { kind: 'maintenance'; data: MaintenanceRequest };

interface ChamadoDetailModalProps {
  item: ChamadoDetailItem | null;
  onClose: () => void;
  onSaveResponsibility?: (id: string, responsibility: MaintenanceResponsibility) => void;
  isSavingResponsibility?: boolean;
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export function ChamadoDetailModal({
  item,
  onClose,
  onSaveResponsibility,
  isSavingResponsibility = false,
}: ChamadoDetailModalProps) {
  const [responsibility, setResponsibility] = useState<MaintenanceResponsibility>(
    item?.kind === 'maintenance' ? item.data.responsibility : 'unclear',
  );

  // Resync when a different chamado is opened — this modal, like
  // ProviderFormModal, is a good candidate to stay mounted across opens.
  useEffect(() => {
    if (item?.kind === 'maintenance') setResponsibility(item.data.responsibility);
  }, [item]);

  if (!item) return null;

  const { data } = item;

  return (
    <div
      data-slot="chamado-detail-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="chamado-detail-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface-raised p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="chamado-detail-modal-title" className="text-sm font-medium text-foreground">
            {item.kind === 'complaint' ? 'Detalhes da reclamação' : 'Detalhes do chamado'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="text-sm font-medium text-foreground">{data.summary}</p>

        {item.kind === 'complaint' ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.data.content}</p>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              {SERVICE_TYPE_LABEL[item.data.type] ?? item.data.type} · severidade {item.data.severity}
            </p>

            <label className="mt-3 block text-xs text-muted-foreground">
              Responsabilidade
              <div className="mt-1 flex items-center gap-2">
                <select
                  value={responsibility}
                  onChange={(e) => setResponsibility(e.target.value as MaintenanceResponsibility)}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {MAINTENANCE_RESPONSIBILITIES.map((r) => (
                    <option key={r} value={r}>
                      {RESPONSIBILITY_LABEL[r]}
                    </option>
                  ))}
                </select>
                {onSaveResponsibility && responsibility !== item.data.responsibility && (
                  <CustomButton
                    disabled={isSavingResponsibility}
                    onClick={() => onSaveResponsibility(item.data.id, responsibility)}
                  >
                    Salvar
                  </CustomButton>
                )}
              </div>
            </label>

            {item.data.mediaUrls.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {item.data.mediaUrls.map((url, i) =>
                  isImageUrl(url) ? (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img
                        src={url}
                        alt={`Foto ${i + 1} do chamado`}
                        className="aspect-square w-full rounded-md object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex aspect-square items-center justify-center rounded-md border border-border px-2 text-center text-xs font-medium text-accent-ink hover:underline"
                    >
                      Ver arquivo
                    </a>
                  ),
                )}
              </div>
            )}
          </>
        )}

        <p className="mt-4 text-xs text-muted-foreground">{dateFmt.format(new Date(data.createdAt))}</p>
      </div>
    </div>
  );
}
