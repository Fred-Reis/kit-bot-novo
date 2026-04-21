import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { fetchTenants } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Segmented } from '@/components/ui/segmented';
import { Avatar } from '@/components/ui/avatar';
import { CustomButton } from '@/components/ui/btn';

export const Route = createFileRoute('/_dashboard/tenants/')({ component: TenantsPage });

type View = 'table' | 'cards';

const VIEW_OPTS = [
  { label: 'Tabela', value: 'table' as View },
  { label: 'Cards', value: 'cards' as View },
];

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

function ScoreBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const pct = Math.min(100, Math.max(0, value));
  const color = pct >= 70 ? 'bg-ok' : pct >= 40 ? 'bg-warn' : 'bg-bad';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-foreground">{pct}</span>
    </div>
  );
}

function TenantsPage() {
  const [view, setView] = useState<View>('table');
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: fetchTenants,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeader title="Inquilinos" subtitle={`${tenants.length} inquilinos ativos`} />
        <div className="flex items-center gap-2">
          <Segmented options={VIEW_OPTS} value={view} onChange={setView} />
          <Link to="/tenants/new">
            <CustomButton variant="primary" size="sm">
              <Plus className="size-4" />
              Novo
            </CustomButton>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-[10px] bg-muted" />
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <EmptyState
          illustration="tenants"
          title="Nenhum inquilino ativo"
          subtitle="Cadastre um inquilino ao associar um imóvel."
        />
      ) : view === 'table' ? (
        <div
          className="overflow-hidden rounded-[10px] bg-surface-raised"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">Inquilino</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Score</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Venc.</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">Em dia</th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Início</th>
                <th className="w-8 px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map((tenant) => {
                const displayName = tenant.name ?? tenant.phone;
                return (
                  <tr key={tenant.id} className="transition-colors hover:bg-muted/50">
                    <td className="px-5 py-3.5">
                      <Link
                        to="/tenants/$tenantId"
                        params={{ tenantId: tenant.id }}
                        className="flex items-center gap-2.5 hover:text-primary"
                      >
                        <Avatar name={displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">{tenant.phone}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <ScoreBar value={tenant.score ?? null} />
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">
                      {tenant.dueDay != null ? `Dia ${tenant.dueDay}` : '—'}
                    </td>
                    <td className="px-5 py-3.5 hidden lg:table-cell">
                      {tenant.onTimeRate != null ? (
                        <span className="font-mono text-xs text-foreground">{tenant.onTimeRate}%</span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground hidden sm:table-cell">
                      {dateFmt.format(new Date(tenant.contractStart))}
                    </td>
                    <td className="px-5 py-3.5">
                      <Link to="/tenants/$tenantId" params={{ tenantId: tenant.id }}>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tenants.map((tenant) => {
            const displayName = tenant.name ?? tenant.phone;
            return (
              <Link key={tenant.id} to="/tenants/$tenantId" params={{ tenantId: tenant.id }}>
                <div
                  className="rounded-[10px] bg-surface-raised p-4 hover:ring-1 hover:ring-border transition-shadow cursor-pointer"
                  style={{ boxShadow: 'var(--shadow-sm)' }}
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <Avatar name={displayName} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{tenant.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Score</span>
                    <ScoreBar value={tenant.score ?? null} />
                  </div>
                  {tenant.dueDay != null && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Vence dia <span className="font-medium text-foreground">{tenant.dueDay}</span>
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Desde {dateFmt.format(new Date(tenant.contractStart))}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
