import type { Payment } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';
import { Pill } from '@/components/ui/pill';
import { adminApi } from '@/lib/api';
import { computeMonthlyTotals } from '@/lib/finance';
import { computePaymentsSummary } from '@/lib/payments';
import { fetchAllPayments, fetchProperties, fetchTenants } from '@/lib/queries';
import { formatCurrency } from '@/lib/utils';

export const Route = createFileRoute('/_dashboard/finance/')({ component: FinancePage });

const TABS = ['Visão geral', 'Receitas', 'À receber', 'Repasses'];

function currencyTick(value: number) {
  if (value >= 1000) return `R$${(value / 1000).toFixed(0)}k`;
  return `R$${value}`;
}

function RevenueChart({ data }: { data: { month: string; revenue: number; overdue: number }[] }) {
  return (
    <div>
      <p className="mb-4 text-xs text-muted-foreground">Receita mensal (R$)</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={currencyTick}
            tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [
              formatCurrency(Number(value)),
              name === 'revenue' ? 'Recebido' : 'Em atraso',
            ]}
            contentStyle={{
              background: 'var(--color-surface-raised)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend
            formatter={(value) => (value === 'revenue' ? 'Recebido' : 'Em atraso')}
            wrapperStyle={{ fontSize: 11 }}
          />
          <Bar dataKey="revenue" fill="var(--color-primary)" radius={[4, 4, 0, 0]} opacity={0.85} />
          <Bar
            dataKey="overdue"
            fill="var(--color-destructive)"
            radius={[4, 4, 0, 0]}
            opacity={0.6}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecentMovementsTable({ payments }: { payments: Payment[] }) {
  const recent = useMemo(
    () =>
      [...payments]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [payments],
  );

  if (recent.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">Nenhum movimento registrado.</p>
    );
  }
  return (
    <table className="w-full text-xs" data-slot="recent-movements">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="pb-2 font-medium">Mês</th>
          <th className="pb-2 font-medium">Tipo</th>
          <th className="pb-2 font-medium">Descrição</th>
          <th className="pb-2 text-right font-medium">Valor</th>
          <th className="pb-2 text-right font-medium">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {recent.map((p) => (
          <tr key={p.id}>
            <td className="py-2 font-mono text-muted-foreground">{p.month}</td>
            <td className="py-2">
              <Pill tone={p.type === 'income' ? 'ok' : 'bad'}>
                {p.type === 'income' ? 'Receita' : 'Despesa'}
              </Pill>
            </td>
            <td className="py-2 text-foreground">{p.description ?? '—'}</td>
            <td className="py-2 text-right font-mono font-medium">{formatCurrency(p.amount)}</td>
            <td className="py-2 text-right">
              <Pill tone={p.status === 'paid' ? 'ok' : p.status === 'overdue' ? 'bad' : 'default'}>
                {p.status === 'paid' ? 'Pago' : p.status === 'overdue' ? 'Atraso' : 'Pendente'}
              </Pill>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type PeriodFilter = 'month' | 'semester' | 'year';

function ReceitasTab({ payments }: { payments: Payment[] }) {
  const now = new Date();
  const [filter, setFilter] = useState<PeriodFilter>('month');
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));

  const income = useMemo(() => {
    const base = payments.filter((p) => p.type === 'income');
    if (filter === 'month') return base.filter((p) => p.month === selectedMonth);
    if (filter === 'year') return base.filter((p) => p.month.startsWith(selectedYear));
    // semester: current month + 5 previous
    const today = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    return base.filter((p) => months.includes(p.month));
  }, [payments, filter, selectedMonth, selectedYear]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(['month', 'semester', 'year'] as PeriodFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f === 'month' ? 'Mês' : f === 'semester' ? 'Semestre' : 'Ano'}
            </button>
          ))}
        </div>
        {filter === 'month' && (
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground"
          />
        )}
        {filter === 'year' && (
          <input
            type="number"
            min="2020"
            max="2099"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="w-20 rounded border border-border bg-transparent px-2 py-1 text-xs text-foreground"
          />
        )}
      </div>
      {income.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          Nenhuma receita no período.
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="pb-2 font-medium">Mês</th>
              <th className="pb-2 font-medium">Descrição</th>
              <th className="pb-2 text-right font-medium">Valor</th>
              <th className="pb-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {income.map((p) => (
              <tr key={p.id}>
                <td className="py-2 font-mono text-muted-foreground">{p.month}</td>
                <td className="py-2 text-foreground">{p.description ?? '—'}</td>
                <td className="py-2 text-right font-mono font-medium">
                  {formatCurrency(p.amount)}
                </td>
                <td className="py-2 text-right">
                  <Pill
                    tone={p.status === 'paid' ? 'ok' : p.status === 'overdue' ? 'bad' : 'default'}
                  >
                    {p.status === 'paid' ? 'Pago' : p.status === 'overdue' ? 'Atraso' : 'Pendente'}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AReceberTab({ payments }: { payments: Payment[] }) {
  const pending = useMemo(
    () =>
      payments
        .filter((p) => p.type === 'income' && p.status === 'pending')
        .sort((a, b) => a.month.localeCompare(b.month)),
    [payments],
  );

  if (pending.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-muted-foreground">Nenhum pagamento pendente.</p>
    );
  }
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="pb-2 font-medium">Mês</th>
          <th className="pb-2 font-medium">Tipo</th>
          <th className="pb-2 font-medium">Descrição</th>
          <th className="pb-2 text-right font-medium">Valor</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {pending.map((p) => (
          <tr key={p.id}>
            <td className="py-2 font-mono text-muted-foreground">{p.month}</td>
            <td className="py-2">
              <Pill tone={p.type === 'income' ? 'ok' : 'bad'}>
                {p.type === 'income' ? 'Receita' : 'Despesa'}
              </Pill>
            </td>
            <td className="py-2 text-foreground">{p.description ?? '—'}</td>
            <td className="py-2 text-right font-mono font-medium">{formatCurrency(p.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-40 items-center justify-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function NewPaymentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<'income' | 'expense'>('income');
  const [amount, setAmount] = useState('');
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(thisMonth);
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('paid');
  const [inquilinoId, setInquilinoId] = useState('');
  const [propertyId, setPropertyId] = useState('');

  const {
    data: tenants = [],
    isLoading: tenantsLoading,
    isError: tenantsError,
  } = useQuery({
    queryKey: ['tenants'],
    queryFn: fetchTenants,
    staleTime: 60_000,
  });
  const {
    data: properties = [],
    isLoading: propertiesLoading,
    isError: propertiesError,
  } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const base = { amount: Number(amount), month, status };
      if (type === 'income') {
        return adminApi.createPayment({
          ...base,
          type: 'income',
          inquilinoId,
          description: description || undefined,
        });
      }
      return adminApi.createPayment({ ...base, type: 'expense', propertyId, description });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      toast.success('Lançamento registrado.');
      onClose();
    },
    onError: () => toast.error('Erro ao registrar lançamento.'),
  });

  const canSubmit =
    Number(amount) > 0 &&
    month.length === 7 &&
    (type === 'income' ? !!inquilinoId : !!propertyId && !!description);

  const FIELD =
    'w-full rounded border border-border bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-slot="modal-overlay"
    >
      <div className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-lg" data-slot="modal">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Novo lançamento</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-md border border-border p-0.5">
          {(['income', 'expense'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 rounded py-1.5 text-sm font-medium transition-colors ${
                type === t
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'income' ? 'Receita' : 'Despesa'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {type === 'income' ? (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Inquilino *</label>
              {tenantsError ? (
                <p className="text-xs text-destructive">Erro ao carregar inquilinos.</p>
              ) : (
                <select
                  value={inquilinoId}
                  onChange={(e) => setInquilinoId(e.target.value)}
                  className={FIELD}
                  disabled={tenantsLoading}
                >
                  <option value="">{tenantsLoading ? 'Carregando…' : 'Selecionar…'}</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name ?? t.phone}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Imóvel *</label>
              {propertiesError ? (
                <p className="text-xs text-destructive">Erro ao carregar imóveis.</p>
              ) : (
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className={FIELD}
                  disabled={propertiesLoading}
                >
                  <option value="">{propertiesLoading ? 'Carregando…' : 'Selecionar…'}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Valor (R$) *</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className={FIELD}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Mês de referência *</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={FIELD}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Descrição {type === 'expense' ? '*' : '(opcional)'}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={type === 'income' ? 'ex: Aluguel abril' : 'ex: Manutenção elétrica'}
              className={FIELD}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={FIELD}>
              <option value="paid">Pago</option>
              <option value="pending">Pendente</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {mutation.isPending ? 'Salvando…' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FinancePage() {
  const [tab, setTab] = useState(0);
  const [showModal, setShowModal] = useState(false);

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: fetchAllPayments,
    staleTime: 30_000,
  });

  const summary = computePaymentsSummary(payments);
  const monthlyData = computeMonthlyTotals(payments, 6);
  const revenueSpark = monthlyData.map((d) => d.revenue);
  const overdueSpark = monthlyData.map((d) => d.overdue);

  const nonZeroMonths = monthlyData.filter((d) => d.revenue > 0);
  const avgPerMonth =
    nonZeroMonths.length > 0
      ? nonZeroMonths.reduce((s, d) => s + d.revenue, 0) / nonZeroMonths.length
      : 0;

  return (
    <div className="space-y-6">
      {showModal && <NewPaymentModal onClose={() => setShowModal(false)} />}
      <div className="flex items-start justify-between">
        <PageHeader title="Financeiro" subtitle="Visão geral das finanças" />
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Novo lançamento
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="RECEBIDO (MÊS)"
          value={formatCurrency(summary.monthRevenue)}
          delta={summary.delta}
          sparkData={revenueSpark}
          up={summary.delta >= 0}
        />
        <KpiCard
          label="EM ATRASO"
          value={summary.overdueAmount > 0 ? formatCurrency(summary.overdueAmount) : '—'}
          subtext={
            summary.overdueCount > 0
              ? `${summary.overdueCount} pagamento${summary.overdueCount !== 1 ? 's' : ''}`
              : undefined
          }
          sparkData={overdueSpark}
          up={false}
          className={summary.overdueAmount > 0 ? 'ring-1 ring-destructive/40' : undefined}
        />
        <KpiCard
          label="A RECEBER"
          value={formatCurrency(summary.pendingAmount)}
          subtext={
            summary.pendingCount > 0
              ? `${summary.pendingCount} boleto${summary.pendingCount !== 1 ? 's' : ''}`
              : undefined
          }
          sparkData={revenueSpark}
          up={summary.pendingAmount > 0}
        />
        <KpiCard
          label="MÉDIA MENSAL"
          value={avgPerMonth > 0 ? formatCurrency(avgPerMonth) : '—'}
          sparkData={revenueSpark}
          up
        />
      </div>

      <div
        className="rounded-[10px] bg-surface-raised p-5"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <div className="mb-4 flex gap-1 border-b border-border">
          {TABS.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(i)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === i
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 0 && (
          <div className="space-y-6">
            <RevenueChart data={monthlyData} />
            <div>
              <p className="mb-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Últimos movimentos
              </p>
              <RecentMovementsTable payments={payments} />
            </div>
          </div>
        )}
        {tab === 1 && <ReceitasTab payments={payments} />}
        {tab === 2 && <AReceberTab payments={payments} />}
        {tab === 3 && <Placeholder text="Disponível com multi-tenancy." />}
      </div>
    </div>
  );
}
