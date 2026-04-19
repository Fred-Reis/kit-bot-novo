import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { fetchProperties } from '@/lib/queries';
import { PropertyCard } from '@/components/property-card';
import { PageHeader } from '@/components/page-header';
import { Segmented } from '@/components/ui/segmented';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/properties/')({ component: PropertiesPage });

type Filter = 'all' | 'available' | 'inactive';
type View = 'grid' | 'row';

const FILTER_OPTS = [
  { label: 'Todos', value: 'all' as Filter },
  { label: 'Disponível', value: 'available' as Filter },
  { label: 'Inativo', value: 'inactive' as Filter },
];

const VIEW_OPTS = [
  { label: 'Grade', value: 'grid' as View },
  { label: 'Lista', value: 'row' as View },
];

function PropertiesPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('grid');

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });

  const filtered = properties.filter((p) => {
    if (filter === 'available') return p.active;
    if (filter === 'inactive') return !p.active;
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Imóveis"
        subtitle={`${properties.length} imóveis cadastrados`}
        actions={
          <Link to="/properties/new">
            <CustomButton variant="primary" size="sm">
              <Plus className="size-4" />
              Novo imóvel
            </CustomButton>
          </Link>
        }
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {FILTER_OPTS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === opt.value
                  ? 'bg-foreground text-surface'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Segmented options={VIEW_OPTS} value={view} onChange={setView} />
      </div>

      {isLoading ? (
        <div className={view === 'grid' ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-3'}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-[10px] bg-muted" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-border bg-surface-raised py-16 text-center">
          <Building2 className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum imóvel encontrado.</p>
        </div>
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
