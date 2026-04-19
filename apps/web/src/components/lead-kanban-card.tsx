import { twMerge } from 'tailwind-merge';
import type { Lead } from '@kit-manager/types';
import { STAGE_LABELS } from '@/lib/leads';

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m atrás`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  return `${Math.floor(hrs / 24)}d atrás`;
}

interface LeadKanbanCardProps {
  lead: Lead;
  className?: string;
}

export function LeadKanbanCard({ lead, className }: LeadKanbanCardProps) {
  return (
    <div
      data-slot="lead-kanban-card"
      className={twMerge(
        'rounded-lg bg-surface-raised p-3 cursor-pointer hover:ring-1 hover:ring-border transition-shadow',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <p className="font-mono text-sm font-medium text-foreground">{lead.phone}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {STAGE_LABELS[lead.stage] ?? lead.stage}
      </p>
      <p className="mt-2 text-[10px] text-muted-foreground/70">{relativeTime(lead.updatedAt)}</p>
    </div>
  );
}
