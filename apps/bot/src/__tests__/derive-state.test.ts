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

  it('sinal de visita com analise ja em andamento → collect_application, nao volta pro agendamento', () => {
    // Incidente real: lead ja tinha renda + CNH no banco e faltava so o morador.
    // Uma cutucada ("E aí?") foi lida como intencao de visita pelo extrator e
    // jogou o funil inteiro de volta pro agendamento.
    const state = deriveState({
      context: { visitedProperty: false },
      intent: 'visit',
      propertyInFocus: property,
      checklist: partialChecklist,
      hasScheduledVisit: false,
    });
    expect(state).toBe('lead.collect_application');
  });

  it('sinal de visita COM visita confirmada no banco → visit_requested mesmo com analise em andamento', () => {
    // A trava acima nao pode engolir quem tem visita marcada e pergunta sobre ela.
    const state = deriveState({
      context: { visitedProperty: false, wantsSchedule: true },
      intent: 'visit',
      propertyInFocus: property,
      checklist: partialChecklist,
      hasScheduledVisit: true,
    });
    expect(state).toBe('lead.visit_requested');
  });

  it('sem data confirmada no banco → continua scheduling (nunca "ja solicitada")', () => {
    // Regressão: o estado "ja agendado" tem que vir do banco (scheduledVisitAt).
    // O flag de sessão visitRequested, que travava em true e fazia o bot parar de
    // tentar agendar, foi removido — este teste garante que a decisão continua
    // vindo só do banco.
    const state = deriveState({
      context: { visitedProperty: false, wantsSchedule: true },
      intent: 'visit',
      propertyInFocus: property,
      checklist: emptyChecklist,
      hasScheduledVisit: false,
    });
    expect(state).toBe('lead.visit_scheduling');
  });
});
