import type { Complaint, ComplaintStatus } from '@kit-manager/types';
import type { ComponentProps } from 'react';
import { twMerge } from 'tailwind-merge';
import { Pill } from '@/components/ui/pill';

const STATUS_TONE: Record<ComplaintStatus, 'warn' | 'accent' | 'ok'> = {
  open: 'warn',
  acknowledged: 'accent',
  resolved: 'ok',
};

const STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: 'Aberta',
  acknowledged: 'Reconhecida',
  resolved: 'Resolvida',
};

const NEXT_STATUS: Record<ComplaintStatus, ComplaintStatus | null> = {
  open: 'acknowledged',
  acknowledged: 'resolved',
  resolved: null,
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

interface ComplaintsSectionProps extends Omit<ComponentProps<'div'>, 'children'> {
  complaints: Complaint[];
  isLoading: boolean;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: ComplaintStatus) => void;
}

export function ComplaintsSection({
  complaints,
  isLoading,
  isAdvancing,
  onAdvanceStatus,
  className,
  ...props
}: ComplaintsSectionProps) {
  if (!isLoading && complaints.length === 0) return null;

  return (
    <div
      data-slot="complaints-section"
      data-state={isLoading ? 'loading' : 'ready'}
      className={twMerge('rounded-xl border border-border bg-surface-raised p-5', className)}
      {...props}
    >
      <h2 className="mb-4 text-sm font-medium text-foreground">Chamados & Reclamações</h2>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-2">
          {complaints.map((c) => {
            const next = NEXT_STATUS[c.status];
            return (
              <div key={c.id} className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{c.summary}</p>
                  <Pill tone={STATUS_TONE[c.status]} dot>
                    {STATUS_LABEL[c.status]}
                  </Pill>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{c.content}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {dateFmt.format(new Date(c.createdAt))}
                  </span>
                  {next && (
                    <button
                      type="button"
                      onClick={() => onAdvanceStatus(c.id, next)}
                      disabled={isAdvancing}
                      className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
                    >
                      Marcar como {STATUS_LABEL[next].toLowerCase()}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
