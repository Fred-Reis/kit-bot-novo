import { describe, expect, it } from 'bun:test';
import { buildChecklist, renderChecklistText } from '@/flows/lead/checklist';

const base = {
  name: 'Frederico',
  declaredIncome: 12000,
  expectedResidents: 2,
  residentsCollected: 2,
  documents: [] as import('@/services/doc-classifier').LeadDocumentType[],
};

describe('buildChecklist — identidade', () => {
  it('cnh_full sozinha completa identidade', () => {
    const s = buildChecklist({ ...base, documents: ['cnh_full'] });
    expect(s.identity.complete).toBe(true);
    expect(s.complete).toBe(true);
  });

  it('cnh_front + cnh_back completa identidade', () => {
    const s = buildChecklist({ ...base, documents: ['cnh_front', 'cnh_back'] });
    expect(s.identity.complete).toBe(true);
  });

  it('rg_front + rg_back + cpf completa identidade', () => {
    const s = buildChecklist({ ...base, documents: ['rg_front', 'rg_back', 'cpf'] });
    expect(s.identity.complete).toBe(true);
  });

  it('só cnh_front → falta o verso', () => {
    const s = buildChecklist({ ...base, documents: ['cnh_front'] });
    expect(s.identity.complete).toBe(false);
    expect(s.identity.missing).toEqual(['verso da CNH']);
  });

  it('rg_back + cpf → falta frente do RG', () => {
    const s = buildChecklist({ ...base, documents: ['rg_back', 'cpf'] });
    expect(s.identity.missing).toEqual(['frente do RG']);
  });

  it('nenhum doc → pede CNH ou RG+CPF', () => {
    const s = buildChecklist({ ...base, documents: [] });
    expect(s.identity.missing).toEqual(['CNH (frente e verso, ou foto única aberta) ou RG + CPF']);
  });

  it('unknown não conta', () => {
    const s = buildChecklist({ ...base, documents: ['unknown', 'unknown'] });
    expect(s.identity.complete).toBe(false);
  });
});

describe('buildChecklist — renda e moradores', () => {
  it('sem renda declarada → income false e checklist incompleto', () => {
    const s = buildChecklist({ ...base, declaredIncome: null, documents: ['cnh_full'] });
    expect(s.income).toBe(false);
    expect(s.complete).toBe(false);
  });

  it('moradores: expected null → incompleto', () => {
    const s = buildChecklist({ ...base, expectedResidents: null, residentsCollected: 0, documents: ['cnh_full'] });
    expect(s.residents.complete).toBe(false);
  });

  it('moradores: coletados < esperados → incompleto', () => {
    const s = buildChecklist({ ...base, expectedResidents: 3, residentsCollected: 1, documents: ['cnh_full'] });
    expect(s.residents.complete).toBe(false);
    expect(s.complete).toBe(false);
  });

  it('moradores: expected = 0 e collected = 0 → completo', () => {
    const s = buildChecklist({ ...base, expectedResidents: 0, residentsCollected: 0, documents: ['cnh_full'] });
    expect(s.residents.complete).toBe(true);
  });
});

describe('renderChecklistText', () => {
  it('mostra pendências com ⬜ e completos com ✅', () => {
    const s = buildChecklist({ ...base, declaredIncome: null, documents: ['cnh_front'] });
    const text = renderChecklistText(s);
    expect(text).toContain('⬜ Renda');
    expect(text).toContain('⬜ Documento de identidade (falta: verso da CNH)');
    expect(text).toContain('✅ Moradores');
  });
});
