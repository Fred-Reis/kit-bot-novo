export const KYC_BLOCKER_STAGES = new Set([
  'kyc_pending',
  'kyc_approved',
  'residents_docs_complete',
  'contract_pending',
  'contract_signed',
  'converted',
]);

// TERMINAL_STAGES includes data_confirmation to prevent FSM stage regression.
// KYC_BLOCKER_STAGES excludes data_confirmation so KYC transition can fire once dataConfirmed=true.
// review_submitted is terminal too: a submitted lead may derive property_info or
// objection_handling to get a question answered, and that must not demote the stage.
export const TERMINAL_STAGES = new Set([
  ...KYC_BLOCKER_STAGES,
  'data_confirmation',
  'review_submitted',
]);

// "A análise já foi submetida" é fato do banco (Lead.stage), não flag de sessão.
// Inclui review_submitted porque o proprietário pode marcar "Docs enviados"
// manualmente no painel; exclui data_confirmation de propósito — lá a confirmação
// ainda precisa acontecer, e tratá-la como submetida travaria o lead pra sempre.
export const ANALYSIS_SUBMITTED_STAGES = new Set([...KYC_BLOCKER_STAGES, 'review_submitted']);

// context.dataConfirmed vive só na sessão (Conversation.data), sem contrapartida
// no banco. PATCH /admin/leads/:id/stage escreve só Lead.stage — um owner que
// rebaixa o lead (kyc_pending -> collection, por exemplo) não limpa a flag, e a
// próxima mensagem do lead recalcula shouldTransitionToKyc como true de novo,
// voltando o stage sozinho e notificando o owner uma segunda vez. NAO reseta em
// data_confirmation: ali a confirmação pode estar genuinamente em andamento.
export function shouldResetDataConfirmation(leadStage: string): boolean {
  return leadStage !== 'data_confirmation' && !ANALYSIS_SUBMITTED_STAGES.has(leadStage);
}

export function shouldTransitionToKyc(
  checklistComplete: boolean,
  leadStage: string,
  dataConfirmed: boolean,
): boolean {
  return checklistComplete && dataConfirmed && !KYC_BLOCKER_STAGES.has(leadStage);
}

export function shouldUpdateLeadSource(
  currentSource: string | null | undefined,
  extractedSource: string | null,
): boolean {
  if (!extractedSource || extractedSource === 'desconhecido') return false;
  return !currentSource || currentSource === 'whatsapp';
}
