import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileText, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { tv } from 'tailwind-variants';
import type { Lead, LeadDocument } from '@kit-manager/types';

export const Route = createFileRoute('/_dashboard/leads/$leadId')({ component: LeadDetailPage });

const STAGES = [
  { key: 'interest', label: 'Interesse' },
  { key: 'collection', label: 'Coletando docs' },
  { key: 'review_submitted', label: 'Docs enviados' },
  { key: 'kyc_pending', label: 'KYC pendente' },
  { key: 'kyc_approved', label: 'KYC aprovado' },
  { key: 'residents_docs_complete', label: 'Docs completos' },
  { key: 'contract_pending', label: 'Contrato pendente' },
  { key: 'contract_signed', label: 'Contrato assinado' },
  { key: 'converted', label: 'Convertido' },
];

const actionBtn = tv({
  base: 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
  variants: {
    variant: {
      primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
      secondary: 'border border-border bg-secondary text-foreground hover:bg-muted',
    },
  },
  defaultVariants: { variant: 'primary' },
});

interface LeadWithDocs extends Lead {
  documents: LeadDocument[];
}

async function fetchLead(id: string): Promise<LeadWithDocs> {
  const res = await fetch(`/api/leads/${id}`);
  return res.json() as Promise<LeadWithDocs>;
}

async function callAdminAction(leadId: string, action: string, body?: object): Promise<void> {
  const botUrl = import.meta.env.VITE_BOT_API_URL as string;
  await fetch(`${botUrl}/admin/leads/${leadId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function StageStepper({ current }: { current: string }) {
  const currentIdx = STAGES.findIndex((s) => s.key === current);
  return (
    <div data-slot="stage-stepper" className="flex items-start gap-0">
      {STAGES.map((stage, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={stage.key} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full items-center">
              {idx > 0 && (
                <div className={`h-0.5 flex-1 ${done || active ? 'bg-primary' : 'bg-border'}`} />
              )}
              <div
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium
                ${done ? 'bg-primary text-primary-foreground' : active ? 'border-2 border-primary bg-surface text-primary' : 'border-2 border-border bg-surface text-muted-foreground'}`}
              >
                {done ? <CheckCircle className="size-3.5" /> : idx + 1}
              </div>
              {idx < STAGES.length - 1 && (
                <div className={`h-0.5 flex-1 ${done ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
            <span
              className={`text-center text-[10px] leading-tight ${active ? 'font-medium text-primary' : 'text-muted-foreground'}`}
            >
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DocGrid({ docs }: { docs: LeadDocument[] }) {
  if (docs.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {docs.map((doc) => (
        <div
          key={doc.id}
          data-slot="doc-card"
          className="overflow-hidden rounded-lg border border-border bg-surface"
        >
          <img src={doc.url} alt={doc.type} className="h-32 w-full object-cover" />
          <div className="p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {doc.type}
            </p>
            {doc.ocrText && (
              <p className="mt-1 line-clamp-2 text-xs text-foreground-subtle">{doc.ocrText}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function GenerateContractModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [day, setDay] = useState(10);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => callAdminAction(leadId, 'generate-contract', { paymentDayOfMonth: day }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20">
      <div
        data-slot="modal"
        className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-6 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">Gerar Contrato</h2>
        <p className="mt-1 text-sm text-muted-foreground">Dia de vencimento do aluguel</p>
        <input
          type="number"
          min={1}
          max={28}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
          className="mt-3 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={actionBtn({ variant: 'secondary' })}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className={actionBtn({ variant: 'primary' })}
          >
            {mutation.isPending ? 'Gerando...' : 'Gerar contrato'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const qc = useQueryClient();
  const [showContractModal, setShowContractModal] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => fetchLead(leadId),
  });

  const approveKyc = useMutation({
    mutationFn: () => callAdminAction(leadId, 'approve-kyc'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lead', leadId] }),
  });

  const confirmPayment = useMutation({
    mutationFn: () => callAdminAction(leadId, 'confirm-payment'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['lead', leadId] }),
  });

  if (isLoading) return <div className="h-96 animate-pulse rounded-xl bg-muted" />;

  if (!lead) return <p className="text-sm text-muted-foreground">Lead não encontrado.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/leads" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-foreground">{lead.phone}</h1>
          <p className="text-sm text-muted-foreground">Lead ID: {lead.id}</p>
        </div>
      </div>

      {/* Stage timeline */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <StageStepper current={lead.stage} />
      </div>

      {/* Action buttons */}
      {lead.stage === 'kyc_pending' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => approveKyc.mutate()}
            disabled={approveKyc.isPending}
            className={actionBtn({ variant: 'primary' })}
          >
            <CheckCircle className="size-4" />
            {approveKyc.isPending ? 'Aprovando...' : 'Aprovar KYC'}
          </button>
        </div>
      )}
      {lead.stage === 'residents_docs_complete' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowContractModal(true)}
            className={actionBtn({ variant: 'primary' })}
          >
            <FileText className="size-4" />
            Gerar Contrato
          </button>
        </div>
      )}
      {lead.stage === 'contract_signed' && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => confirmPayment.mutate()}
            disabled={confirmPayment.isPending}
            className={actionBtn({ variant: 'primary' })}
          >
            <CheckCircle className="size-4" />
            {confirmPayment.isPending ? 'Confirmando...' : 'Confirmar Pagamento'}
          </button>
        </div>
      )}

      {/* Documents */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">Documentos</h2>
        <DocGrid docs={lead.documents ?? []} />
      </div>

      {showContractModal && (
        <GenerateContractModal leadId={leadId} onClose={() => setShowContractModal(false)} />
      )}
    </div>
  );
}
