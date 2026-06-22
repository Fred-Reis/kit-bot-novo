import { twMerge } from 'tailwind-merge';
import type { VisitEntry } from '@/lib/queries';
import { visitStatus } from '@/lib/visit-utils';
import type { VisitStatus } from '@/lib/visit-utils';

interface VisitCardProps {
  visit: VisitEntry;
  onEdit: (visit: VisitEntry) => void;
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

const STATUS_BADGE: Record<VisitStatus, { label: string; className: string } | null> = {
  upcoming: null,
  unscheduled: null,
  completed: { label: 'Concluída', className: 'bg-success/10 text-success' },
  cancelled: { label: 'Cancelada', className: 'bg-muted text-muted-foreground' },
  past: { label: 'Não realizada', className: 'bg-warning/10 text-warning' },
};

export function VisitCard({ visit, onEdit, className }: VisitCardProps) {
  const status = visitStatus(visit);
  const badge = STATUS_BADGE[status];
  const isHistorical = status === 'completed' || status === 'cancelled' || status === 'past';

  const displayName = visit.name ?? visit.phone;
  const time = formatVisitTime(visit.scheduledVisitAt);
  const propertyLabel = visit.property
    ? `${visit.property.externalId ? visit.property.externalId + ' · ' : ''}${visit.property.address}`
    : null;

  return (
    <div
      data-slot="visit-card"
      role="button"
      tabIndex={0}
      onClick={() => onEdit(visit)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onEdit(visit);
      }}
      className={twMerge(
        'cursor-pointer rounded-lg bg-surface-raised p-3',
        'ring-1 ring-border/50 hover:ring-border transition-all',
        isHistorical && 'opacity-70',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <p className="font-mono text-xs text-muted-foreground">{time}</p>
        {badge && (
          <span
            className={twMerge('text-xs font-medium px-1.5 py-px rounded-full', badge.className)}
          >
            {badge.label}
          </span>
        )}
      </div>
      <p
        className={twMerge(
          'text-sm font-medium text-foreground leading-tight truncate',
          status === 'cancelled' && 'line-through text-muted-foreground',
        )}
      >
        {displayName}
      </p>
      {propertyLabel && (
        <p className="text-xs text-muted-foreground truncate">{propertyLabel}</p>
      )}
    </div>
  );
}
