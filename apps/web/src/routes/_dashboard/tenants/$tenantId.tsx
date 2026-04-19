import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { fetchTenants } from '@/lib/queries';
import { SpecBar } from '@/components/spec-bar';
import { Avatar } from '@/components/ui/avatar';

export const Route = createFileRoute('/_dashboard/tenants/$tenantId')({
  component: TenantDetailPage,
});

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

const STATIC_PAYMENTS = [
  { id: 1, month: 'Abr 2026', amount: 'R$ 1.800,00', status: 'Pago' },
  { id: 2, month: 'Mar 2026', amount: 'R$ 1.800,00', status: 'Pago' },
  { id: 3, month: 'Fev 2026', amount: 'R$ 1.800,00', status: 'Pago' },
  { id: 4, month: 'Jan 2026', amount: 'R$ 1.800,00', status: 'Pago' },
  { id: 5, month: 'Dez 2025', amount: 'R$ 1.800,00', status: 'Pago' },
  { id: 6, month: 'Nov 2025', amount: 'R$ 1.800,00', status: 'Pago' },
];

function TenantDetailPage() {
  const { tenantId } = Route.useParams();

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: fetchTenants,
  });

  const tenant = tenants.find((t) => t.id === tenantId);

  if (isLoading) return <div className="h-96 animate-pulse rounded-[10px] bg-muted" />;
  if (!tenant) return <p className="text-sm text-muted-foreground">Inquilino não encontrado.</p>;

  const contractEnd = tenant.contractEnd ? dateFmt.format(new Date(tenant.contractEnd)) : '—';

  return (
    <div className="space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Link
          to="/tenants"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <Avatar name={tenant.phone} size="sm" />
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-lg font-semibold text-foreground">{tenant.phone}</h1>
          <p className="text-xs text-muted-foreground">
            Desde {dateFmt.format(new Date(tenant.contractStart))}
          </p>
        </div>
      </div>

      {/* SpecBar */}
      <SpecBar cells={[
        { label: 'Pontuação', value: '—' },
        { label: 'Pgtos em dia', value: '—' },
        { label: 'Vencimento', value: contractEnd },
        { label: 'Imóvel', value: tenant.propertyId.slice(0, 6) + '…' },
      ]} />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        {/* Payment history (static) */}
        <div
          className="rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Histórico de pagamentos</h2>
            <span className="text-[10px] text-muted-foreground/60">dados fictícios</span>
          </div>
          <div className="space-y-2">
            {STATIC_PAYMENTS.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-2.5"
              >
                <span className="text-sm text-foreground">{p.month}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-foreground">{p.amount}</span>
                  <span className="text-xs text-success">{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div
          className="rounded-[10px] bg-surface-raised p-5 self-start"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contato
          </h3>
          <div className="space-y-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Telefone</p>
              <p className="font-mono font-medium text-foreground">{tenant.phone}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">E-mail</p>
              <p className="text-muted-foreground">—</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CPF</p>
              <p className="text-muted-foreground">—</p>
            </div>
          </div>

          <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Documentos
          </h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>RG / CNH</li>
            <li>Comprovante de renda</li>
            <li>Comprovante de residência</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
