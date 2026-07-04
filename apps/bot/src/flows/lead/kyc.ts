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
export const TERMINAL_STAGES = new Set([...KYC_BLOCKER_STAGES, 'data_confirmation']);

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
