import { describe, expect, it } from 'bun:test';
import { fsmStateToLeadStage } from '../stage-map';

describe('fsmStateToLeadStage', () => {
  it('mapeia lead.visit_scheduling para visiting', () => {
    expect(fsmStateToLeadStage('lead.visit_scheduling', 'interest')).toBe('visiting');
  });

  it('mapeia lead.visit_requested para visiting', () => {
    expect(fsmStateToLeadStage('lead.visit_requested', 'interest')).toBe('visiting');
  });

  it('mapeia estados de informação para interest', () => {
    expect(fsmStateToLeadStage('lead.start', 'interest')).toBe('interest');
    expect(fsmStateToLeadStage('lead.property_info', 'interest')).toBe('interest');
    expect(fsmStateToLeadStage('lead.offer_options', 'interest')).toBe('interest');
    expect(fsmStateToLeadStage('lead.objection_handling', 'interest')).toBe('interest');
  });

  it('mapeia estados pós-visita para collection', () => {
    expect(fsmStateToLeadStage('lead.post_visit_decision', 'visiting')).toBe('collection');
    expect(fsmStateToLeadStage('lead.collect_application', 'visiting')).toBe('collection');
  });

  it('mapeia lead.review_submitted para review_submitted', () => {
    expect(fsmStateToLeadStage('lead.review_submitted', 'collection')).toBe('review_submitted');
  });

  it('retorna null para stage terminal (não regride kyc_pending)', () => {
    expect(fsmStateToLeadStage('lead.visit_scheduling', 'kyc_pending')).toBeNull();
    expect(fsmStateToLeadStage('lead.start', 'contract_signed')).toBeNull();
    expect(fsmStateToLeadStage('lead.property_info', 'converted')).toBeNull();
  });

  it('retorna null para estado FSM desconhecido', () => {
    expect(fsmStateToLeadStage('lead.unknown_state', 'interest')).toBeNull();
  });
});
