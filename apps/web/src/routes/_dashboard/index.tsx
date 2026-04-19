import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Users, FileText, UserCheck } from 'lucide-react';
import { twMerge } from 'tailwind-merge';
import { tv } from 'tailwind-variants';
import { fetchLeads, fetchTenants } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/')({ component: DashboardPage });

const STAGE_LABELS: Record<string, string> = {
  interest: 'Interesse',
  collection: 'Coletando docs',
  review_submitted: 'Docs enviados',
  kyc_pending: 'KYC pendente',
  kyc_approved: 'KYC aprovado',
  residents_docs_complete: 'Docs completos',
  contract_pending: 'Contrato pendente',
  contract_signed: 'Contrato assinado',
  converted: 'Convertido',
};

const kpiCard = tv({
  base: 'flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5 shadow-sm',
});

interface KpiCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  highlight?: boolean;
}

function KpiCard({ label, value, icon: Icon, highlight }: KpiCardProps) {
  return (
    <div data-slot="kpi-card" className={kpiCard()}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div
          className={twMerge(
            'flex size-8 items-center justify-center rounded-lg',
            highlight ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-4" />
        </div>
      </div>
      <span className="text-3xl font-semibold text-foreground">{value}</span>
    </div>
  );
}

function DashboardPage() {
  const { data: leads = [] } = useQuery({ queryKey: ['leads'], queryFn: fetchLeads });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: fetchTenants });

  const activeLeads = leads.filter((l) => l.stage !== 'converted').length;
  const pendingKyc = leads.filter((l) => l.stage === 'kyc_pending').length;
  const pendingContracts = leads.filter(
    (l) => l.stage === 'residents_docs_complete' || l.stage === 'contract_pending',
  ).length;
  const activeTenants = tenants.length;

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
        <KpiCard label="Leads ativos" value={activeLeads} icon={Users} />
        <KpiCard
          label="KYC pendente"
          value={pendingKyc}
          icon={FileText}
          highlight={pendingKyc > 0}
        />
        <KpiCard
          label="Contratos pendentes"
          value={pendingContracts}
          icon={FileText}
          highlight={pendingContracts > 0}
        />
        <KpiCard label="Inquilinos ativos" value={activeTenants} icon={UserCheck} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-foreground">Atividade recente</h2>
        <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
          {recentActivity.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nenhuma atividade recente.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentActivity.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 items-center justify-center rounded-full bg-muted">
                      <Users className="size-3.5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{lead.phone}</p>
                      <p className="text-xs text-muted-foreground">
                        {STAGE_LABELS[lead.stage] ?? lead.stage}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
                      new Date(lead.updatedAt),
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
