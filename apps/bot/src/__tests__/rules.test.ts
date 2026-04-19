import { describe, expect, test } from 'bun:test';
import { resolveTargetAgent } from '@/flows/lead/rules';
import type { AgentName } from '@/flows/lead/rules';

describe('resolveTargetAgent', () => {
  test('lead.offer_options always → options', () => {
    expect(resolveTargetAgent('lead.offer_options', 'info')).toBe('options');
    expect(resolveTargetAgent('lead.offer_options', 'collection')).toBe('options');
  });

  test('lead.visit_scheduling → scheduling', () => {
    expect(resolveTargetAgent('lead.visit_scheduling', 'info')).toBe('scheduling');
  });

  test('lead.visit_requested → scheduling', () => {
    expect(resolveTargetAgent('lead.visit_requested', 'collection')).toBe('scheduling');
  });

  test('lead.post_visit_decision → collection', () => {
    expect(resolveTargetAgent('lead.post_visit_decision', 'info')).toBe('collection');
  });

  test('lead.collect_application → collection', () => {
    expect(resolveTargetAgent('lead.collect_application', 'scheduling')).toBe('collection');
  });

  test('lead.review_submitted → collection', () => {
    expect(resolveTargetAgent('lead.review_submitted', 'options')).toBe('collection');
  });

  test('lead.objection_handling → info', () => {
    expect(resolveTargetAgent('lead.objection_handling', 'scheduling')).toBe('info');
  });

  test('unknown state → falls back to routedAgent', () => {
    const agents: AgentName[] = ['options', 'info', 'scheduling', 'collection'];
    for (const agent of agents) {
      expect(resolveTargetAgent('lead.start', agent)).toBe(agent);
      expect(resolveTargetAgent('lead.property_info', agent)).toBe(agent);
    }
  });
});
