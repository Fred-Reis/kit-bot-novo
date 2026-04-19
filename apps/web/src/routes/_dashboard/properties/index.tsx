import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Wifi, Droplets } from 'lucide-react';
import type { Property } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/properties/')({ component: PropertiesPage });

async function fetchProperties(): Promise<Property[]> {
  const res = await fetch('/api/properties');
  return res.json() as Promise<Property[]>;
}

function PropertyCard({ property }: { property: Property }) {
  return (
    <Link
      to="/properties/$propertyId"
      params={{ propertyId: property.id }}
      data-slot="property-card"
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised transition-colors hover:border-primary/40"
    >
      <div className="flex h-36 items-center justify-center bg-muted">
        {property.media.find((m) => m.type === 'photo') ? (
          <img
            src={property.media.find((m) => m.type === 'photo')!.url}
            alt={property.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <Building2 className="size-10 text-muted-foreground/40" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-foreground group-hover:text-primary">
              {property.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {property.neighborhood} · {property.externalId}
            </p>
          </div>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {property.includesWater && (
            <span className="flex items-center gap-1">
              <Droplets className="size-3" /> Água
            </span>
          )}
          {property.individualElectricity && (
            <span className="flex items-center gap-1">
              <Wifi className="size-3" /> Luz ind.
            </span>
          )}
          {property.acceptsPets && <span>Pets ✓</span>}
        </div>
        <div className="mt-auto flex items-end justify-between">
          <div>
            <p className="text-base font-semibold text-foreground">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                property.rent,
              )}
              <span className="text-xs font-normal text-muted-foreground">/mês</span>
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${property.active ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}
          >
            {property.active ? 'Ativo' : 'Inativo'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function PropertiesPage() {
  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Imóveis</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {properties.length} imóveis cadastrados
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : properties.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-raised py-16 text-center">
          <Building2 className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum imóvel cadastrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => (
            <PropertyCard key={p.id} property={p} />
          ))}
        </div>
      )}
    </div>
  );
}
