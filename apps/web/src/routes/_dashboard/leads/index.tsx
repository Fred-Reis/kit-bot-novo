import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronRight, Plus, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { twMerge } from 'tailwind-merge';
import { fetchLeads } from '@/lib/queries';
import type { Lead } from '@kit-manager/types';
import { LeadKanbanCard } from '@/components/lead-kanban-card';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Pill } from '@/components/ui/pill';
import { CustomButton } from '@/components/ui/btn';
import { STAGE_LABELS, STAGE_TONE, SOURCE_LABELS, formatPhone } from '@/lib/leads';

export const Route = createFileRoute('/_dashboard/leads/')({ component: LeadsPage });

type View = 'kanban' | 'table';

const dateFormatted = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const KANBAN_COLUMNS = [
  { key: 'novo', label: 'Novo', stages: ['interest'] },
  { key: 'qualificacao', label: 'Qualificação', stages: ['collection', 'review_submitted'] },
  { key: 'visita', label: 'Visita agendada', stages: ['visiting'] },
  { key: 'proposta', label: 'Proposta', stages: ['kyc_pending', 'kyc_approved', 'residents_docs_complete', 'contract_pending', 'contract_signed'] },
  { key: 'ganho', label: 'Ganho', stages: ['converted'] },
] as const;

function KanbanView({ leads }: { leads: Lead[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 overflow-x-auto pb-4 sm:grid-cols-3 lg:grid-cols-5">
      {KANBAN_COLUMNS.map((col) => {
        const cards = leads.filter((l) => (col.stages as readonly string[]).includes(l.stage));
        return (
          <div key={col.key} className="flex min-w-[180px] flex-col gap-2">
            <div className="flex items-center justify-between rounded-t-lg border border-border bg-muted/50 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{cards.length}</span>
            </div>
            <div className="flex flex-col gap-2 rounded-b-lg border border-t-0 border-border bg-muted/20 p-2 min-h-[120px]">
              {cards.map((lead) => (
                <Link key={lead.id} to="/leads/$leadId" params={{ leadId: lead.id }}>
                  <LeadKanbanCard lead={lead} />
                </Link>
              ))}
              {cards.length === 0 && (
                <p className="py-4 text-center text-[11px] text-muted-foreground/50">—</p>
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
        <EmptyState illustration="leads" title="Nenhum lead encontrado" subtitle="Os leads do WhatsApp aparecerão aqui." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Nome</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Origem</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Imóvel</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Etapa</th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Atualizado</th>
              <th className="w-8 px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leads.map((lead) => {
              const cleanPhone = formatPhone(lead.phone);
              return (
              <tr key={lead.id} className="transition-colors hover:bg-muted/50">
                <td className="px-5 py-3.5">
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: lead.id }}
                    className="hover:text-primary"
                  >
                    <p className="text-sm font-medium text-foreground">{lead.name ?? cleanPhone}</p>
                    {lead.name && (
                      <p className="font-mono text-[11px] text-muted-foreground">{cleanPhone}</p>
                    )}
                  </Link>
                </td>
                <td className="px-5 py-3.5 hidden sm:table-cell">
                  {lead.source
                    ? <span className="text-xs text-muted-foreground">{SOURCE_LABELS[lead.source]}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-5 py-3.5 hidden md:table-cell">
                  {lead.propertyExternalId
                    ? <span className="font-mono text-xs text-foreground">{lead.propertyExternalId}</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <Pill tone={STAGE_TONE[lead.stage] ?? 'default'} dot>
                    {STAGE_LABELS[lead.stage] ?? lead.stage}
                  </Pill>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground hidden sm:table-cell">
                  {dateFormatted.format(new Date(lead.updatedAt))}
                </td>
                <td className="px-5 py-3.5">
                  <Link to="/leads/$leadId" params={{ leadId: lead.id }}>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </td>
              </tr>
              );
            })}
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
      <PageHeader
        title="Leads"
        subtitle={`${leads.length} leads registrados`}
        actions={
          <div className="flex items-center gap-2">
            <CustomButton variant="secondary" size="sm" onClick={() => toast.info('Em breve')}>
              <SlidersHorizontal className="size-4" />
              Filtros
            </CustomButton>
            <CustomButton variant="primary" size="sm" onClick={() => toast.info('Em breve')}>
              <Plus className="size-4" />
              Novo lead
            </CustomButton>
          </div>
        }
      />

      <div className="flex justify-end">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView('kanban')}
            aria-label="Visualização kanban"
            className={twMerge(
              'rounded-lg p-1.5 transition-colors',
              view === 'kanban'
                ? 'bg-foreground text-surface'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setView('table')}
            aria-label="Visualização em tabela"
            className={twMerge(
              'rounded-lg p-1.5 transition-colors',
              view === 'table'
                ? 'bg-foreground text-surface'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-48 w-[220px] shrink-0 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <EmptyState
          illustration="leads"
          title="Nenhum lead ainda"
          subtitle="Os leads chegam automaticamente via WhatsApp."
        />
      ) : view === 'kanban' ? (
        <KanbanView leads={leads} />
      ) : (
        <TableView leads={leads} />
      )}
    </div>
  );
}
