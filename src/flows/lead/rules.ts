// Port of services/lead_rules.py

export type AgentName = 'options' | 'info' | 'scheduling' | 'collection';

export function resolveTargetAgent(state: string, routedAgent: AgentName): AgentName {
  if (state === 'lead.offer_options') return 'options';
  if (state === 'lead.visit_scheduling' || state === 'lead.visit_requested') return 'scheduling';
  if (
    state === 'lead.post_visit_decision' ||
    state === 'lead.collect_application' ||
    state === 'lead.review_submitted'
  )
    return 'collection';
  if (state === 'lead.objection_handling') return 'info';
  return routedAgent;
}
