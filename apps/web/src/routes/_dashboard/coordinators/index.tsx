import type {
  CoordinatorResponsibility,
  LinkedPropertyWithResponsibilities,
} from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash2, Users, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { adminApi } from '@/lib/api';
import { fetchCoordinator, fetchCoordinators, fetchProperties } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/coordinators/')({ component: CoordinatorsPage });

const RESPONSIBILITIES: { value: CoordinatorResponsibility; label: string }[] = [
  { value: 'show_property', label: 'Mostrar imóvel' },
  { value: 'deliver_keys', label: 'Entregar chave' },
  { value: 'receive_keys', label: 'Receber chave' },
  { value: 'inspection', label: 'Vistoria' },
];

function ResponsibilityCheckboxes({
  selected,
  onChange,
}: {
  selected: CoordinatorResponsibility[];
  onChange: (next: CoordinatorResponsibility[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {RESPONSIBILITIES.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1.5 text-xs text-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={selected.includes(opt.value)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, opt.value]
                  : selected.filter((v) => v !== opt.value),
              )
            }
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function UnlinkPropertyButton({
  coordinatorId,
  propertyId,
  externalId,
}: {
  coordinatorId: string;
  propertyId: string;
  externalId: string;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.unlinkCoordinatorProperty(coordinatorId, propertyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] });
      toast.success('Imóvel desvinculado');
    },
    onError: () => toast.error('Falha ao desvincular'),
  });
  return (
    <button
      type="button"
      aria-label={`Desvincular ${externalId}`}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive transition-colors"
    >
      <X className="size-2.5" />
    </button>
  );
}

function LinkedPropertyRow({
  coordinatorId,
  link,
}: {
  coordinatorId: string;
  link: LinkedPropertyWithResponsibilities;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (responsibilities: CoordinatorResponsibility[]) =>
      adminApi.updateCoordinatorProperty(coordinatorId, link.propertyId, { responsibilities }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] }),
    onError: () => toast.error('Falha ao salvar responsabilidades'),
  });
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-raised p-3"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-muted-foreground">{link.externalId}</span>
          <UnlinkPropertyButton
            coordinatorId={coordinatorId}
            propertyId={link.propertyId}
            externalId={link.externalId}
          />
        </div>
        <ResponsibilityCheckboxes
          selected={link.responsibilities}
          onChange={(next) => mutation.mutate(next)}
        />
      </div>
    </div>
  );
}

function LinkPropertyForm({
  coordinatorId,
  linkedProperties,
}: {
  coordinatorId: string;
  linkedProperties: { propertyId: string }[];
}) {
  const [selectedId, setSelectedId] = useState('');
  const [responsibilities, setResponsibilities] = useState<CoordinatorResponsibility[]>([]);
  const qc = useQueryClient();
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
    staleTime: 60_000,
    refetchInterval: false,
  });
  const linkedIds = linkedProperties.map((lp) => lp.propertyId);
  const available = properties.filter((p) => !linkedIds.includes(p.id));
  const mutation = useMutation({
    mutationFn: () =>
      adminApi.linkCoordinatorProperty(coordinatorId, { propertyId: selectedId, responsibilities }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] });
      setSelectedId('');
      setResponsibilities([]);
      toast.success('Imóvel vinculado');
    },
    onError: () => toast.error('Falha ao vincular imóvel'),
  });
  const bulkMutation = useMutation({
    mutationFn: () => adminApi.bulkLinkCoordinator(coordinatorId, { responsibilities }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] });
      const count = (res.data as { propertyCount: number }).propertyCount;
      toast.success(
        count > 0 ? `Vinculado a ${count} imóveis` : 'Nenhum imóvel novo para vincular',
      );
    },
    onError: () => toast.error('Falha ao aplicar a todos os imóveis'),
  });

  return (
    <div
      className="space-y-3 rounded-[10px] border border-dashed border-border bg-surface-raised p-3"
      style={{ boxShadow: 'var(--shadow-sm)' }}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Vincular a um imóvel
      </p>
      <ResponsibilityCheckboxes selected={responsibilities} onChange={setResponsibilities} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (selectedId) mutation.mutate();
        }}
        className="flex gap-2"
      >
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">Selecionar imóvel...</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.externalId} — {p.name}
            </option>
          ))}
        </select>
        <CustomButton
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!selectedId || responsibilities.length === 0 || mutation.isPending}
        >
          <Plus className="size-3" />
          Vincular
        </CustomButton>
      </form>
      <CustomButton
        type="button"
        variant="secondary"
        size="sm"
        disabled={responsibilities.length === 0 || bulkMutation.isPending}
        onClick={() => bulkMutation.mutate()}
      >
        Aplicar a todos os imóveis
      </CustomButton>
    </div>
  );
}

function AddCoordinatorForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.createCoordinator({ name: name.trim(), phone: phone.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinators'] });
      setName('');
      setPhone('');
      toast.success('Responsável cadastrado');
    },
    onError: () => toast.error('Falha ao cadastrar responsável'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && phone.trim()) mutation.mutate();
      }}
      className="flex flex-col gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome..."
        name="responsavel-1"
        autoComplete="new-password"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="WhatsApp (11999990000)"
        name="responsavel-2"
        autoComplete="new-password"
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <CustomButton
        type="submit"
        variant="secondary"
        size="sm"
        className="w-full justify-center"
        disabled={!name.trim() || !phone.trim() || mutation.isPending}
      >
        <Plus className="size-3.5" />
        Adicionar
      </CustomButton>
    </form>
  );
}

function CoordinatorsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: coordinators = [] } = useQuery({
    queryKey: ['coordinators'],
    queryFn: fetchCoordinators,
  });

  const activeId = selectedId ?? coordinators[0]?.id ?? null;

  const { data: detail } = useQuery({
    queryKey: ['coordinator', activeId],
    queryFn: () => fetchCoordinator(activeId!),
    enabled: !!activeId,
  });

  const qc = useQueryClient();

  const deleteCoordinator = useMutation({
    mutationFn: (id: string) => adminApi.deleteCoordinator(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinators'] });
      setSelectedId(null);
      toast.success('Responsável removido');
    },
    onError: () => toast.error('Não é possível remover — desvincule dos imóveis primeiro'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Responsáveis"
        subtitle="Quem mostra os imóveis, entrega/recebe chaves e faz vistoria"
      />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <AddCoordinatorForm />
          <div className="space-y-1.5">
            {coordinators.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    c.id === activeId
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Users className="size-3.5 shrink-0" />
                    {c.name}
                    <span className="ml-auto opacity-60">{c._count.properties}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${c.name}`}
                  disabled={deleteCoordinator.isPending}
                  onClick={() => deleteCoordinator.mutate(c.id)}
                  className="rounded-full p-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            {coordinators.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum responsável cadastrado.</p>
            )}
          </div>
        </div>

        {detail && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{detail.name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{detail.phone}</p>
            </div>
            <div className="space-y-2">
              {detail.linkedProperties.map((link) => (
                <LinkedPropertyRow key={link.propertyId} coordinatorId={detail.id} link={link} />
              ))}
              {detail.linkedProperties.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum imóvel vinculado ainda.</p>
              )}
              <LinkPropertyForm
                coordinatorId={detail.id}
                linkedProperties={detail.linkedProperties}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
