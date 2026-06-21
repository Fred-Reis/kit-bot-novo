import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { twMerge } from 'tailwind-merge';
import { adminApi, apiErrorMessage } from '@/lib/api';
import type { VisitEntry } from '@/lib/queries';

interface VisitCardProps {
  visit: VisitEntry;
  onCompleted: (leadId: string) => void;
  className?: string;
}

function formatVisitTime(iso: string | null): string {
  if (!iso) return 'Hora a confirmar';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Hora a confirmar';
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

export function VisitCard({ visit, onCompleted, className }: VisitCardProps) {
  const [loading, setLoading] = useState(false);

  const displayName = visit.name ?? visit.phone;
  const time = formatVisitTime(visit.scheduledVisitAt);
  const propertyLabel = visit.property
    ? `${visit.property.externalId ? visit.property.externalId + ' · ' : ''}${visit.property.address}`
    : null;

  async function handleComplete() {
    setLoading(true);
    try {
      await adminApi.completeVisit(visit.id);
      onCompleted(visit.id);
      toast.success('Visita marcada como realizada.');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Erro ao marcar visita.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      data-slot="visit-card"
      className={twMerge(
        'rounded-lg bg-surface-raised p-3 flex items-start justify-between gap-2',
        'ring-1 ring-border/50',
        loading && 'opacity-50 pointer-events-none',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs text-muted-foreground">{time}</p>
        <p className="text-sm font-medium text-foreground leading-tight truncate">{displayName}</p>
        {propertyLabel && (
          <p className="text-xs text-muted-foreground truncate">{propertyLabel}</p>
        )}
      </div>

      <button
        type="button"
        aria-label="Marcar como realizada"
        onClick={handleComplete}
        disabled={loading}
        className="shrink-0 mt-0.5 text-muted-foreground hover:text-success transition-colors disabled:opacity-40"
      >
        <CheckCircle className="size-4" />
      </button>
    </div>
  );
}
