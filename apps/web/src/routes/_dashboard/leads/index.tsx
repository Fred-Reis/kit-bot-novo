import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Lead } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRight, LayoutGrid, List, Plus, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';
import { LeadKanbanCard } from '@/components/lead-kanban-card';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { formatPhone, SOURCE_LABELS, STAGE_LABELS, STAGE_TONE } from '@/lib/leads';
import { fetchLeads } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/leads/')({ component: LeadsPage });

type View = 'kanban' | 'table';

const dateFormatted = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const KANBAN_COLUMNS = [
  { key: 'novo', label: 'Novo', stages: ['interest'], droppable: true },
  { key: 'qualificacao', label: 'Qualificação', stages: ['collection', 'review_submitted'], droppable: true },
  { key: 'visita', label: 'Visita agendada', stages: ['visiting'], droppable: true },
  {
    key: 'proposta',
    label: 'Proposta',
    stages: ['kyc_pending', 'kyc_approved', 'residents_docs_complete', 'contract_pending', 'contract_signed'],
    droppable: false,
  },
  { key: 'ganho', label: 'Ganho', stages: ['converted'], droppable: false },
];

const COL_DROP_STAGE = Object.fromEntries(
  KANBAN_COLUMNS.filter((col) => col.droppable).map((col) => [col.key, col.stages[0]]),
);
const DROPPABLE_COLS = new Set(Object.keys(COL_DROP_STAGE));

// ─── Draggable card wrapper ────────────────────────────────────────────────
function DraggableLeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });

  const style = transform
    ? { transform: CSS.Transform.toString(transform) }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-50' : undefined}
    >
      <Link to="/leads/$leadId" params={{ leadId: lead.id }}>
        <LeadKanbanCard lead={lead} />
      </Link>
    </div>
  );
}

// ─── Droppable column wrapper ──────────────────────────────────────────────
function DroppableColumn({
  colKey,
  children,
  className,
}: {
  colKey: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: colKey });
  const isDroppable = DROPPABLE_COLS.has(colKey);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isDroppable && isOver ? 'ring-2 ring-primary/50' : undefined,
      )}
    >
      {children}
    </div>
  );
}

// ─── Kanban view ───────────────────────────────────────────────────────────
function KanbanView({
  leads,
  onDragStart,
  onDragEnd,
  draggingId,
}: {
  leads: Lead[];
  onDragStart: (id: string | null) => void;
  onDragEnd: (event: DragEndEvent) => void;
  draggingId: string | null;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const draggingLead = draggingId ? leads.find((l) => l.id === draggingId) : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => onDragStart(active.id as string)}
      onDragEnd={onDragEnd}
      onDragCancel={() => onDragStart(null)}
    >
      <div className="grid grid-cols-2 gap-3 overflow-x-auto pb-4 sm:grid-cols-3 lg:grid-cols-5">
        {KANBAN_COLUMNS.map((col) => {
          const cards = leads.filter((l) => (col.stages as readonly string[]).includes(l.stage));
          return (
            <div key={col.key} className="flex min-w-[180px] flex-col gap-2">
              <div className="flex items-center justify-between rounded-t-lg border border-border bg-muted/50 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">{col.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{cards.length}</span>
              </div>
              <DroppableColumn
                colKey={col.key}
                className="flex flex-col gap-2 rounded-b-lg border border-t-0 border-border bg-muted/20 p-2 min-h-[120px]"
              >
                {cards.map((lead) => (
                  <DraggableLeadCard key={lead.id} lead={lead} />
                ))}
                {cards.length === 0 && (
                  <p className="py-4 text-center text-[11px] text-muted-foreground/50">—</p>
                )}
              </DroppableColumn>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {draggingLead ? (
          <div className="rotate-1 opacity-90">
            <LeadKanbanCard lead={draggingLead} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TableView({ leads }: { leads: Lead[] }) {
  return (
    <div
      className="overflow-hidden rounded-[10px] bg-surface-raised"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      {leads.length === 0 ? (
        <EmptyState
          illustration="leads"
          title="Nenhum lead encontrado"
          subtitle="Os leads do WhatsApp aparecerão aqui."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                Nome
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                Origem
              </th>
              <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
                Imóvel
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
                      <p className="text-sm font-medium text-foreground">
                        {lead.name ?? cleanPhone}
                      </p>
                      {lead.name && (
                        <p className="font-mono text-[11px] text-muted-foreground">{cleanPhone}</p>
                      )}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    {lead.source ? (
                      <span className="text-xs text-muted-foreground">
                        {SOURCE_LABELS[lead.source]}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    {lead.propertyExternalId ? (
                      <span className="font-mono text-xs text-foreground">
                        {lead.propertyExternalId}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    refetchInterval: 5000,
  });

  const stageMutation = useMutation({
    mutationFn: ({ leadId, stage }: { leadId: string; stage: string }) =>
      adminApi.updateLeadStage(leadId, stage),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao mover lead.')),
  });

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDraggingId(null);
    if (!over) return;
    const colKey = over.id as string;
    if (!DROPPABLE_COLS.has(colKey)) return;
    const leadId = active.id as string;
    const stage = COL_DROP_STAGE[colKey];
    // Skip if already in that stage
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === stage) return;
    stageMutation.mutate({ leadId, stage });
  }

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
            className={cn(
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
            className={cn(
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
        <KanbanView
          leads={leads}
          onDragStart={setDraggingId}
          onDragEnd={handleDragEnd}
          draggingId={draggingId}
        />
      ) : (
        <TableView leads={leads} />
      )}
    </div>
  );
}
