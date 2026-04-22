import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft } from 'lucide-react';
import { fetchTenant } from '@/lib/queries';
import { formatCurrency } from '@/lib/utils';
import { SpecBar } from '@/components/spec-bar';
import { EmptyState } from '@/components/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';

export const Route = createFileRoute('/_dashboard/tenants/$tenantId')({
  component: TenantDetailPage,
});

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });
const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' });

const STATUS_TONE = {
  paid: 'ok',
  pending: 'warn',
  overdue: 'bad',
} as const;

const STATUS_LABEL = {
  paid: 'Pago',
  pending: 'Pendente',
  overdue: 'Atrasado',
} as const;

function TenantDetailPage() {
  const { tenantId } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: () => fetchTenant(tenantId),
  });

  if (isLoading) return <div className="h-96 animate-pulse rounded-[10px] bg-muted" />;
  if (!data) return <p className="text-sm text-muted-foreground">Inquilino não encontrado.</p>;

  const { payments, ...tenant } = data;
  const displayName = tenant.name ?? tenant.phone;
  const contractEnd = tenant.contractEnd ? dateFmt.format(new Date(tenant.contractEnd)) : '—';
  const onTimeRate = tenant.onTimeRate != null ? `${tenant.onTimeRate}%` : '—';
  const score = tenant.score != null ? String(tenant.score) : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/tenants"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <Avatar name={displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground">{displayName}</h1>
          <p className="font-mono text-xs text-muted-foreground">{tenant.phone}</p>
        </div>
      </div>

      <SpecBar cells={[
        { label: 'Pontuação', value: score },
        { label: 'Pgtos em dia', value: onTimeRate },
        { label: 'Fim contrato', value: contractEnd },
        { label: 'Imóvel', value: tenant.propertyId.slice(0, 6) + '…' },
      ]} />

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div
          className="rounded-[10px] bg-surface-raised p-5"
          style={{ boxShadow: 'var(--shadow-sm)' }}
        >
          <h2 className="mb-4 text-sm font-medium text-foreground">Histórico de pagamentos</h2>
          {payments.length === 0 ? (
            <EmptyState
              illustration="payments"
              title="Nenhum pagamento registrado"
              subtitle="Os pagamentos aparecerão aqui após o primeiro registro."
            />
          ) : (
            <div className="space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-2.5"
                >
                  <span className="text-sm text-foreground">
                    {monthFmt.format(new Date(p.month))}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-foreground">
                      {formatCurrency(p.amount)}
                    </span>
                    <Pill tone={STATUS_TONE[p.status]} dot>
                      {STATUS_LABEL[p.status]}
                    </Pill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

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
              <p className="text-foreground">{tenant.email ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CPF</p>
              <p className="font-mono text-foreground">{tenant.cpf ?? '—'}</p>
            </div>
            {tenant.dueDay != null && (
              <div>
                <p className="text-xs text-muted-foreground">Vencimento</p>
                <p className="text-foreground">Dia {tenant.dueDay}</p>
              </div>
            )}
          </div>

          <h3 className="mb-3 mt-5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Início do contrato
          </h3>
          <p className="text-sm text-foreground">
            {dateFmt.format(new Date(tenant.contractStart))}
          </p>
        </div>
      </div>
    </div>
  );
}
