import { describe, expect, it } from 'bun:test';
import { buildChecklist } from '@/flows/lead/checklist';
import { buildIntakeReply } from '@/flows/lead/doc-intake';

const baseInput = {
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: 1,
  residentsCollected: 1,
  documents: [] as import('@/services/doc-classifier').LeadDocumentType[],
};

describe('buildIntakeReply', () => {
  it('confirma o que recebeu e diz o que falta', () => {
    const checklist = buildChecklist({ ...baseInput, documents: ['cnh_front'] });
    const reply = buildIntakeReply(['cnh_front'], [], 0, checklist);
    expect(reply).toContain('✅ Recebi: frente da CNH');
    expect(reply).toContain('verso da CNH');
  });

  it('identidade completa → celebra e mostra checklist', () => {
    const checklist = buildChecklist({ ...baseInput, documents: ['cnh_full'] });
    const reply = buildIntakeReply(['cnh_full'], [], 0, checklist);
    expect(reply).toContain('✅ Recebi: CNH completa (foto única)');
    expect(reply).toContain('Documentos de identidade completos');
  });

  it('duplicata → avisa sem pedir de novo', () => {
    const checklist = buildChecklist({ ...baseInput, documents: ['cnh_front'] });
    const reply = buildIntakeReply([], ['cnh_front'], 0, checklist);
    expect(reply).toContain('já tinha recebido a frente da CNH');
  });

  it('não identificado → pede foto melhor', () => {
    const checklist = buildChecklist({ ...baseInput, documents: [] });
    const reply = buildIntakeReply([], [], 1, checklist);
    expect(reply).toContain('não consegui identificar');
  });
});
