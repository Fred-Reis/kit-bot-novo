import type { LeadStage } from '@kit-manager/types';
import { TERMINAL_STAGES } from './kyc';

const FSM_TO_STAGE: Partial<Record<string, LeadStage>> = {
  'lead.start': 'interest',
  'lead.offer_options': 'interest',
  'lead.property_info': 'interest',
  'lead.objection_handling': 'interest',
  'lead.visit_scheduling': 'visiting',
  'lead.visit_requested': 'visiting',
  'lead.post_visit_decision': 'collection',
  'lead.collect_application': 'collection',
  'lead.review_submitted': 'review_submitted',
};

/**
 * Mapeia estado do FSM de conversa para LeadStage do banco.
 * Retorna null se o stage atual for terminal (não regride KYC em diante).
 */
export function fsmStateToLeadStage(fsmState: string, currentStage: string): LeadStage | null {
  if (TERMINAL_STAGES.has(currentStage)) return null;
  return FSM_TO_STAGE[fsmState] ?? null;
}
