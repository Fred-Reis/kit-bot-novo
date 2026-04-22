import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronLeft, Building2, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchProperty } from '@/lib/queries';
import { adminApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { SpecBar } from '@/components/spec-bar';
import { Pill } from '@/components/ui/pill';
import { CustomButton } from '@/components/ui/btn';
import { ConfirmButton } from '@/components/confirm-button';

export const Route = createFileRoute('/_dashboard/properties/$propertyId/')({
  component: PropertyDetailPage,
});

type Tab = 'details' | 'rules' | 'gallery' | 'documents' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Detalhes' },
  { id: 'rules', label: 'Regras' },
  { id: 'gallery', label: 'Galeria' },
  { id: 'documents', label: 'Documentos' },
  { id: 'history', label: 'Histórico' },
];

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
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('details');

  const { data: property, isLoading } = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => fetchProperty(propertyId),
  });

  const invalidate = useMutation({
    mutationFn: () => adminApi.invalidatePropertyCache(propertyId),
    onSuccess: () => {
      toast.success('Cache limpo com sucesso.');
      void qc.invalidateQueries({ queryKey: ['property', propertyId] });
    },
    onError: () => toast.error('Erro ao limpar o cache.'),
  });

  const destroy = useMutation({
    mutationFn: () => adminApi.deleteProperty(propertyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['properties'] });
      toast.success('Imóvel arquivado.');
      navigate({ to: '/properties' });
    },
    onError: () => toast.error('Erro ao arquivar imóvel.'),
  });

  if (isLoading) return <div className="h-96 animate-pulse rounded-[10px] bg-muted" />;
  if (!property) return <p className="text-sm text-muted-foreground">Imóvel não encontrado.</p>;

  const photos = property.media.filter((m) => m.type === 'photo');
  const [hero, ...rest] = photos;

  return (
    <div className="space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Link
          to="/properties"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-semibold text-foreground">{property.name}</h1>
          <p className="text-xs text-muted-foreground">
            {property.neighborhood} · {property.externalId}
          </p>
        </div>
        <Pill tone={property.active ? 'ok' : 'default'} dot>
          {property.active ? 'Disponível' : 'Inativo'}
        </Pill>
        <Link to="/properties/$propertyId/edit" params={{ propertyId }}>
          <CustomButton variant="secondary" size="sm">
            <Pencil className="size-4" />
            Editar
          </CustomButton>
        </Link>
        <CustomButton
          variant="secondary"
          size="sm"
          onClick={() => invalidate.mutate()}
          disabled={invalidate.isPending}
        >
          <RefreshCw className={`size-4 ${invalidate.isPending ? 'animate-spin' : ''}`} />
          {invalidate.isPending ? 'Limpando...' : 'Limpar cache'}
        </CustomButton>
        <ConfirmButton
          label="Excluir"
          confirmLabel={destroy.isPending ? 'Arquivando...' : 'Sim'}
          disabled={destroy.isPending}
          onConfirm={() => destroy.mutate()}
        >
          <Trash2 className="size-4 text-red-500" />
        </ConfirmButton>
      </div>

      {/* Gallery grid */}
      <div className="grid h-72 gap-1.5 overflow-hidden rounded-[10px]"
        style={{ gridTemplateColumns: hero ? '2fr 1fr' : '1fr', gridTemplateRows: 'repeat(2, 1fr)' }}
      >
        {hero ? (
          <img
            src={hero.url}
            alt={property.name}
            className="h-full w-full object-cover"
            style={{ gridRow: '1 / 3' }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted" style={{ gridRow: '1 / 3' }}>
            <Building2 className="size-12 text-muted-foreground/30" />
          </div>
        )}
        {rest.slice(0, 2).map((m, i) => (
          <img key={m.id} src={m.url} alt={m.label ?? `foto ${i + 2}`} className="h-full w-full object-cover" />
        ))}
        {rest.length < 2 && Array.from({ length: 2 - rest.length }).map((_, i) => (
          <div key={i} className="h-full w-full bg-muted" />
        ))}
      </div>

      {/* SpecBar */}
      <SpecBar cells={[
        { label: 'Aluguel', value: formatCurrency(property.rent) },
        { label: 'Área', value: '—' },
        { label: 'Quartos', value: String(property.rooms) },
        { label: 'Banheiros', value: String(property.bathrooms) },
      ]} />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Tabbed main content */}
        <div className="space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  tab === t.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'details' && (
            <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              <div className="divide-y divide-border">
                <InfoRow
                  label="Endereço"
                  value={`${property.address}${property.complement ? `, ${property.complement}` : ''}`}
                />
                <InfoRow
                  label="Depósito"
                  value={`${formatCurrency(property.deposit)} (até ${property.depositInstallmentsMax}x)`}
                />
                <InfoRow
                  label="Contrato"
                  value={property.contractMonths ? `${property.contractMonths} meses` : '—'}
                />
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
                {property.visitSchedule && (
                  <InfoRow label="Visita" value={property.visitSchedule} />
                )}
                {property.listingUrl && (
                  <InfoRow
                    label="Anúncio"
                    value={
                      <a
                        href={property.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Ver anúncio
                      </a>
                    }
                  />
                )}
              </div>
              {property.description && (
                <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
                  {property.description}
                </p>
              )}
            </div>
          )}

          {tab === 'rules' && (
            <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              {property.rulesText ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground leading-relaxed">
                  {property.rulesText}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma regra cadastrada.</p>
              )}
            </div>
          )}

          {tab === 'gallery' && (
            <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
              {property.media.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma mídia cadastrada.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {property.media.map((m) => (
                    <div key={m.id} className="overflow-hidden rounded-lg border border-border">
                      {m.type === 'photo' ? (
                        <img src={m.url} alt={m.label ?? 'foto'} className="h-32 w-full object-cover" />
                      ) : (
                        <div className="flex h-32 items-center justify-center bg-muted text-xs text-muted-foreground">
                          {m.type === 'video' ? 'Vídeo' : 'Listing'}
                        </div>
                      )}
                      {m.label && (
                        <p className="px-2 py-1 text-[11px] text-muted-foreground truncate">{m.label}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(tab === 'documents' || tab === 'history') && (
            <div
              className="flex h-40 items-center justify-center rounded-[10px] bg-surface-raised"
              style={{ boxShadow: 'var(--shadow-sm)' }}
            >
              <p className="text-sm text-muted-foreground">Em construção.</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div
          className="rounded-[10px] bg-surface-raised p-5 self-start"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Inquilino
          </h3>
          <p className="text-sm text-muted-foreground">Sem inquilino.</p>
        </div>
      </div>
    </div>
  );
}
