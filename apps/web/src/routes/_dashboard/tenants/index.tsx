import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { UserCheck, ChevronRight } from 'lucide-react';
import { fetchTenants } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { Segmented } from '@/components/ui/segmented';

export const Route = createFileRoute('/_dashboard/tenants/')({ component: TenantsPage });

type View = 'table' | 'cards';

const VIEW_OPTS = [
  { label: 'Tabela', value: 'table' as View },
  { label: 'Cards', value: 'cards' as View },
];

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

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
        <Segmented options={VIEW_OPTS} value={view} onChange={setView} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-[10px] bg-muted" />
          ))}
        </div>
      ) : tenants.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[10px] border border-border bg-surface-raised py-16 text-center">
          <UserCheck className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Nenhum inquilino ativo.</p>
        </div>
      ) : view === 'table' ? (
        <div
          className="overflow-hidden rounded-[10px] bg-surface-raised"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Telefone
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                  Imóvel
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Início
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                  Fim
                </th>
                <th className="w-8 px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="transition-colors hover:bg-muted/50">
                  <td className="px-5 py-3.5">
                    <Link
                      to="/tenants/$tenantId"
                      params={{ tenantId: tenant.id }}
                      className="font-mono text-sm font-medium text-foreground hover:text-primary"
                    >
                      {tenant.phone}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground hidden sm:table-cell">
                    {tenant.propertyId.slice(0, 8)}…
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {dateFmt.format(new Date(tenant.contractStart))}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground hidden sm:table-cell">
                    {tenant.contractEnd ? dateFmt.format(new Date(tenant.contractEnd)) : '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link to="/tenants/$tenantId" params={{ tenantId: tenant.id }}>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tenants.map((tenant) => (
            <Link key={tenant.id} to="/tenants/$tenantId" params={{ tenantId: tenant.id }}>
              <div
                className="rounded-[10px] bg-surface-raised p-4 hover:ring-1 hover:ring-border transition-shadow cursor-pointer"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
                <div className="mb-3 flex size-9 items-center justify-center rounded-full bg-muted">
                  <UserCheck className="size-4 text-muted-foreground" />
                </div>
                <p className="font-mono text-sm font-semibold text-foreground">{tenant.phone}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Desde {dateFmt.format(new Date(tenant.contractStart))}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/60">
                  {tenant.propertyId.slice(0, 8)}…
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
