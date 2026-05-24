const TERMINAL_STAGES = new Set([
  'kyc_pending',
  'kyc_approved',
  'residents_docs_complete',
  'contract_pending',
  'contract_signed',
  'converted',
]);

export function shouldTransitionToKyc(
  docsStage: string,
  residentsCount: number,
  residentsComplete: boolean,
  leadStage: string,
): boolean {
  return (
    docsStage === 'complete' &&
    residentsCount > 0 &&
    residentsComplete &&
    !TERMINAL_STAGES.has(leadStage)
  );
}

export function shouldUpdateLeadSource(
  currentSource: string | null | undefined,
  extractedSource: string | null,
): boolean {
  if (!extractedSource || extractedSource === 'desconhecido') return false;
  return !currentSource || currentSource === 'whatsapp';
}

export { TERMINAL_STAGES };
