export const ACTION_LABELS: Record<string, string> = {
  lead_created: 'criou lead',
  lead_source_corrected: 'corrigiu origem do lead',
  bot_paused: 'pausou o bot',
  bot_resumed: 'retomou o bot',
  kyc_approved: 'aprovou KYC',
  contract_created: 'gerou contrato',
  contract_signed: 'assinou contrato',
  payment_confirmed: 'confirmou pagamento',
  payment_recorded: 'registrou pagamento',
  property_created: 'criou imóvel',
  property_archived: 'arquivou imóvel',
  tenant_created: 'criou inquilino',
  rule_set_created: 'criou conjunto de regras',
  rule_set_linked: 'vinculou regras ao imóvel',
  template_created: 'criou template',
  template_published: 'publicou template',
};

export function formatActivityLabel(action: string): string {
  if (!(action in ACTION_LABELS) && import.meta.env.DEV) {
    console.warn(`[activity-labels] unmapped action key: "${action}"`);
  }
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}
