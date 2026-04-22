import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, LayoutGrid, List, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { fetchProperties } from '@/lib/queries';
import { PropertyCard } from '@/components/property-card';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { CustomButton } from '@/components/ui/btn';
import { twMerge } from 'tailwind-merge';

export const Route = createFileRoute('/_dashboard/properties/')({ component: PropertiesPage });

type Filter = 'all' | 'available' | 'rented' | 'maintenance' | 'reserved';
type View = 'grid' | 'row';

const FILTER_OPTS: { label: string; value: Filter }[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Disponível', value: 'available' },
  { label: 'Alugado', value: 'rented' },
  { label: 'Manutenção', value: 'maintenance' },
  { label: 'Reservado', value: 'reserved' },
];

function PropertiesPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('grid');

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });

  const filtered = properties.filter((p) =>
    filter === 'all' ? true : p.status === filter,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Imóveis"
        subtitle={`${properties.length} imóveis cadastrados`}
        actions={
          <div className="flex items-center gap-2">
            <CustomButton
              variant="secondary"
              size="sm"
              onClick={() => toast.info('Em breve')}
            >
              <SlidersHorizontal className="size-4" />
              Filtros
            </CustomButton>
            <Link to="/properties/new">
              <CustomButton variant="primary" size="sm">
                <Plus className="size-4" />
                Novo imóvel
              </CustomButton>
            </Link>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {FILTER_OPTS.map((opt) => {
            const count = opt.value === 'all'
              ? properties.length
              : properties.filter((p) => p.status === opt.value).length;
            const active = filter === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFilter(opt.value)}
                className={twMerge(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-foreground text-surface'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                {opt.label}
                <span className="font-mono opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView('grid')}
            aria-label="Visualização em grade"
            className={twMerge(
              'rounded-lg p-1.5 transition-colors',
              view === 'grid'
                ? 'bg-foreground text-surface'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setView('row')}
            aria-label="Visualização em lista"
            className={twMerge(
              'rounded-lg p-1.5 transition-colors',
              view === 'row'
                ? 'bg-foreground text-surface'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className={view === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-3'}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-[10px] bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          illustration={filter === 'all' ? 'properties' : 'filter'}
          title={filter === 'all' ? 'Nenhum imóvel cadastrado' : 'Nenhum resultado para este filtro'}
          subtitle={filter === 'all' ? 'Adicione seu primeiro imóvel para começar.' : 'Tente outro filtro.'}
          action={filter === 'all' ? { label: 'Novo imóvel', onClick: () => navigate({ to: '/properties/new' }) } : undefined}
        />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <Link key={p.id} to="/properties/$propertyId" params={{ propertyId: p.id }}>
              <PropertyCard property={p} variant="grid" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <Link key={p.id} to="/properties/$propertyId" params={{ propertyId: p.id }}>
              <PropertyCard property={p} variant="row" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
