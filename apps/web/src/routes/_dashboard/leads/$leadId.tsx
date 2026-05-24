import type { LeadDocument } from '@kit-manager/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertCircle, CheckCircle, ChevronLeft, FileText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomButton } from '@/components/ui/btn';
import { logActivity } from '@/lib/activity';
import { adminApi } from '@/lib/api';
import { SOURCE_LABELS, STAGES } from '@/lib/leads';
import { fetchLead } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

export const Route = createFileRoute('/_dashboard/leads/$leadId')({ component: LeadDetailPage });

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
    mutationFn: () => adminApi.generateContract(leadId, Math.min(28, Math.max(1, day))),
    onSuccess: () => {
      toast.success('Contrato gerado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      onClose();
    },
    onError: () => toast.error('Erro ao gerar contrato.'),
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
          <CustomButton variant="secondary" onClick={onClose}>
            Cancelar
          </CustomButton>
          <CustomButton
            variant="primary"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Gerando...' : 'Gerar contrato'}
          </CustomButton>
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

  const togglePause = useMutation({
    mutationFn: () => {
      const next = !lead?.botPaused;
      return adminApi.pauseLead(leadId, next).then(() => next);
    },
    onSuccess: (next) => {
      toast.success(next ? 'Bot pausado.' : 'Bot retomado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: () => toast.error('Erro ao alternar bot.'),
  });

  const updateSource = useMutation({
    mutationFn: async (source: string) => {
      await adminApi.updateLeadSource(leadId, source);
      if (lead) {
        logActivity(supabase, {
          ownerId: lead.ownerId,
          actorType: 'user',
          actorLabel: 'Admin',
          action: 'lead_source_corrected',
          subjectType: 'lead',
          subjectId: leadId,
          subject: lead.phone,
          metadata: { source },
        }).catch(console.error);
      }
    },
    onSuccess: () => {
      toast.success('Origem atualizada.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: () => toast.error('Erro ao atualizar origem.'),
  });

  const approveKyc = useMutation({
    mutationFn: () => adminApi.approveKyc(leadId),
    onSuccess: () => {
      toast.success('KYC aprovado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: () => toast.error('Erro ao aprovar KYC.'),
  });

  const confirmPayment = useMutation({
    mutationFn: () => adminApi.confirmPayment(leadId),
    onSuccess: () => {
      toast.success('Pagamento confirmado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: () => toast.error('Erro ao confirmar pagamento.'),
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

      {/* Bot paused badge */}
      {lead.botPaused && (
        <div
          data-slot="bot-paused-badge"
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning-foreground"
        >
          <AlertCircle className="size-4 shrink-0" />
          Bot pausado — você assume
        </div>
      )}

      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface-raised p-5 space-y-4">
        <h2 className="text-sm font-medium text-foreground">Controles</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={lead.source ?? ''}
            disabled={updateSource.isPending}
            onChange={(e) => {
              if (e.target.value) updateSource.mutate(e.target.value);
            }}
            className="rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">— origem —</option>
            {(Object.entries(SOURCE_LABELS) as [string, string][]).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <CustomButton
            variant="secondary"
            onClick={() => togglePause.mutate()}
            disabled={togglePause.isPending}
          >
            {lead.botPaused ? 'Retomar bot' : 'Pausar bot'}
          </CustomButton>
        </div>
      </div>

      {/* Stage timeline */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <StageStepper current={lead.stage} />
      </div>

      {/* Action buttons */}
      {lead.stage === 'kyc_pending' && (
        <div className="flex gap-2">
          <CustomButton
            variant="primary"
            onClick={() => approveKyc.mutate()}
            disabled={approveKyc.isPending}
          >
            <CheckCircle className="size-4" />
            {approveKyc.isPending ? 'Aprovando...' : 'Aprovar KYC'}
          </CustomButton>
        </div>
      )}
      {lead.stage === 'residents_docs_complete' && (
        <div className="flex gap-2">
          <CustomButton variant="primary" onClick={() => setShowContractModal(true)}>
            <FileText className="size-4" />
            Gerar Contrato
          </CustomButton>
        </div>
      )}
      {lead.stage === 'contract_signed' && (
        <div className="flex gap-2">
          <CustomButton
            variant="primary"
            onClick={() => confirmPayment.mutate()}
            disabled={confirmPayment.isPending}
          >
            <CheckCircle className="size-4" />
            {confirmPayment.isPending ? 'Confirmando...' : 'Confirmar Pagamento'}
          </CustomButton>
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
