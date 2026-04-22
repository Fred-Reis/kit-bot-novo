import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { fetchLeads, fetchProperties, fetchTenants, fetchAllPayments } from '@/lib/queries';
import { formatCurrency } from '@/lib/utils';
import { KpiCard } from '@/components/kpi-card';
import { EmptyState } from '@/components/empty-state';
import { Pill } from '@/components/ui/pill';
import { STAGE_LABELS, STAGE_TONE } from '@/lib/leads';

export const Route = createFileRoute('/_dashboard/')({ component: DashboardPage });

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
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

  const total = properties.length;
  const occupied = new Set(tenants.map((t) => t.propertyId)).size;
  const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const activeLeads = leads.filter((l) => l.stage !== 'converted').length;
  const pendingKyc = leads.filter((l) => l.stage === 'kyc_pending').length;
  const overdueCount = payments.filter((p) => p.status === 'overdue').length;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthRevenue = payments
    .filter((p) => p.status === 'paid' && p.month.startsWith(currentMonth))
    .reduce((sum, p) => sum + p.amount, 0);

  const upcomingPayments = payments
    .filter((p) => p.status === 'pending')
    .slice(0, 4);

  const recentActivity = [...leads]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Visão geral do sistema</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Taxa de ocupação" value={`${occupancyPct}%`} seed={1} up />
        <KpiCard label="Leads ativos" value={activeLeads} seed={2} up={activeLeads > 0} />
        <KpiCard
          label="KYC pendente"
          value={pendingKyc}
          seed={3}
          up={false}
          className={pendingKyc > 0 ? 'ring-1 ring-warn/40' : undefined}
        />
        <KpiCard
          label="Em atraso"
          value={overdueCount > 0 ? overdueCount : '—'}
          seed={4}
          up={false}
          className={overdueCount > 0 ? 'ring-1 ring-bad/40' : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Occupancy per property */}
        <div className="rounded-[10px] bg-surface-raised p-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
          <h2 className="mb-4 text-sm font-medium text-foreground">Ocupação por imóvel</h2>
          {properties.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum imóvel cadastrado.</p>
          ) : (
            <div className="space-y-3">
              {properties.map((p) => {
                const isTaken = tenants.some((t) => t.propertyId === p.id);
                return (
                  <div key={p.id} className="flex items-center gap-3">
                    <span className="w-32 truncate text-xs text-muted-foreground">{p.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: isTaken ? '100%' : '0%' }}
                      />
                    </div>
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
            <h2 className="text-sm font-medium text-foreground">Próximos pagamentos</h2>
            {monthRevenue > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {formatCurrency(monthRevenue)} recebido este mês
              </span>
            )}
          </div>
          {upcomingPayments.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum pagamento pendente.</p>
          ) : (
            <div className="space-y-3">
              {upcomingPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-muted-foreground">
                      {p.tenantId.slice(0, 8)}…
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {dateFmt.format(new Date(p.month))}
                    </p>
                  </div>
                  <span className="font-mono text-xs font-medium text-foreground">
                    {formatCurrency(p.amount)}
                  </span>
                </div>
              ))}
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
          {recentActivity.length === 0 ? (
            <EmptyState
              illustration="activity"
              title="Sem atividade recente"
              subtitle="As atualizações de leads aparecerão aqui."
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentActivity.map((lead) => (
                <li key={lead.id}>
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: lead.id }}
                    className="flex items-center justify-between px-5 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <span className="text-[10px] font-medium">{lead.phone.slice(-2)}</span>
                      </div>
                      <div>
                        <p className="font-mono text-xs font-medium text-foreground">{lead.phone}</p>
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
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
