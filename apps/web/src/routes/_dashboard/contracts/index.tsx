import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Plus, Download, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { fetchContracts, fetchTenants, fetchProperties, fetchContractTemplates } from '@/lib/queries';
import { adminApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { ContractSummary } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/contracts/')({ component: ContractsPage });

const STATUS_LABEL: Record<ContractSummary['status'], string> = {
  active: 'Ativo',
  terminated: 'Encerrado',
  renewal: 'Renovação',
};

const STATUS_TONE: Record<ContractSummary['status'], 'ok' | 'default' | 'warn'> = {
  active: 'ok',
  terminated: 'default',
  renewal: 'warn',
};

function effectiveStatus(c: ContractSummary): ContractSummary['status'] {
  if (c.status !== 'active' || !c.endDate) return c.status;
  const daysLeft = (new Date(c.endDate).getTime() - Date.now()) / 86_400_000;
  return daysLeft <= 60 ? 'renewal' : 'active';
}

function formatDateRange(start: string, end: string | null): string {
  const fmt = (d: string) => new Date(d).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' });
  return end ? `${fmt(start)} → ${fmt(end)}` : `${fmt(start)} → —`;
}

const FIELD_CLS = 'w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-foreground';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL_CLS}>{label}</label>
      {children}
    </div>
  );
}

function NewContractModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    templateId: '',
    tenantId: '',
    propertyId: '',
    startDate: '',
    endDate: '',
    monthlyRent: '',
  });

  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: fetchTenants });
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: fetchProperties });
  const { data: templates = [] } = useQuery({ queryKey: ['contract-templates'], queryFn: fetchContractTemplates });

  const mutation = useMutation({
    mutationFn: () => adminApi.createContract({
      templateId: form.templateId,
      tenantId: form.tenantId,
      propertyId: form.propertyId,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      monthlyRent: Number(form.monthlyRent),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contracts'] });
      toast.success('Contrato criado');
      onClose();
    },
    onError: () => toast.error('Falha ao criar contrato'),
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const valid = form.templateId && form.tenantId && form.propertyId && form.startDate && form.monthlyRent;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-[12px] bg-surface-raised p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Novo contrato</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Template">
            <select value={form.templateId} onChange={set('templateId')} className={FIELD_CLS}>
              <option value="">Selecionar template…</option>
              {templates.filter(t => t.status === 'published').map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Inquilino">
            <select value={form.tenantId} onChange={set('tenantId')} className={FIELD_CLS}>
              <option value="">Selecionar inquilino…</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name ?? t.phone}</option>
              ))}
            </select>
          </Field>

          <Field label="Imóvel">
            <select value={form.propertyId} onChange={set('propertyId')} className={FIELD_CLS}>
              <option value="">Selecionar imóvel…</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <input type="date" value={form.startDate} onChange={set('startDate')} className={FIELD_CLS} />
            </Field>
            <Field label="Fim (opcional)">
              <input type="date" value={form.endDate} onChange={set('endDate')} className={FIELD_CLS} />
            </Field>
          </div>

          <Field label="Aluguel mensal (R$)">
            <input type="number" min="0" step="0.01" value={form.monthlyRent} onChange={set('monthlyRent')} placeholder="900.00" className={FIELD_CLS} />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <CustomButton variant="secondary" size="sm" onClick={onClose}>Cancelar</CustomButton>
          <CustomButton
            variant="primary"
            size="sm"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Criar contrato
          </CustomButton>
        </div>
      </div>
    </div>
  );
}

function ContractsPage() {
  const [showModal, setShowModal] = useState(false);
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: fetchContracts,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contratos"
        subtitle="Histórico de contratos de locação"
        actions={
          <CustomButton variant="primary" size="sm" onClick={() => setShowModal(true)}>
            <Plus className="size-4" />
            Novo contrato
          </CustomButton>
        }
      />

      {showModal && <NewContractModal onClose={() => setShowModal(false)} />}

      <div className="overflow-hidden rounded-[10px] bg-surface-raised" style={{ boxShadow: 'var(--shadow-sm)' }}>
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">Carregando…</div>
        ) : contracts.length === 0 ? (
          <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
            Nenhum contrato. Crie um para começar.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Nº</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Inquilino</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Imóvel</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Vigência</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">Valor</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="w-10 px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contracts.map((c) => {
                const status = effectiveStatus(c);
                return (
                <tr key={c.id} className="transition-colors hover:bg-muted/50">
                  <td className="px-5 py-3.5 font-mono text-xs font-medium text-foreground">{c.code}</td>
                  <td className="px-5 py-3.5 text-sm text-foreground">{c.tenant.name ?? '—'}</td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground hidden md:table-cell">{c.property.name}</td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground hidden sm:table-cell">{formatDateRange(c.startDate, c.endDate)}</td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground hidden lg:table-cell">{formatCurrency(c.monthlyRent)}/mês</td>
                  <td className="px-5 py-3.5">
                    <Pill tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Pill>
                  </td>
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      aria-label="Baixar contrato"
                      onClick={() => toast.info('Em breve')}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Download className="size-4" />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
