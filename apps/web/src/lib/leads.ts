import type { LeadSource } from '@kit-manager/types';

export type StageTone = 'ok' | 'warn' | 'bad' | 'accent' | 'default';

/** Strip Evolution API suffixes like @s.whatsapp.net from phone strings. */
export function formatPhone(phone: string): string {
  return phone.replace(/@.*$/, '');
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  whatsapp: 'ZAP',
  zap: 'ZAP',
  site: 'Site',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  other: 'Outro',
};

export const STAGES = [
  { key: 'interest', label: 'Interesse' },
  { key: 'collection', label: 'Coletando docs' },
  { key: 'review_submitted', label: 'Docs enviados' },
  { key: 'visiting', label: 'Visita agendada' },
  { key: 'kyc_pending', label: 'KYC pendente' },
  { key: 'kyc_approved', label: 'KYC aprovado' },
  { key: 'residents_docs_complete', label: 'Docs completos' },
  { key: 'contract_pending', label: 'Contrato pendente' },
  { key: 'contract_signed', label: 'Contrato assinado' },
  { key: 'converted', label: 'Convertido' },
] as const;

export const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.label]),
);

export const STAGE_TONE: Record<string, StageTone> = {
  interest: 'default',
  collection: 'default',
  review_submitted: 'accent',
  kyc_pending: 'warn',
  kyc_approved: 'ok',
  residents_docs_complete: 'accent',
  contract_pending: 'warn',
  contract_signed: 'ok',
  converted: 'ok',
};
