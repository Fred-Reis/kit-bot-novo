import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Image, Video, RefreshCw } from 'lucide-react';
import { tv } from 'tailwind-variants';
import type { Property, PropertyMedia } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/properties/$propertyId')({
  component: PropertyDetailPage,
});

const actionBtn = tv({
  base: 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
  variants: {
    variant: {
      primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
      secondary: 'border border-border bg-secondary text-foreground hover:bg-muted',
    },
  },
  defaultVariants: { variant: 'secondary' },
});

async function fetchProperty(id: string): Promise<Property> {
  const res = await fetch(`/api/properties/${id}`);
  return res.json() as Promise<Property>;
}

async function invalidateCache(propertyId: string): Promise<void> {
  const botUrl = import.meta.env.VITE_BOT_API_URL as string;
  await fetch(`${botUrl}/admin/properties/${propertyId}/invalidate-cache`, { method: 'PUT' });
}

function MediaIcon({ type }: { type: PropertyMedia['type'] }) {
  if (type === 'video') return <Video className="size-3.5" />;
  return <Image className="size-3.5" />;
}

function MediaGrid({ media }: { media: PropertyMedia[] }) {
  if (media.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma mídia cadastrada.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {media.map((m) => (
        <div
          key={m.id}
          data-slot="media-card"
          className="overflow-hidden rounded-lg border border-border bg-surface"
        >
          {m.type === 'video' ? (
            <div className="flex h-32 items-center justify-center bg-muted">
              <Video className="size-8 text-muted-foreground/50" />
            </div>
          ) : (
            <img src={m.url} alt={m.label ?? m.type} className="h-32 w-full object-cover" />
          )}
          <div className="flex items-center gap-1.5 p-2">
            <MediaIcon type={m.type} />
            <p className="text-xs font-medium text-muted-foreground capitalize">
              {m.label ?? m.type}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}

function PropertyDetailPage() {
  const { propertyId } = Route.useParams();
  const qc = useQueryClient();

  const { data: property, isLoading } = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => fetchProperty(propertyId),
  });

  const invalidate = useMutation({
    mutationFn: () => invalidateCache(propertyId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['property', propertyId] }),
  });

  const fmt = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

  if (isLoading) return <div className="h-96 animate-pulse rounded-xl bg-muted" />;
  if (!property) return <p className="text-sm text-muted-foreground">Imóvel não encontrado.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/properties" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">{property.name}</h1>
          <p className="text-sm text-muted-foreground">
            {property.neighborhood} · {property.externalId}
          </p>
        </div>
        <button
          type="button"
          onClick={() => invalidate.mutate()}
          disabled={invalidate.isPending}
          className={actionBtn({ variant: 'secondary' })}
        >
          <RefreshCw className={`size-4 ${invalidate.isPending ? 'animate-spin' : ''}`} />
          {invalidate.isPending ? 'Limpando...' : 'Limpar cache'}
        </button>
      </div>

      {/* Details */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-2 text-sm font-medium text-foreground">Dados do imóvel</h2>
        <div className="divide-y divide-border">
          <InfoRow
            label="Endereço"
            value={`${property.address}${property.complement ? `, ${property.complement}` : ''}`}
          />
          <InfoRow label="Aluguel" value={fmt(property.rent)} />
          <InfoRow
            label="Depósito"
            value={`${fmt(property.deposit)} (até ${property.depositInstallmentsMax}x)`}
          />
          <InfoRow
            label="Contrato"
            value={property.contractMonths ? `${property.contractMonths} meses` : '—'}
          />
          <InfoRow label="Quartos" value={property.rooms} />
          <InfoRow label="Banheiros" value={property.bathrooms} />
          <InfoRow label="Máx. adultos" value={property.maxAdults} />
          <InfoRow label="Aceita crianças" value={property.acceptsChildren ? 'Sim' : 'Não'} />
          <InfoRow label="Aceita pets" value={property.acceptsPets ? 'Sim' : 'Não'} />
          <InfoRow label="Inclui água" value={property.includesWater ? 'Sim' : 'Não'} />
          <InfoRow label="Inclui IPTU" value={property.includesIptu ? 'Sim' : 'Não'} />
          <InfoRow label="Luz individual" value={property.individualElectricity ? 'Sim' : 'Não'} />
          <InfoRow
            label="Entrada independente"
            value={property.independentEntrance ? 'Sim' : 'Não'}
          />
          {property.visitSchedule && <InfoRow label="Visita" value={property.visitSchedule} />}
          <InfoRow label="Status" value={property.active ? 'Ativo' : 'Inativo'} />
        </div>
      </div>

      {/* Description */}
      {property.description && (
        <div className="rounded-xl border border-border bg-surface-raised p-5">
          <h2 className="mb-2 text-sm font-medium text-foreground">Descrição</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{property.description}</p>
        </div>
      )}

      {/* Media */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">Mídia</h2>
        <MediaGrid media={property.media} />
      </div>
    </div>
  );
}
