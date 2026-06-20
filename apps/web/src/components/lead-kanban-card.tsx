import type { Lead } from '@kit-manager/types';
import { twMerge } from 'tailwind-merge';
import { Pill } from '@/components/ui/pill';
import { formatPhone, SOURCE_LABELS } from '@/lib/leads';
import { relativeTime } from '@/lib/utils';

interface LeadKanbanCardProps {
  lead: Lead;
  className?: string;
}

export function LeadKanbanCard({ lead, className }: LeadKanbanCardProps) {
  const cleanPhone = formatPhone(lead.phone);
  const displayName = lead.name ?? cleanPhone;

  return (
    <div
      data-slot="lead-kanban-card"
      className={twMerge(
        'rounded-lg bg-surface-raised p-3 cursor-pointer hover:ring-1 hover:ring-border transition-shadow',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm font-medium text-foreground leading-tight">{displayName}</p>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70 pt-px">
          {relativeTime(lead.updatedAt)}
        </span>
      </div>

      {cleanPhone !== displayName && (
        <p className="font-mono text-[11px] text-muted-foreground">{cleanPhone}</p>
      )}

      {lead.externalId && (
        <p className="font-mono text-[10px] text-muted-foreground/60">{lead.externalId}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {lead.reactivatedAt && (
          <Pill tone="warn" title={`Reativado em ${new Date(lead.reactivatedAt).toLocaleDateString('pt-BR')}`}>
            Reativado
          </Pill>
        )}
        {lead.source && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {SOURCE_LABELS[lead.source]}
          </span>
        )}
        {lead.propertyExternalId && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-medium text-accent-ink">
            {lead.propertyExternalId}
          </span>
        )}
      </div>
    </div>
  );
}
