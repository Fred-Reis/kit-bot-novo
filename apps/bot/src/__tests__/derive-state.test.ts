import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { deriveState } from '@/flows/lead/context';

const completeChecklist = buildChecklist({
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: 1,
  residentsCollected: 1,
  documents: ['cnh_full'],
});

const emptyChecklist = buildChecklist({
  name: null,
  declaredIncome: null,
  expectedResidents: null,
  residentsCollected: 0,
  documents: [],
});

const partialChecklist = buildChecklist({
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: null,
  residentsCollected: 0,
  documents: ['cnh_front'],
});

const property = { id: 'p1' } as never;

describe('deriveState com checklist', () => {
  it('checklist com progresso → collect_application mesmo SEM visita', () => {
    const state = deriveState({
      context: { visitedProperty: null },
      intent: 'unknown',
      propertyInFocus: property,
      checklist: partialChecklist,
    });
    expect(state).toBe('lead.collect_application');
  });

  it('checklist completo sem confirmação → data_confirmation', () => {
    const state = deriveState({
      context: { visitedProperty: null },
      intent: 'unknown',
      propertyInFocus: property,
      checklist: completeChecklist,
    });
    expect(state).toBe('lead.data_confirmation');
  });

  it('sem progresso e sem visita → property_info', () => {
    const state = deriveState({
      context: { visitedProperty: null },
      intent: 'unknown',
      propertyInFocus: property,
      checklist: emptyChecklist,
    });
    expect(state).toBe('lead.property_info');
  });

  it('pedido de visita → scheduling (visita continua opcional mas atendida)', () => {
    const state = deriveState({
      context: { visitedProperty: false, wantsSchedule: true },
      intent: 'visit',
      propertyInFocus: property,
      checklist: emptyChecklist,
    });
    expect(state).toBe('lead.visit_scheduling');
  });

  it('visita ja confirmada no banco (hasScheduledVisit) → visit_requested', () => {
    const state = deriveState({
      context: { visitedProperty: false, wantsSchedule: true },
      intent: 'visit',
      propertyInFocus: property,
      checklist: emptyChecklist,
      hasScheduledVisit: true,
    });
    expect(state).toBe('lead.visit_requested');
  });

  it('context.visitRequested preso em true (turno antigo) mas SEM data confirmada no banco → continua scheduling', () => {
    // Regressão: visitRequested é um flag de sessão que fica travado em true
    // depois do primeiro "quero marcar visita" e nunca mais reseta sozinho.
    // O estado real de "ja esta agendado" tem que vir do banco (scheduledVisitAt),
    // senão o bot para de tentar agendar mesmo sem nenhuma data confirmada.
    const state = deriveState({
      context: { visitedProperty: false, wantsSchedule: true, visitRequested: true },
      intent: 'visit',
      propertyInFocus: property,
      checklist: emptyChecklist,
      hasScheduledVisit: false,
    });
    expect(state).toBe('lead.visit_scheduling');
  });
});
