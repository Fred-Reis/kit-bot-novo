import type { LeadStage } from '@kit-manager/types';

export type KanbanColumn = 'novo' | 'qualificacao' | 'visita' | 'proposta' | 'ganho';

const STAGE_COLUMN_MAP: Record<LeadStage, KanbanColumn> = {
  interest: 'novo',
  collection: 'qualificacao',
  review_submitted: 'qualificacao',
  visiting: 'visita',
  kyc_pending: 'proposta',
  kyc_approved: 'proposta',
  residents_docs_complete: 'proposta',
  contract_pending: 'proposta',
  contract_signed: 'proposta',
  converted: 'ganho',
};

export function stageToColumn(stage: LeadStage): KanbanColumn {
  return STAGE_COLUMN_MAP[stage];
}
