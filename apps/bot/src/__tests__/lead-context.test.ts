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

// Espelha o estado real do lead no smoke test que gerou este teste:
// renda declarada, CNH recebida, 1 morador esperado e nenhum cadastrado.
const incidentChecklist = buildChecklist({
  name: 'Aline',
  declaredIncome: 4000,
  expectedResidents: 1,
  residentsCollected: 0,
  documents: ['cnh_full'],
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
    expect(out).toContain('Nenhuma visita agendada no banco');
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

  it('sem visita agendada → texto neutro, sem enquadrar agendamento como pendencia', () => {
    const out = renderLeadContext({ ...baseSnapshot, scheduledVisitAt: null });
    // "ainda NAO confirmada" enquadra a visita como tarefa pendente e empurra
    // o agente a oferecer agendamento — contradiz "a visita e OPCIONAL".
    expect(out).not.toContain('ainda NAO confirmada');
    expect(out.toLowerCase()).toContain('opcional');
  });
});

describe('renderLeadContext — checklist sempre visivel (fato do banco)', () => {
  it('estado de agendamento com progresso na analise → checklist continua no contexto', () => {
    const out = renderLeadContext({
      ...baseSnapshot,
      state: 'lead.visit_scheduling',
      checklist: incidentChecklist,
    });
    // O agente precisa saber onde o funil parou mesmo enquanto agenda visita —
    // esconder isso foi o que fez ele reiniciar o processo do zero no smoke test.
    expect(out).toContain('Checklist da analise');
    expect(out).toContain('Renda declarada: ok');
    expect(out).toContain('Identidade: completa');
  });

  it('estado de agendamento → nao apaga os fatos, so restringe a iniciativa de cobrar', () => {
    const out = renderLeadContext({
      ...baseSnapshot,
      state: 'lead.visit_scheduling',
      checklist: incidentChecklist,
    });
    expect(out).toContain('por iniciativa propria');
    expect(out).not.toContain('Nao peca renda, documentos ou moradores nesta etapa.');
  });

  it('estado de coleta → checklist presente (comportamento preexistente preservado)', () => {
    const out = renderLeadContext({
      ...baseSnapshot,
      state: 'lead.collect_application',
      checklist: incidentChecklist,
    });
    expect(out).toContain('Checklist da analise');
    expect(out).toContain('Analise submetida:');
  });
});
