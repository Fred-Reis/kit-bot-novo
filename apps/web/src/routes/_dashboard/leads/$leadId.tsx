import type { LeadDocumentType } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertCircle, Archive, CheckCircle, ChevronLeft, FileText, MapPin, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { ContractsSection } from '@/components/contracts-section';
import { DocGrid } from '@/components/doc-grid';
import { CustomButton } from '@/components/ui/btn';
import { Input } from '@/components/ui/input';
import { adminApi, apiErrorMessage } from '@/lib/api';
import { formatPhone, SOURCE_LABELS, STAGES, stageToStepKey } from '@/lib/leads';
import { fetchLead, fetchLeadContracts, fetchProperty, fetchTenantIdByPhone } from '@/lib/queries';

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

type ManualVarAction = 'fill' | 'remove' | 'ignore';

interface ManualVarState {
  action: ManualVarAction;
  value: string;
}

function defaultVarStates(keys: string[]): Record<string, ManualVarState> {
  return Object.fromEntries(keys.map((p) => [p, { action: 'ignore' as ManualVarAction, value: '' }]));
}

// The dropdown's wording is Title Case for standalone display (vs. the bot's
// lowercase-in-sentence labels), but the *values* are typed against the
// shared LeadDocumentType — a value missing or extra here fails to compile
// instead of silently drifting from what the bot's OCR classifier produces.
const DOC_TYPE_LABEL_WEB: Record<LeadDocumentType, string> = {
  cnh_front: 'Frente da CNH',
  cnh_back: 'Verso da CNH',
  cnh_full: 'CNH completa (foto única)',
  rg_front: 'Frente do RG',
  rg_back: 'Verso do RG',
  cpf: 'CPF',
  income_proof: 'Comprovante de renda',
  unknown: 'Não identificado',
};
const DOC_TYPE_OPTIONS = Object.entries(DOC_TYPE_LABEL_WEB).map(([value, label]) => ({
  value,
  label,
}));

function ApproveKycModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [day, setDay] = useState(10);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [varStates, setVarStates] = useState<Record<string, ManualVarState>>({});
  const [loadingVars, setLoadingVars] = useState(false);
  const [hasTemplate, setHasTemplate] = useState(true);
  const [templateName, setTemplateName] = useState<string | null>(null);
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
      setTemplateName(data.templateName ?? null);
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4"
      onClick={onClose}
    >
      <div
        data-slot="modal"
        className="flex w-full max-w-lg flex-col max-h-[85vh] rounded-xl border border-border bg-surface-raised shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 1 ? (
          <div className="p-6">
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
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b border-border px-6 pt-6 pb-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Variáveis pendentes</h2>
                  {templateName && (
                    <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                      Template:{' '}
                      <span className="text-foreground">{templateName}</span>
                    </p>
                  )}
                  <p className="mt-1 text-sm text-muted-foreground">
                    As seguintes variáveis não foram preenchidas automaticamente:
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Fechar"
                  onClick={onClose}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4">
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
            </div>
            <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between">
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
  const navigate = useNavigate();
  const [showApproveKycModal, setShowApproveKycModal] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => fetchLead(leadId),
    // Converting a lead to a tenant can happen in the background (the bot's
    // WhatsApp auto-finalize flow), with no button click on this page to hang
    // a redirect off — poll so the effect below can catch the transition.
    refetchInterval: 5000,
  });

  const { data: convertedTenantId } = useQuery({
    queryKey: ['lead-converted-tenant', lead?.phone],
    queryFn: () => fetchTenantIdByPhone(lead!.phone),
    enabled: lead?.stage === 'converted',
  });

  useEffect(() => {
    if (convertedTenantId) {
      void navigate({ to: '/tenants/$tenantId', params: { tenantId: convertedTenantId } });
    }
  }, [convertedTenantId, navigate]);

  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ['lead-contracts', leadId],
    queryFn: () => fetchLeadContracts(leadId),
  });

  const { data: property, isError: isPropertyError } = useQuery({
    queryKey: ['property', lead?.propertyId],
    queryFn: () => fetchProperty(lead!.propertyId!),
    enabled: !!lead?.propertyId,
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const markSigned = useMutation({
    mutationFn: () => adminApi.markContractSigned(leadId),
    onSuccess: () => {
      toast.success('Contrato marcado como assinado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      void qc.invalidateQueries({ queryKey: ['lead-contracts', leadId] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
      // Stays on this page — stage is now 'contract_signed', not 'converted'.
      // The tenant record already exists, but conversion isn't final until
      // confirm-payment. The redirect-to-tenant effect below fires once
      // stage actually reaches 'converted'.
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao marcar contrato.')),
  });

  const confirmPayment = useMutation({
    mutationFn: () => adminApi.confirmPayment(leadId),
    onSuccess: () => {
      toast.success('Pagamento confirmado — lead convertido.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao confirmar pagamento.')),
  });

  const uploadSigned = useMutation({
    mutationFn: (file: File) => adminApi.uploadSignedContract(leadId, file),
    onSuccess: () => {
      toast.success('Contrato assinado anexado. Marcando como assinado…');
      void qc.invalidateQueries({ queryKey: ['lead-contracts', leadId] });
      markSigned.mutate();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao enviar contrato assinado.')),
  });

  const reclassifyDoc = useMutation({
    mutationFn: ({ docId, type }: { docId: string; type: string }) =>
      adminApi.reclassifyDocument(leadId, docId, type),
    onSuccess: () => {
      toast.success('Documento reclassificado.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao reclassificar documento.')),
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
          <h1 className="text-xl font-semibold text-foreground">
            {lead.name?.trim() || formatPhone(lead.phone)}
          </h1>
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

      {/* Property */}
      {lead.propertyId && (
        <div data-slot="property-card" className="rounded-xl border border-border bg-surface-raised p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-medium text-foreground">Imóvel vinculado</h2>
            {property && (
              <Link
                to="/properties/$propertyId"
                params={{ propertyId: property.id }}
                className="shrink-0 text-xs text-primary hover:underline"
              >
                Ver imóvel →
              </Link>
            )}
          </div>
          {property ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                  {property.externalId}
                </span>
                <span className="text-sm font-medium text-foreground">{property.name}</span>
              </div>
              <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {property.address}
                  {property.complement ? `, ${property.complement}` : ''} — {property.neighborhood}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Aluguel:{' '}
                <span className="font-medium text-foreground">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(property.rent)}
                </span>
              </p>
            </div>
          ) : isPropertyError ? (
            <p className="mt-3 text-sm text-destructive">Erro ao carregar imóvel.</p>
          ) : (
            <div className="mt-3 space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          )}
        </div>
      )}

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
        <div className="flex flex-wrap gap-2">
          <CustomButton
            variant="primary"
            disabled={markSigned.isPending || uploadSigned.isPending}
            onClick={() => markSigned.mutate()}
          >
            <CheckCircle className="size-4" />
            {markSigned.isPending ? 'Salvando…' : 'Marcar contrato assinado'}
          </CustomButton>
          <CustomButton
            variant="secondary"
            disabled={uploadSigned.isPending || markSigned.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText className="size-4" />
            {uploadSigned.isPending ? 'Enviando…' : 'Anexar contrato assinado'}
          </CustomButton>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadSigned.mutate(file);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {lead.stage === 'contract_signed' && (
        <div className="flex gap-2">
          <CustomButton
            variant="primary"
            disabled={confirmPayment.isPending}
            onClick={() => confirmPayment.mutate()}
          >
            <CheckCircle className="size-4" />
            {confirmPayment.isPending ? 'Confirmando…' : 'Confirmar pagamento'}
          </CustomButton>
        </div>
      )}

      {showApproveKycModal && (
        <ApproveKycModal leadId={leadId} onClose={() => setShowApproveKycModal(false)} />
      )}

      {/* Contracts */}
      <ContractsSection contracts={contracts} isLoading={contractsLoading} />

      {/* Documents */}
      <div className="rounded-xl border border-border bg-surface-raised p-5">
        <h2 className="mb-4 text-sm font-medium text-foreground">Documentos</h2>
        <DocGrid
          docs={lead.documents ?? []}
          reclassify={{
            options: DOC_TYPE_OPTIONS,
            pending: reclassifyDoc.isPending,
            onSubmit: (docId, type) => reclassifyDoc.mutate({ docId, type }),
          }}
        />
      </div>
    </div>
  );
}
