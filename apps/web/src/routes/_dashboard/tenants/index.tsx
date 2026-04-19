import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import type { Tenant } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/tenants/')({ component: TenantsPage });

async function fetchTenants(): Promise<Tenant[]> {
  const res = await fetch('/api/tenants');
  return res.json() as Promise<Tenant[]>;
}

function TenantsPage() {
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: fetchTenants,
  });

  const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Inquilinos</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{tenants.length} inquilinos ativos</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        {isLoading ? (
          <div className="space-y-px">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse bg-muted" />
            ))}
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <UserCheck className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nenhum inquilino ativo.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Telefone
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Imóvel
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Início
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Fim
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="transition-colors hover:bg-muted/50">
                  <td className="px-5 py-3.5 font-medium text-foreground">{tenant.phone}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">{tenant.propertyId}</td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {dateFmt.format(new Date(tenant.contractStart))}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {tenant.contractEnd ? dateFmt.format(new Date(tenant.contractEnd)) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
