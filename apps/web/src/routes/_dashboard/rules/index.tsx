import type { RuleSetPolicy } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { Toggle } from '@/components/ui/toggle';
import { adminApi } from '@/lib/api';
import { fetchProperties, fetchRuleSet, fetchRuleSets } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/rules/')({ component: RulesPage });

const POLICY_VALUES = ['yes', 'no', 'conditional'] as const;
const POLICY_LABELS: Record<string, string> = { yes: 'Sim', no: 'Não', conditional: 'Cond.' };

function DeletePolicyButton({ policy, ruleSetId }: { policy: RuleSetPolicy; ruleSetId: string }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.deletePolicy(ruleSetId, policy.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
      qc.invalidateQueries({ queryKey: ['rule-sets'] });
      toast.success('Política removida');
    },
    onError: () => toast.error('Falha ao remover política'),
  });

  return (
    <button
      type="button"
      aria-label="Remover política"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

function PolicyValueGroup({ policy, ruleSetId }: { policy: RuleSetPolicy; ruleSetId: string }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (value: string) => adminApi.updatePolicy(ruleSetId, policy.id, { value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] }),
    onError: () => toast.error('Falha ao salvar política'),
  });

  return (
    <div className="flex gap-0.5 rounded-md border border-border p-0.5">
      {POLICY_VALUES.map((v) => (
        <button
          key={v}
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(v)}
          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
            policy.value === v
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {POLICY_LABELS[v]}
        </button>
      ))}
    </div>
  );
}

function AppliesToToggle({ policy, ruleSetId }: { policy: RuleSetPolicy; ruleSetId: string }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (appliesToProperty: boolean) =>
      adminApi.updatePolicy(ruleSetId, policy.id, { appliesToProperty }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] }),
    onError: () => toast.error('Falha ao salvar política'),
  });

  return (
    <Toggle
      checked={policy.appliesToProperty}
      onChange={(v) => mutation.mutate(v)}
      aria-label="Aplica ao imóvel"
    />
  );
}

function PropagateToggle({
  ruleSetId,
  field,
  value,
  label,
}: {
  ruleSetId: string;
  field: string;
  value: boolean;
  label: string;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (checked: boolean) => adminApi.updateRuleSet(ruleSetId, { [field]: checked }),
    onSuccess: (_, checked) => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
      toast.success(checked ? `${label}: ativado` : `${label}: desativado`);
    },
    onError: () => toast.error('Falha ao salvar configuração'),
  });

  return <Toggle checked={value} onChange={(v) => mutation.mutate(v)} aria-label={label} />;
}

function RuleSetNameEditor({
  detail,
}: {
  detail: { id: string; name: string; description?: string | null };
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(detail.name);
  useEffect(() => {
    if (!editing) setValue(detail.name);
  }, [detail.name, editing]);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (name: string) => adminApi.updateRuleSet(detail.id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-sets'] });
      qc.invalidateQueries({ queryKey: ['rule-set', detail.id] });
      setEditing(false);
      toast.success('Nome atualizado');
    },
    onError: () => toast.error('Falha ao renomear'),
  });

  const commit = () => {
    if (mutation.isPending) return;
    const trimmed = value.trim();
    if (trimmed && trimmed !== detail.name) mutation.mutate(trimmed);
    else {
      setValue(detail.name);
      setEditing(false);
    }
  };

  return (
    <div>
      {editing ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setValue(detail.name);
              setEditing(false);
            }
          }}
          className="rounded border border-primary bg-background px-2 py-0.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex items-center gap-1.5"
        >
          <h2 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
            {detail.name}
          </h2>
          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            editar
          </span>
        </button>
      )}
      {detail.description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{detail.description}</p>
      )}
    </div>
  );
}

function UnlinkPropertyButton({
  ruleSetId,
  propertyId,
  externalId,
}: {
  ruleSetId: string;
  propertyId: string;
  externalId: string;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.unlinkProperty(ruleSetId, propertyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
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

function LinkPropertyForm({
  ruleSetId,
  linkedProperties,
}: {
  ruleSetId: string;
  linkedProperties: { propertyId: string }[];
}) {
  const [selectedId, setSelectedId] = useState('');
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
    mutationFn: () => adminApi.linkProperty(ruleSetId, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
      setSelectedId('');
      toast.success('Imóvel vinculado');
    },
    onError: () => toast.error('Falha ao vincular imóvel'),
  });
  if (available.length === 0) return null;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="flex gap-2 pt-1"
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
        disabled={!selectedId || mutation.isPending}
      >
        <Plus className="size-3" />
        Vincular
      </CustomButton>
    </form>
  );
}

function AddPolicyForm({ ruleSetId }: { ruleSetId: string }) {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.createPolicy(ruleSetId, { name: name.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
      qc.invalidateQueries({ queryKey: ['rule-sets'] });
      setName('');
      toast.success('Política criada');
    },
    onError: () => toast.error('Falha ao criar política'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
      className="flex gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome da política..."
        className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <CustomButton
        type="submit"
        variant="secondary"
        size="sm"
        disabled={!name.trim() || mutation.isPending}
      >
        <Plus className="size-3.5" />
        Adicionar
      </CustomButton>
    </form>
  );
}

function RulesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: ruleSets = [] } = useQuery({
    queryKey: ['rule-sets'],
    queryFn: fetchRuleSets,
  });

  const activeId = selectedId ?? ruleSets[0]?.id ?? null;

  const { data: detail } = useQuery({
    queryKey: ['rule-set', activeId],
    queryFn: () => fetchRuleSet(activeId!),
    enabled: !!activeId,
  });

  const qc = useQueryClient();

  const createRuleSet = useMutation({
    mutationFn: () => adminApi.createRuleSet({ name: 'Novo conjunto' }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['rule-sets'] });
      setSelectedId((res.data as { id: string }).id);
      toast.success('Conjunto criado');
    },
    onError: () => toast.error('Falha ao criar conjunto'),
  });

  const deleteRuleSet = useMutation({
    mutationFn: (id: string) => adminApi.deleteRuleSet(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-sets'] });
      setSelectedId(null);
      toast.success('Conjunto removido');
    },
    onError: () => toast.error('Falha ao remover conjunto'),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regras"
        subtitle="Políticas aplicadas aos imóveis"
        actions={
          <CustomButton
            variant="primary"
            size="sm"
            onClick={() => createRuleSet.mutate()}
            disabled={createRuleSet.isPending}
          >
            <Plus className="size-4" />
            Novo conjunto
          </CustomButton>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {/* Rule set selector */}
          {ruleSets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ruleSets.map((rs) => (
                <div key={rs.id} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setSelectedId(rs.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      rs.id === activeId
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {rs.name}
                    <span className="ml-1.5 opacity-60">{rs._count.policies}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Remover conjunto"
                    disabled={deleteRuleSet.isPending}
                    onClick={() => deleteRuleSet.mutate(rs.id)}
                    className="rounded-full p-1 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Active rule set detail */}
          {detail ? (
            <>
              <RuleSetNameEditor detail={detail} />

              <div className="space-y-2">
                {detail.policies.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nenhuma política cadastrada.</p>
                )}
                {detail.policies.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 rounded-[10px] bg-surface-raised p-4"
                    style={{ boxShadow: 'var(--shadow-sm)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{p.name}</p>
                      {p.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-[11px] text-muted-foreground">Imóvel</span>
                      <AppliesToToggle policy={p} ruleSetId={detail.id} />
                      <PolicyValueGroup policy={p} ruleSetId={detail.id} />
                      <DeletePolicyButton policy={p} ruleSetId={detail.id} />
                    </div>
                  </div>
                ))}
                <AddPolicyForm ruleSetId={detail.id} />
              </div>
            </>
          ) : ruleSets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum conjunto de regras. Crie um para começar.
            </p>
          ) : null}
        </div>

        {/* Reuso panel */}
        {detail && (
          <div
            className="h-fit rounded-[10px] bg-surface-raised p-5 self-start space-y-4"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Reuso
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Propagar configurações para imóveis vinculados
              </p>
            </div>

            <div className="space-y-3">
              {[
                {
                  label: 'Propagar políticas',
                  field: 'propagatePolicies',
                  value: detail.propagatePolicies,
                },
                {
                  label: 'Propagar cláusulas',
                  field: 'propagateClauses',
                  value: detail.propagateClauses,
                },
                {
                  label: 'Propagar campos',
                  field: 'propagateFields',
                  value: detail.propagateFields,
                },
              ].map(({ label, field, value }) => (
                <div key={field} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <PropagateToggle
                    ruleSetId={detail.id}
                    field={field}
                    value={value}
                    label={label}
                  />
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Em uso
              </p>
              {detail.linkedProperties.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detail.linkedProperties.map(({ propertyId, externalId }) => (
                    <div
                      key={propertyId}
                      className="flex items-center gap-0.5 rounded-full bg-muted pl-2 pr-1 py-0.5"
                    >
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {externalId}
                      </span>
                      <UnlinkPropertyButton
                        ruleSetId={detail.id}
                        propertyId={propertyId}
                        externalId={externalId}
                      />
                    </div>
                  ))}
                </div>
              )}
              <LinkPropertyForm ruleSetId={detail.id} linkedProperties={detail.linkedProperties} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
