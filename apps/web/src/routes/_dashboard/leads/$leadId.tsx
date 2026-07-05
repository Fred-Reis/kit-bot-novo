import type { LeadDocument } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AlertCircle, Archive, CheckCircle, ChevronLeft, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { CustomButton } from '@/components/ui/btn';
import { Input } from '@/components/ui/input';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { SOURCE_LABELS, STAGES, stageToStepKey } from '@/lib/leads';
import { fetchLead } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/leads/$leadId')({ component: LeadDetailPage });

function StageStepper({ current }: { current: string }) {
  const stepKey = stageToStepKey(current);
  const currentIdx = STAGES.findIndex((s) => s.key === stepKey);
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

function DocViewerModal({ doc, onClose }: { doc: LeadDocument; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Documento: ${doc.type}`}
    >
      <div
        className="relative flex max-h-[90vh] max-w-3xl w-full flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          className="mb-3 self-end rounded-full p-1 text-white/70 transition-colors hover:text-white"
        >
          <X className="size-6" />
        </button>
        <img
          src={doc.url}
          alt={doc.type}
          className="max-h-[80vh] w-full rounded-lg object-contain shadow-xl"
        />
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-white/60">
          {doc.type}
        </p>
      </div>
    </div>
  );
}

function DocGrid({ docs }: { docs: LeadDocument[] }) {
  const [selected, setSelected] = useState<LeadDocument | null>(null);

  if (docs.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {docs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            data-slot="doc-card"
            onClick={() => setSelected(doc)}
            className="overflow-hidden rounded-lg border border-border bg-surface text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-36 items-center justify-center overflow-hidden bg-muted">
              <img src={doc.url} alt={doc.type} className="h-full w-full object-contain" />
            </div>
            <div className="p-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {doc.type}
              </p>
              {doc.ocrText && (
                <p className="mt-1 line-clamp-2 text-xs text-foreground-subtle">{doc.ocrText}</p>
              )}
            </div>
          </button>
        ))}
      </div>
      {selected && <DocViewerModal doc={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

type ManualVarAction = 'fill' | 'remove' | 'ignore';

interface ManualVarState {
  action: ManualVarAction;
  value: string;
}

function defaultVarStates(keys: string[]): Record<string, ManualVarState> {
  return Object.fromEntries(keys.map((p) => [p, { action: 'ignore' as ManualVarAction, value: '' }]));
}

function ApproveKycModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [day, setDay] = useState(10);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [varStates, setVarStates] = useState<Record<string, ManualVarState>>({});
  const [loadingVars, setLoadingVars] = useState(false);
  const [hasTemplate, setHasTemplate] = useState(true);
  const qc = useQueryClient();

  const clampedDay = Math.min(28, Math.max(1, day));

  const mutation = useMutation({
    mutationFn: (overrideVarStates?: Record<string, ManualVarState>) => {
      const stateToUse = overrideVarStates ?? varStates;
      const manualVariables: Record<string, string | null> = {};
      for (const [placeholder, state] of Object.entries(stateToUse)) {
        if (state.action === 'fill' && state.value.trim()) manualVariables[placeholder] = state.value;
        else if (state.action === 'remove') manualVariables[placeholder] = null;
        // 'ignore' or empty fill → omit; backend replaces with N/A
      }
      return adminApi.approveKyc(leadId, { paymentDayOfMonth: clampedDay, manualVariables });
    },
    onSuccess: () => {
      toast.success('KYC aprovado. Contrato gerado e enviado ao lead.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao aprovar KYC.')),
  });

  async function goToStep2() {
    setLoadingVars(true);
    try {
      const { data } = await adminApi.getContractVariables(leadId, clampedDay);
      setHasTemplate(data.hasTemplate);
      if (!data.hasTemplate) return;
      if (data.unresolved.length === 0) {
        mutation.mutate(undefined);
        return;
      }
      setVarStates(defaultVarStates(data.unresolved));
      setUnresolved(data.unresolved);
      setStep(2);
    } catch {
      toast.error('Erro ao verificar variáveis do contrato.');
    } finally {
      setLoadingVars(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20">
      <div
        data-slot="modal"
        className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-6 shadow-lg"
      >
        {step === 1 ? (
          <>
            <h2 className="text-base font-semibold text-foreground">Aprovar KYC</h2>
            <p className="mt-1 text-sm text-muted-foreground">Dia de vencimento do aluguel</p>
            <Input
              type="number"
              min={1}
              max={28}
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="mt-3"
            />
            {!hasTemplate && (
              <p className="mt-2 text-sm text-destructive">
                Nenhum template publicado.{' '}
                <Link to="/templates" onClick={onClose} className="font-medium underline">
                  Publicar template →
                </Link>
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <CustomButton variant="secondary" onClick={onClose}>
                Cancelar
              </CustomButton>
              <CustomButton
                variant="primary"
                onClick={() => void goToStep2()}
                disabled={loadingVars}
              >
                {loadingVars ? 'Verificando...' : 'Próximo →'}
              </CustomButton>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-foreground">Variáveis pendentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              As seguintes variáveis não foram preenchidas automaticamente:
            </p>
            <div className="mt-3 space-y-4">
              {unresolved.map((placeholder) => {
                const state = varStates[placeholder] ?? { action: 'ignore' as ManualVarAction, value: '' };
                return (
                  <div key={placeholder} className="space-y-1.5">
                    <p className="font-mono text-sm text-foreground">{placeholder}</p>
                    <div className="flex gap-2">
                      <CustomButton
                        variant={state.action === 'fill' ? 'primary' : 'secondary'}
                        onClick={() =>
                          setVarStates((prev) => ({
                            ...prev,
                            [placeholder]: { action: 'fill', value: state.value },
                          }))
                        }
                      >
                        Preencher
                      </CustomButton>
                      <CustomButton
                        variant={state.action === 'remove' ? 'primary' : 'secondary'}
                        onClick={() =>
                          setVarStates((prev) => ({
                            ...prev,
                            [placeholder]: { action: 'remove', value: '' },
                          }))
                        }
                      >
                        Remover
                      </CustomButton>
                    </div>
                    {state.action === 'fill' && (
                      <Input
                        type="text"
                        placeholder="Valor"
                        value={state.value}
                        onChange={(e) =>
                          setVarStates((prev) => ({
                            ...prev,
                            [placeholder]: { action: 'fill', value: e.target.value },
                          }))
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <CustomButton
                variant="secondary"
                onClick={() => mutation.mutate(defaultVarStates(unresolved))}
                disabled={mutation.isPending}
              >
                Ignorar todas
              </CustomButton>
              <div className="flex gap-2">
                <CustomButton variant="secondary" onClick={() => setStep(1)}>
                  ← Voltar
                </CustomButton>
                <CustomButton
                  variant="primary"
                  onClick={() => mutation.mutate(undefined)}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? 'Aprovando...' : 'Confirmar e aprovar'}
                </CustomButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LeadDetailPage() {
  const { leadId } = Route.useParams();
  const qc = useQueryClient();
  const [showApproveKycModal, setShowApproveKycModal] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => fetchLead(leadId),
  });

  const togglePause = useMutation({
    mutationFn: (next: boolean) => adminApi.pauseLead(leadId, next),
    onSuccess: (_data, next) => {
      toast.success(next ? 'Bot pausado.' : 'Bot retomado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao alternar bot.')),
  });

  const updateSource = useMutation({
    mutationFn: (source: string) => adminApi.updateLeadSource(leadId, source),
    onSuccess: () => {
      toast.success('Origem atualizada.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao atualizar origem.')),
  });

  const markSigned = useMutation({
    mutationFn: () => adminApi.markContractSigned(leadId),
    onSuccess: () => {
      toast.success('Contrato marcado como assinado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao marcar contrato.')),
  });

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => adminApi.archiveLead(leadId, archived),
    onSuccess: (_, archived) => {
      toast.success(archived ? 'Lead arquivado.' : 'Lead reativado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao arquivar lead.')),
  });

  if (isLoading) return <div className="h-96 animate-pulse rounded-xl bg-muted" />;

  if (!lead) return <p className="text-sm text-muted-foreground">Lead não encontrado.</p>;

  const isArchived = !!lead.archivedAt;
  const archiveLabel = isArchived ? 'Reativar lead' : 'Arquivar lead';

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
          className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning"
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
            {(Object.entries(SOURCE_LABELS) as [string, string][])
              .filter(([key]) => !['zap', 'other', 'desconhecido'].includes(key))
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
          <CustomButton
            variant="secondary"
            onClick={() => togglePause.mutate(!lead.botPaused)}
            disabled={togglePause.isPending}
          >
            {lead.botPaused ? 'Retomar bot' : 'Pausar bot'}
          </CustomButton>
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Zona de risco
          </p>
          <ConfirmButton
            label={archiveLabel}
            confirmLabel={isArchived ? 'Reativar' : 'Arquivar'}
            onConfirm={() => archiveMutation.mutate(!isArchived)}
            disabled={archiveMutation.isPending}
            className={isArchived ? undefined : 'text-destructive hover:bg-destructive/10'}
          >
            <Archive className="mr-1.5 size-3.5" />
            {archiveLabel}
          </ConfirmButton>
        </div>
      </div>

      {/* Stage timeline */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <StageStepper current={lead.stage} />
      </div>

      {/* Action buttons */}
      {lead.stage === 'kyc_pending' && (
        <div className="flex gap-2">
          <CustomButton variant="primary" onClick={() => setShowApproveKycModal(true)}>
            <CheckCircle className="size-4" />
            Aprovar KYC
          </CustomButton>
        </div>
      )}
      {lead.stage === 'contract_pending' && (
        <div className="flex gap-2">
          <CustomButton
            variant="primary"
            disabled={markSigned.isPending}
            onClick={() => markSigned.mutate()}
          >
            <CheckCircle className="size-4" />
            {markSigned.isPending ? 'Salvando…' : 'Marcar contrato assinado'}
          </CustomButton>
        </div>
      )}

      {showApproveKycModal && (
        <ApproveKycModal leadId={leadId} onClose={() => setShowApproveKycModal(false)} />
      )}

      {/* Documents */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">Documentos</h2>
        <DocGrid docs={lead.documents ?? []} />
      </div>
    </div>
  );
}
