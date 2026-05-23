import type { ContractDetail } from '@kit-manager/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';
import { CustomButton } from '@/components/ui/btn';
import { Pill } from '@/components/ui/pill';
import { fetchContract } from '@/lib/queries';
import { formatCurrency } from '@/lib/utils';

export const Route = createFileRoute('/_dashboard/contracts/$contractId')({
  component: ContractDetailPage,
});

const STATUS_LABEL: Record<ContractDetail['status'], string> = {
  active: 'Ativo',
  terminated: 'Encerrado',
  renewal: 'Renovação',
};

const STATUS_TONE: Record<ContractDetail['status'], 'ok' | 'default' | 'warn'> = {
  active: 'ok',
  terminated: 'default',
  renewal: 'warn',
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function ContractBody({ body }: { body: string }) {
  const parts = body.split(/({{[^}]+}})/g);
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground font-mono">
      {parts.map((part, i) =>
        /^{{[^}]+}}$/.test(part) ? (
          <span key={i} className="rounded bg-accent-soft px-1 text-accent-ink">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </div>
  );
}

function ContractDetailPage() {
  const { contractId } = Route.useParams();
  const navigate = useNavigate();
  const {
    data: contract,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['contract', contractId],
    queryFn: () => fetchContract(contractId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (isError || !contract) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        Contrato não encontrado.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Voltar"
          onClick={() => navigate({ to: '/contracts' })}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-foreground font-mono">{contract.code}</h1>
            <Pill tone={STATUS_TONE[contract.status]} dot>
              {STATUS_LABEL[contract.status]}
            </Pill>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {contract.tenant.name ?? contract.tenant.phone} · {contract.property.name}
          </p>
        </div>
        <CustomButton variant="secondary" size="sm" onClick={() => toast.info('Em breve')}>
          <Download className="size-4" />
          Baixar PDF
        </CustomButton>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Inquilino', value: contract.tenant.name ?? contract.tenant.phone },
          { label: 'Imóvel', value: contract.property.name },
          {
            label: 'Vigência',
            value: `${formatDate(contract.startDate)} → ${contract.endDate ? formatDate(contract.endDate) : '—'}`,
          },
          { label: 'Aluguel', value: `${formatCurrency(contract.monthlyRent)}/mês` },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-[10px] bg-surface-raised p-4"
            style={{ boxShadow: 'var(--shadow-sm)' }}
          >
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-sm font-medium text-foreground">{value}</p>
          </div>
        ))}
      </div>

      <div
        className="rounded-[10px] bg-surface-raised p-6"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <h2 className="mb-4 text-sm font-semibold text-foreground">Corpo do contrato</h2>
        <ContractBody body={contract.body} />
      </div>
    </div>
  );
}
