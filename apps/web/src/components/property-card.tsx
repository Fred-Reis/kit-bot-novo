import { twMerge } from 'tailwind-merge';
import { Building2 } from 'lucide-react';
import type { Property } from '@kit-manager/types';
import { Pill } from './ui/pill';
import { formatCurrency } from '@/lib/utils';

interface PropertyCardProps {
  property: Property;
  variant?: 'grid' | 'row';
  className?: string;
}

function CoverPhoto({ property }: { property: Property }) {
  const photo = property.media.find((m) => m.type === 'photo');
  if (photo) {
    return (
      <img
        src={photo.url}
        alt={property.name}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <Building2 className="size-8 text-muted-foreground/40" />
    </div>
  );
}

export function PropertyCard({ property, variant = 'grid', className }: PropertyCardProps) {
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
        <div className="size-14 shrink-0 overflow-hidden rounded-lg">
          <CoverPhoto property={property} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{property.name}</p>
          <p className="truncate text-xs text-muted-foreground">{property.address}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Pill tone={property.active ? 'ok' : 'default'} dot>
            {property.active ? 'Disponível' : 'Inativo'}
          </Pill>
          <span className="font-mono text-sm font-medium text-foreground">
            {formatCurrency(property.rent)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="property-card"
      data-variant="grid"
      className={twMerge(
        'overflow-hidden rounded-[10px] bg-surface-raised',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="aspect-[4/3] overflow-hidden">
        <CoverPhoto property={property} />
      </div>
      <div className="p-4">
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="line-clamp-1 text-sm font-medium text-foreground">{property.name}</p>
          <Pill tone={property.active ? 'ok' : 'default'} dot>
            {property.active ? 'Disponível' : 'Inativo'}
          </Pill>
        </div>
        <p className="mb-3 truncate text-xs text-muted-foreground">{property.address}</p>
        <span className="font-mono text-base font-semibold text-foreground">
          {formatCurrency(property.rent)}
          <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">/mês</span>
        </span>
      </div>
    </div>
  );
}
