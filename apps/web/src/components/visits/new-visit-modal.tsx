import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { fetchLeads, fetchProperties } from '@/lib/queries';

interface NewVisitModalProps {
  open: boolean;
  onClose: () => void;
}

const FIELD =
  'w-full rounded border border-border bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50';

export function NewVisitModal({ open, onClose }: NewVisitModalProps) {
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');

  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    staleTime: 60_000,
  });

  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
    staleTime: 60_000,
  });

  // fetchLeads already filters archivedAt IS NULL at DB level
  const activeLeads = useMemo(
    () => leads.filter((l) => l.stage !== 'converted'),
    [leads],
  );
  const availableProperties = useMemo(
    () => properties.filter((p) => p.status === 'available'),
    [properties],
  );

  const mutation = useMutation({
    mutationFn: () => {
      // Explicit BRT offset (UTC-3, no DST since 2019)
      const scheduledVisitAt = new Date(`${date}T${time}:00-03:00`).toISOString();
      return adminApi.createVisit({ leadId, propertyId, scheduledVisitAt, note: note || undefined });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['visits'] });
      toast.success('Visita agendada.');
      handleClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao agendar visita.')),
  });

  const canSubmit = !!leadId && !!propertyId && !!date && !!time && !mutation.isPending;

  function handleClose() {
    setLeadId('');
    setPropertyId('');
    setDate('');
    setTime('');
    setNote('');
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-slot="new-visit-modal"
    >
      <div className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-lg">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Nova visita</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Fechar modal"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Lead</label>
            <select className={FIELD} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Selecionar lead</option>
              {activeLeads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name ?? l.phone}
                  {l.externalId ? ` · ${l.externalId}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Imóvel</label>
            <select
              className={FIELD}
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
            >
              <option value="">Selecionar imóvel</option>
              {availableProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.externalId ? `${p.externalId} · ` : ''}
                  {p.address}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Data</label>
              <input
                type="date"
                className={FIELD}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Hora</label>
              <input
                type="time"
                className={FIELD}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Observações (opcional)
            </label>
            <textarea
              className={FIELD}
              rows={2}
              placeholder="Observações sobre a visita"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {mutation.isPending ? 'Agendando…' : 'Agendar visita'}
          </button>
        </div>
      </div>
    </div>
  );
}
