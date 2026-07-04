import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { buildTransparencyReply } from '@/flows/lead/doc-intake';
import { detectDocContestation } from '@/flows/lead/intents';

describe('detectDocContestation', () => {
  it('detecta variações de "já enviei"', () => {
    expect(detectDocContestation('Eu já enviei')).toBe(true);
    expect(detectDocContestation('ja te mandei a CNH')).toBe(true);
    expect(detectDocContestation('Mandei sim, olha aí')).toBe(true);
  });
  it('não dispara em mensagens normais', () => {
    expect(detectDocContestation('vou enviar amanhã')).toBe(false);
    expect(detectDocContestation(null)).toBe(false);
  });
});

describe('buildTransparencyReply', () => {
  const checklist = buildChecklist({
    name: 'Frederico',
    declaredIncome: 12000,
    expectedResidents: 1,
    residentsCollected: 1,
    documents: ['cnh_front'],
  });

  it('sem docs no banco → diz que não recebeu nada', () => {
    const reply = buildTransparencyReply([], checklist);
    expect(reply).toContain('não recebi nenhum documento');
  });

  it('com docs → lista tipo e horário e o que falta', () => {
    const reply = buildTransparencyReply(
      [{ type: 'cnh_front', createdAt: new Date('2026-07-02T21:01:00-03:00') }],
      checklist,
    );
    expect(reply).toContain('frente da CNH');
    expect(reply).toContain('21:01');
    expect(reply).toContain('verso da CNH');
  });
});
