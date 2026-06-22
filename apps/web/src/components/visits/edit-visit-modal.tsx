import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi, apiErrorMessage } from '@/lib/api';
import type { VisitEntry } from '@/lib/queries';
import { visitStatus } from '@/lib/visit-utils';

interface EditVisitModalProps {
  visit: VisitEntry;
  onClose: () => void;
}

const FIELD =
  'w-full rounded border border-border bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

type EditableStatus = 'upcoming' | 'completed' | 'cancelled';

const STATUS_OPTIONS: { value: EditableStatus; label: string }[] = [
  { value: 'upcoming', label: 'Agendada' },
  { value: 'completed', label: 'Concluída' },
  { value: 'cancelled', label: 'Cancelada' },
];

function toLocalInputs(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: '', time: '' };
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return { date: brt.toISOString().slice(0, 10), time: brt.toISOString().slice(11, 16) };
}

function derivedToEditable(status: ReturnType<typeof visitStatus>): EditableStatus {
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}

export function EditVisitModal({ visit, onClose }: EditVisitModalProps) {
  const qc = useQueryClient();
  const initialStatus = derivedToEditable(visitStatus(visit));
  const initial = toLocalInputs(visit.scheduledVisitAt);

  const [selectedStatus, setSelectedStatus] = useState<EditableStatus>(initialStatus);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  const displayName = visit.name ?? visit.phone;
  const propertyLabel = visit.property
    ? `${visit.property.externalId ? visit.property.externalId + ' · ' : ''}${visit.property.address}`
    : null;

  const statusChanged = selectedStatus !== initialStatus;
  const dateChanged = date !== initial.date || time !== initial.time;
  const hasChanges = statusChanged || dateChanged;

  const canSave = hasChanges && (selectedStatus !== 'upcoming' || (!!date && !!time));

  const saveMutation = useMutation({
    mutationFn: async () => {
      const calls: Promise<unknown>[] = [];

      if (statusChanged) {
        calls.push(adminApi.updateVisitStatus(visit.id, selectedStatus));
      }

      if (dateChanged && selectedStatus !== 'cancelled') {
        const scheduledVisitAt = new Date(`${date}T${time}:00-03:00`).toISOString();
        calls.push(adminApi.updateVisitSchedule(visit.id, scheduledVisitAt));
      }

      await Promise.all(calls);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      toast.success('Visita atualizada.');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao atualizar visita.')),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-slot="edit-visit-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface-raised p-6 shadow-lg">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{displayName}</h2>
            {propertyLabel && (
              <p className="truncate text-xs text-muted-foreground">{propertyLabel}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <select
              className={FIELD}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as EditableStatus)}
              disabled={saveMutation.isPending}
            >
              {STATUS_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {selectedStatus !== 'cancelled' && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Data</label>
                <input
                  type="date"
                  className={FIELD}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  disabled={saveMutation.isPending}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Hora</label>
                <input
                  type="time"
                  className={FIELD}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  disabled={saveMutation.isPending}
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saveMutation.isPending}
            className="rounded px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!canSave || saveMutation.isPending}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
