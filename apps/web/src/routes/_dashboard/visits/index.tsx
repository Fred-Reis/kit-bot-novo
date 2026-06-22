import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { EditVisitModal } from '@/components/visits/edit-visit-modal';
import { NewVisitModal } from '@/components/visits/new-visit-modal';
import { VisitCard } from '@/components/visits/visit-card';
import { fetchVisits, type VisitEntry } from '@/lib/queries';
import { visitStatus, type VisitStatus } from '@/lib/visit-utils';

export const Route = createFileRoute('/_dashboard/visits/')({
  component: VisitsPage,
});

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const ALL_STATUSES = new Set<VisitStatus>(['upcoming', 'unscheduled', 'completed', 'cancelled', 'past']);
const DEFAULT_FILTERS = new Set<VisitStatus>(['upcoming', 'unscheduled']);

const FILTER_OPTIONS: { value: VisitStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'upcoming', label: 'Agendadas' },
  { value: 'unscheduled', label: 'Sem horário' },
  { value: 'completed', label: 'Concluídas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'past', label: 'Não realizadas' },
];

function VisitsPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [showNewModal, setShowNewModal] = useState(false);
  const [editingVisit, setEditingVisit] = useState<VisitEntry | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<VisitStatus>>(DEFAULT_FILTERS);

  const { data: visits = [], isLoading, isError } = useQuery({
    queryKey: ['visits'],
    queryFn: fetchVisits,
    refetchInterval: 30_000,
  });

  function toggleFilter(value: VisitStatus | 'all') {
    if (value === 'all') {
      setActiveFilters((prev) => (prev.size === ALL_STATUSES.size ? DEFAULT_FILTERS : new Set(ALL_STATUSES)));
      return;
    }
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
        if (next.size === 0) return DEFAULT_FILTERS;
      } else {
        next.add(value);
      }
      return next;
    });
  }

  const allActive = activeFilters.size === ALL_STATUSES.size;

  const filteredVisits = useMemo(
    () => visits.filter((v) => activeFilters.has(visitStatus(v))),
    [visits, activeFilters],
  );

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const end = addDays(weekStart, 6);
  const weekLabel = `${weekStart.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const visitsByDay = useMemo(() => {
    const map = new Map<string, VisitEntry[]>();
    for (const v of filteredVisits) {
      if (!v.scheduledVisitAt) continue;
      const key = new Date(v.scheduledVisitAt).toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
      });
      const bucket = map.get(key) ?? [];
      bucket.push(v);
      map.set(key, bucket);
    }
    return map;
  }, [filteredVisits]);

  const unscheduled = useMemo(
    () => filteredVisits.filter((v) => !v.scheduledVisitAt),
    [filteredVisits],
  );

  const today = new Date();

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Calendário de Visitas</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label="Semana anterior"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[180px] text-center text-sm text-foreground">{weekLabel}</span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label="Próxima semana"
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Hoje
          </button>
          <button
            type="button"
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="size-3.5" />
            Nova visita
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map(({ value, label }) => {
          const isActive = value === 'all' ? allActive : activeFilters.has(value as VisitStatus);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggleFilter(value)}
              className={twMerge(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/30',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Week grid */}
      {isError ? (
        <p className="text-sm text-destructive">Erro ao carregar visitas.</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((day) => {
            const isToday = isSameDay(day, today);
            const key = day.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            const dayVisits = visitsByDay.get(key) ?? [];
            return (
              <div key={day.toISOString()} className="flex flex-col gap-1.5 min-h-[120px]">
                <div
                  className={twMerge(
                    'pb-1 text-center text-xs font-medium',
                    isToday ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <span>{DAY_NAMES[day.getDay()]}</span>
                  <span
                    className={twMerge(
                      'ml-1 inline-flex size-5 items-center justify-center rounded-full text-xs',
                      isToday && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
                {dayVisits.length === 0 ? (
                  <div className="flex-1 rounded border border-dashed border-border/40" />
                ) : (
                  dayVisits.map((v) => (
                    <VisitCard
                      key={v.id}
                      visit={v}
                      onEdit={setEditingVisit}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sem data agendada
          </h2>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((v) => (
              <VisitCard
                key={v.id}
                visit={v}
                onEdit={setEditingVisit}
                className="w-48"
              />
            ))}
          </div>
        </div>
      )}

      {!isLoading && visits.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma visita agendada.</p>
      )}

      <NewVisitModal open={showNewModal} onClose={() => setShowNewModal(false)} />
      {editingVisit && (
        <EditVisitModal visit={editingVisit} onClose={() => setEditingVisit(null)} />
      )}
    </div>
  );
}
