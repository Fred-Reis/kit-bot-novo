import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { fetchAllPayments } from '@/lib/queries';
import { computePaymentsSummary } from '@/lib/payments';
import { computeMonthlyTotals } from '@/lib/finance';
import { formatCurrency } from '@/lib/utils';
import { KpiCard } from '@/components/kpi-card';
import { PageHeader } from '@/components/page-header';

export const Route = createFileRoute('/_dashboard/finance/')({ component: FinancePage });

const TABS = ['Visão geral', 'Receitas', 'Despesas', 'Relatórios'];

function currencyTick(value: number) {
  if (value >= 1000) return `R$${(value / 1000).toFixed(0)}k`;
  return `R$${value}`;
}

function RevenueChart({ data }: { data: { month: string; revenue: number; overdue: number }[] }) {
  return (
    <div>
      <p className="mb-4 text-xs text-muted-foreground">Receita mensal (R$)</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap="30%">
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
          <Bar dataKey="overdue" fill="var(--color-destructive)" radius={[4, 4, 0, 0]} opacity={0.6} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type PaymentRow = { month: string; amount: number; status: string; description: string | null };

function TransactionTable({ payments }: { payments: PaymentRow[] }) {
  if (payments.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma transação encontrada.</p>;
  }
  return (
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
        {payments.map((p, i) => (
          <tr key={i}>
            <td className="py-2 font-mono text-muted-foreground">{p.month}</td>
            <td className="py-2 text-foreground">{p.description ?? '—'}</td>
            <td className="py-2 text-right font-mono font-medium">{formatCurrency(p.amount)}</td>
            <td className="py-2 text-right">
              <span className={
                p.status === 'paid' ? 'text-success' :
                p.status === 'overdue' ? 'text-destructive' :
                'text-muted-foreground'
              }>
                {p.status === 'paid' ? 'Pago' : p.status === 'overdue' ? 'Atraso' : 'Pendente'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FinancePage() {
  const [tab, setTab] = useState(0);

  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: fetchAllPayments,
    staleTime: 30_000,
  });

  const summary = computePaymentsSummary(payments);
  const monthlyData = computeMonthlyTotals(payments, 6);
  const revenueSpark = monthlyData.map((d) => d.revenue);
  const overdueSpark = monthlyData.map((d) => d.overdue);
  const paidPayments = payments.filter((p) => p.status === 'paid').slice(0, 20);
  const activePayments = payments.filter((p) => p.status !== 'paid').slice(0, 20);

  const nonZeroMonths = monthlyData.filter((d) => d.revenue > 0);
  const avgPerMonth = nonZeroMonths.length > 0
    ? nonZeroMonths.reduce((s, d) => s + d.revenue, 0) / nonZeroMonths.length
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Financeiro" subtitle="Visão geral das finanças" />

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
          subtext={summary.overdueCount > 0 ? `${summary.overdueCount} pagamento${summary.overdueCount !== 1 ? 's' : ''}` : undefined}
          sparkData={overdueSpark}
          up={false}
          className={summary.overdueAmount > 0 ? 'ring-1 ring-destructive/40' : undefined}
        />
        <KpiCard
          label="A RECEBER"
          value={formatCurrency(summary.pendingAmount)}
          subtext={summary.pendingCount > 0 ? `${summary.pendingCount} boleto${summary.pendingCount !== 1 ? 's' : ''}` : undefined}
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

      <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
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

        {tab === 0 && <RevenueChart data={monthlyData} />}
        {tab === 1 && <TransactionTable payments={paidPayments} />}
        {tab === 2 && <TransactionTable payments={activePayments} />}
        {tab === 3 && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-muted-foreground">Em construção.</p>
          </div>
        )}
      </div>
    </div>
  );
}
