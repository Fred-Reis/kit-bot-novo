import type { LeadSource } from '@kit-manager/types';

export type StageTone = 'ok' | 'warn' | 'bad' | 'accent' | 'default';

export function formatPhone(phone: string): string {
  return phone.replace(/@.*$/, '');
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  whatsapp: 'WhatsApp',
  olx: 'OLX',
  zap: 'ZAP',
  site: 'Site',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  outro: 'Outro',
  desconhecido: '?',
  other: 'Outro',
};

// 6-step funnel stepper (hidden stages map to nearest visible step via stageToStepKey)
export const STAGES = [
  { key: 'interest', label: 'Interesse' },
  { key: 'visiting', label: 'Visita' },
  { key: 'collection', label: 'Documentos' },
  { key: 'kyc_pending', label: 'KYC' },
  { key: 'contract_pending', label: 'Contrato' },
  { key: 'converted', label: 'Convertido' },
] as const;

const STAGE_TO_STEP_KEY: Record<string, string> = {
  interest: 'interest',
  visiting: 'visiting',
  collection: 'collection',
  data_confirmation: 'collection',
  review_submitted: 'collection',
  kyc_pending: 'kyc_pending',
  kyc_approved: 'kyc_pending',
  residents_docs_complete: 'kyc_pending',
  contract_pending: 'contract_pending',
  contract_signed: 'contract_pending',
  converted: 'converted',
};

export function stageToStepKey(stage: string): string {
  return STAGE_TO_STEP_KEY[stage] ?? 'interest';
}

export const STAGE_LABELS: Record<string, string> = {
  interest: 'Interesse',
  visiting: 'Visita',
  collection: 'Coletando docs',
  data_confirmation: 'Confirmando dados',
  review_submitted: 'Docs enviados',
  kyc_pending: 'KYC pendente',
  kyc_approved: 'KYC aprovado',
  residents_docs_complete: 'Docs completos',
  contract_pending: 'Contrato pendente',
  contract_signed: 'Contrato assinado',
  converted: 'Convertido',
};

export const STAGE_TONE: Record<string, StageTone> = {
  interest: 'default',
  visiting: 'accent',
  collection: 'default',
  data_confirmation: 'accent',
  review_submitted: 'accent',
  kyc_pending: 'warn',
  kyc_approved: 'ok',
  residents_docs_complete: 'accent',
  contract_pending: 'warn',
  contract_signed: 'ok',
  converted: 'ok',
};
