import { twMerge } from 'tailwind-merge';
import { Building2, BedDouble, Bath, Maximize2 } from 'lucide-react';
import type { Property } from '@kit-manager/types';
import { Pill } from './ui/pill';
import { formatCurrency } from '@/lib/utils';

interface PropertyCardProps {
  property: Property;
  variant?: 'grid' | 'row';
  className?: string;
}

type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'default';

const STATUS_CONFIG: Record<string, { tone: Tone; label: string }> = {
  available: { tone: 'ok', label: 'Disponível' },
  rented: { tone: 'accent', label: 'Alugado' },
  maintenance: { tone: 'warn', label: 'Manutenção' },
  reserved: { tone: 'default', label: 'Reservado' },
};

function statusFor(property: Property) {
  return STATUS_CONFIG[property.status] ?? (property.active
    ? STATUS_CONFIG.available
    : STATUS_CONFIG.maintenance);
}

function CoverPhoto({ property }: { property: Property }) {
  const photo = property.media.find((m) => m.type === 'photo');
  if (photo) {
    return <img src={photo.url} alt={property.name} className="h-full w-full object-cover" />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <Building2 className="size-8 text-muted-foreground/40" />
    </div>
  );
}

export function PropertyCard({ property, variant = 'grid', className }: PropertyCardProps) {
  const { tone, label } = statusFor(property);

  if (variant === 'row') {
    return (
      <div
        data-slot="property-card"
        data-variant="row"
        className={twMerge(
          'flex items-center gap-4 rounded-[10px] bg-surface-raised p-4',
          className,
        )}
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg">
          <CoverPhoto property={property} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{property.name}</p>
          <p className="truncate text-xs text-muted-foreground">{property.address}</p>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <BedDouble className="size-3" />{property.rooms}
            </span>
            <span className="flex items-center gap-1">
              <Bath className="size-3" />{property.bathrooms}
            </span>
            {property.area != null && (
              <span className="flex items-center gap-1">
                <Maximize2 className="size-3" />{property.area}m²
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Pill tone={tone} dot>{label}</Pill>
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatCurrency(property.rent)}
            <span className="ml-0.5 font-sans text-[10px] font-normal text-muted-foreground">/mês</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="property-card"
      data-variant="grid"
      className={twMerge('overflow-hidden rounded-[10px] bg-surface-raised', className)}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <CoverPhoto property={property} />
        <div className="absolute left-2 top-2">
          <Pill tone={tone} dot>{label}</Pill>
        </div>
      </div>
      <div className="p-4">
        <p className="font-mono text-[10px] text-muted-foreground">{property.externalId}</p>
        <p className="mt-0.5 line-clamp-1 text-sm font-semibold text-foreground">{property.name}</p>
        <p className="mb-2 truncate text-xs text-muted-foreground">{property.address}</p>
        <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <BedDouble className="size-3" />{property.rooms}
          </span>
          <span className="flex items-center gap-1">
            <Bath className="size-3" />{property.bathrooms}
          </span>
          {property.area != null && (
            <span className="flex items-center gap-1">
              <Maximize2 className="size-3" />{property.area}m²
            </span>
          )}
        </div>
        <span className="font-mono text-base font-semibold text-foreground">
          {formatCurrency(property.rent)}
          <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">/mês</span>
        </span>
      </div>
    </div>
  );
}
