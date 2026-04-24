import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import { fetchLeads, fetchProperties, fetchTenants, fetchAllPayments, fetchActivityLog } from '@/lib/queries';
import type { ActivityLogEntry } from '@/lib/queries';
import { computePaymentsSummary } from '@/lib/payments';
import { formatCurrency } from '@/lib/utils';
import { KpiCard } from '@/components/kpi-card';
import { EmptyState } from '@/components/empty-state';
import { Pill } from '@/components/ui/pill';
import { CustomButton } from '@/components/ui/btn';
import { STAGE_LABELS, STAGE_TONE, formatPhone } from '@/lib/leads';

export const Route = createFileRoute('/_dashboard/')({ component: DashboardPage });

const currentMonthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' })
  .format(new Date())
  .replace('. de ', ' - ')
  .replace('.', '');

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function daysUntil(monthStr: string): number {
  const due = new Date(monthStr + '-01');
  return Math.round((due.getTime() - Date.now()) / 86_400_000);
}

function dueLabel(days: number, isOverdue: boolean): string {
  if (isOverdue) return `em atraso · ${Math.abs(days)}d`;
  if (days <= 0) return 'vence hoje';
  return `vence em ${days} dia${days !== 1 ? 's' : ''}`;
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <li className="flex items-center justify-between px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <span className="text-[10px] font-medium">
            {(entry.actor ?? '?').slice(-2).toUpperCase()}
          </span>
        </div>
        <p className="text-xs text-foreground">
          <span className="font-medium">{entry.actor ?? 'Sistema'}</span>
          {' '}{entry.action}
          {entry.subject && <>{' '}<span className="font-medium">{entry.subject}</span></>}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {relativeTime(entry.createdAt)}
      </span>
    </li>
  );
}

function DashboardPage() {
  const { data: leads = [] } = useQuery({
    queryKey: ['leads'],
    queryFn: fetchLeads,
    refetchInterval: 5000,
  });
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });
  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: fetchTenants,
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: fetchAllPayments,
    staleTime: 30_000,
  });
  const { data: activityLog = [] } = useQuery({
    queryKey: ['activity-log'],
    queryFn: () => fetchActivityLog(10),
    refetchInterval: 10_000,
  });

  const activeLeads = leads.filter((l) => l.stage !== 'converted').length;
  const summary = computePaymentsSummary(payments);
  const receivedPct = summary.monthRevenue > 0
    ? `${Math.round(summary.monthRevenue / (summary.monthRevenue + summary.overdueAmount) * 100)}% do previsto`
    : undefined;

  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const upcomingPayments = payments
    .filter((p) => p.status === 'pending' || p.status === 'overdue')
    .slice(0, 4);

  const recentLeads = [...leads]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Visão geral do sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {currentMonthLabel}
          </span>
          <CustomButton variant="secondary" size="sm" onClick={() => toast.info('Em breve')}>
            <Download className="size-4" />
            Exportar
          </CustomButton>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="A RECEBER (MÊS)"
          value={formatCurrency(summary.overdueAmount + summary.pendingAmount)}
          delta={summary.delta}
          subtext={`${summary.pendingCount} boletos`}
          seed={1}
          up={summary.delta >= 0}
        />
        <KpiCard
          label="RECEBIDO"
          value={formatCurrency(summary.monthRevenue)}
          delta={summary.delta}
          subtext={receivedPct}
          seed={2}
          up={summary.delta >= 0}
        />
        <KpiCard
          label="EM ATRASO"
          value={summary.overdueAmount > 0 ? formatCurrency(summary.overdueAmount) : '—'}
          subtext={summary.overdueCount > 0 ? `${summary.overdueCount} inquilino${summary.overdueCount !== 1 ? 's' : ''}` : undefined}
          seed={3}
          up={false}
          className={summary.overdueAmount > 0 ? 'ring-1 ring-bad/40' : undefined}
        />
        <KpiCard
          label="LEADS ATIVOS"
          value={activeLeads}
          seed={4}
          up={activeLeads > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Occupancy per property */}
        <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Ocupação por imóvel</h2>
            <div className="flex items-center gap-1 rounded-lg bg-muted p-0.5">
              {['30d', '90d', '12m'].map((period) => (
                <button
                  key={period}
                  type="button"
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium text-muted-foreground first:bg-surface-raised first:text-foreground first:shadow-sm"
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          {properties.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum imóvel cadastrado.</p>
          ) : (
            <div className="space-y-3">
              {properties.map((p) => {
                const unitCount = tenants.filter((t) => t.propertyId === p.id).length;
                const isTaken = unitCount > 0;
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="w-32 text-xs text-muted-foreground">{p.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: isTaken ? '100%' : '0%' }}
                      />
                    </div>
                    <span className="w-20 text-right text-[11px] text-muted-foreground">
                      {unitCount} unidade{unitCount !== 1 ? 's' : ''}
                    </span>
                    <Pill tone={isTaken ? 'ok' : 'default'}>{isTaken ? 'Ocupado' : 'Livre'}</Pill>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming / overdue payments */}
        <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Próximos vencimentos</h2>
            {summary.monthRevenue > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {formatCurrency(summary.monthRevenue)} recebido
              </span>
            )}
          </div>
          {upcomingPayments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum pagamento pendente.</p>
          ) : (
            <div className="space-y-3">
              {upcomingPayments.map((p) => {
                const tenant = tenantById.get(p.tenantId);
                const days = daysUntil(p.month);
                const isOverdue = p.status === 'overdue';
                const isDueSoon = !isOverdue && days <= 3;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">
                        {tenant?.name ?? formatPhone(tenant?.phone ?? p.tenantId.slice(0, 8))}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{dueLabel(days, isOverdue)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(isOverdue || isDueSoon) && (
                        <Pill tone={isOverdue ? 'bad' : 'warn'}>
                          {isOverdue ? 'atraso' : 'prio'}
                        </Pill>
                      )}
                      <span className="font-mono text-xs font-medium text-foreground">
                        {formatCurrency(p.amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Atividade recente</h2>
          <Link to="/leads" className="flex items-center gap-0.5 text-xs text-primary hover:underline">
            Ver todos <ChevronRight className="size-3" />
          </Link>
        </div>
        <div className="overflow-hidden rounded-[10px] bg-surface-raised" style={{ boxShadow: 'var(--shadow-sm)' }}>
          {activityLog.length === 0 && recentLeads.length === 0 ? (
            <EmptyState
              illustration="activity"
              title="Sem atividade recente"
              subtitle="As atualizações de leads aparecerão aqui."
            />
          ) : activityLog.length > 0 ? (
            <ul className="divide-y divide-border">
              {activityLog.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
            </ul>
          ) : (
            <ul className="divide-y divide-border">
              {recentLeads.map((lead) => {
                const cleanPhone = formatPhone(lead.phone);
                const display = lead.name ?? cleanPhone;
                return (
                  <li key={lead.id}>
                    <Link
                      to="/leads/$leadId"
                      params={{ leadId: lead.id }}
                      className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <span className="text-[10px] font-medium">{display.slice(-2)}</span>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-foreground">{display}</p>
                          <div className="mt-0.5">
                            <Pill tone={STAGE_TONE[lead.stage] ?? 'default'} dot>
                              {STAGE_LABELS[lead.stage] ?? lead.stage}
                            </Pill>
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {relativeTime(lead.updatedAt)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
