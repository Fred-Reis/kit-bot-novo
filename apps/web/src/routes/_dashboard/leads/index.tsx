import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { tv } from 'tailwind-variants';
import type { Lead } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/leads/')({ component: LeadsPage });

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

const stageBadge = tv({
  base: 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
  variants: {
    stage: {
      kyc_pending: 'bg-primary/10 text-primary',
      residents_docs_complete: 'bg-primary/10 text-primary',
      contract_pending: 'bg-primary/15 text-primary',
      contract_signed: 'bg-green-100 text-green-700',
      converted: 'bg-green-100 text-green-700',
      collection: 'bg-muted text-muted-foreground',
      review_submitted: 'bg-muted text-muted-foreground',
      kyc_approved: 'bg-muted text-muted-foreground',
      interest: 'bg-muted text-muted-foreground',
    },
  },
  defaultVariants: { stage: 'interest' },
});

async function fetchLeads(): Promise<Lead[]> {
  const res = await fetch('/api/leads');
  return res.json() as Promise<Lead[]>;
}

function LeadsPage() {
  const { data: leads = [], isLoading } = useQuery({ queryKey: ['leads'], queryFn: fetchLeads });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Leads</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{leads.length} leads registrados</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface-raised">
        {isLoading ? (
          <div className="space-y-px">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse bg-muted" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nenhum lead encontrado.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Telefone
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Etapa
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">
                  Atualizado
                </th>
                <th className="w-8 px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {leads.map((lead) => (
                <tr key={lead.id} className="transition-colors hover:bg-muted/50">
                  <td className="px-5 py-3.5">
                    <Link
                      to="/leads/$leadId"
                      params={{ leadId: lead.id }}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {lead.phone}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={stageBadge({ stage: lead.stage as 'kyc_pending' })}>
                      {STAGE_LABELS[lead.stage] ?? lead.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(
                      new Date(lead.updatedAt),
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link to="/leads/$leadId" params={{ leadId: lead.id }}>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
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
