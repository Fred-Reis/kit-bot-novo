import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { isVisitUpcoming, renderLeadContext, type LeadSnapshot } from '@/flows/lead/context';

const emptyChecklist = buildChecklist({
  name: null,
  declaredIncome: null,
  expectedResidents: null,
  residentsCollected: 0,
  documents: [],
});

const baseSnapshot: LeadSnapshot = {
  context: {},
  intent: 'unknown',
  name: null,
  propertyInFocus: null,
  propertyLocked: false,
  availableProperties: [],
  checklist: emptyChecklist,
  state: 'lead.visit_requested',
  stateGuidance: 'x',
  currentProcessStep: 'visita',
  scheduledVisitAt: null,
};

describe('isVisitUpcoming', () => {
  it('data no futuro → true', () => {
    expect(isVisitUpcoming(new Date(Date.now() + 60_000))).toBe(true);
  });

  it('data no passado → false', () => {
    expect(isVisitUpcoming(new Date(Date.now() - 60_000))).toBe(false);
  });

  it('null → false', () => {
    expect(isVisitUpcoming(null)).toBe(false);
  });
});

describe('renderLeadContext — status da visita', () => {
  it('sem visita agendada → menciona que nao ha data registrada', () => {
    const out = renderLeadContext({ ...baseSnapshot, scheduledVisitAt: null });
    expect(out).toContain('ainda NAO confirmada');
  });

  it('visita futura → CONFIRMADA, sem mencionar que ja passou', () => {
    const out = renderLeadContext({
      ...baseSnapshot,
      scheduledVisitAt: new Date(Date.now() + 60_000),
    });
    expect(out).toContain('CONFIRMADA');
    expect(out).not.toContain('ja passou');
  });

  it('visita no passado → usa "HAVIA" e instrui a oferecer remarcar, nunca "esta confirmada"', () => {
    const out = renderLeadContext({
      ...baseSnapshot,
      scheduledVisitAt: new Date(Date.now() - 60_000),
    });
    expect(out).toContain('HAVIA uma visita');
    expect(out).toContain('ja passou');
    expect(out).toContain('remarcar');
    expect(out).not.toContain('Visita CONFIRMADA');
  });
});
