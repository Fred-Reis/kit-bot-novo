import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { fetchLeads } from '@/lib/queries';
import type { Lead } from '@kit-manager/types';
import { LeadKanbanCard } from '@/components/lead-kanban-card';
import { PageHeader } from '@/components/page-header';
import { Pill } from '@/components/ui/pill';
import { Segmented } from '@/components/ui/segmented';
import { STAGES, STAGE_LABELS, STAGE_TONE } from '@/lib/leads';

export const Route = createFileRoute('/_dashboard/leads/')({ component: LeadsPage });

type View = 'kanban' | 'table';

const VIEW_OPTS = [
  { label: 'Kanban', value: 'kanban' as View },
  { label: 'Tabela', value: 'table' as View },
];

function KanbanView({ leads }: { leads: Lead[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {STAGES.map((col) => {
        const cards = leads.filter((l) => l.stage === col.key);
        return (
          <div key={col.key} className="flex w-[220px] shrink-0 flex-col gap-2">
            <div className="flex items-center justify-between rounded-t-lg bg-muted/50 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex flex-col gap-2 overflow-y-auto rounded-b-lg bg-muted/20 p-2 min-h-[120px]">
              {cards.map((lead) => (
                <Link key={lead.id} to="/leads/$leadId" params={{ leadId: lead.id }}>
                  <LeadKanbanCard lead={lead} />
                </Link>
              ))}
              {cards.length === 0 && (
                <p className="py-4 text-center text-[11px] text-muted-foreground/50">Vazio</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ leads }: { leads: Lead[] }) {
  return (
    <div
      className="overflow-hidden rounded-[10px] bg-surface-raised"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {leads.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Nenhum lead encontrado.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                Telefone
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                Etapa
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                Atualizado
              </th>
              <th className="w-8 px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leads.map((lead) => (
              <tr key={lead.id} className="transition-colors hover:bg-muted/50">
                <td className="px-5 py-3.5">
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: lead.id }}
                    className="font-mono text-sm font-medium text-foreground hover:text-primary"
                  >
                    {lead.phone}
                  </Link>
                </td>
                <td className="px-5 py-3.5">
                  <Pill tone={STAGE_TONE[lead.stage] ?? 'default'} dot>
                    {STAGE_LABELS[lead.stage] ?? lead.stage}
                  </Pill>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground hidden sm:table-cell">
                  {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
                    new Date(lead.updatedAt),
                  )}
                </td>
                <td className="px-5 py-3.5">
                  <Link to="/leads/$leadId" params={{ leadId: lead.id }}>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LeadsPage() {
  const [view, setView] = useState<View>('kanban');
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeader title="Leads" subtitle={`${leads.length} leads registrados`} />
        <Segmented options={VIEW_OPTS} value={view} onChange={setView} />
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-48 w-[220px] shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : view === 'kanban' ? (
        <KanbanView leads={leads} />
      ) : (
        <TableView leads={leads} />
      )}
    </div>
  );
}
