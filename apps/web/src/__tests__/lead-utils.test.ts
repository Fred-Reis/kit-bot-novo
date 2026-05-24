import { describe, test, expect } from 'vitest';
import { stageToColumn } from '@/lib/lead-utils';
import type { LeadStage } from '@kit-manager/types';

const ALL_STAGES: LeadStage[] = [
  'interest', 'collection', 'review_submitted', 'visiting',
  'kyc_pending', 'kyc_approved', 'residents_docs_complete',
  'contract_pending', 'contract_signed', 'converted',
];

describe('stageToColumn', () => {
  test('interest → novo', () => expect(stageToColumn('interest')).toBe('novo'));
  test('collection → qualificacao', () => expect(stageToColumn('collection')).toBe('qualificacao'));
  test('review_submitted → qualificacao', () => expect(stageToColumn('review_submitted')).toBe('qualificacao'));
  test('visiting → visita', () => expect(stageToColumn('visiting')).toBe('visita'));
  test('kyc_pending → proposta', () => expect(stageToColumn('kyc_pending')).toBe('proposta'));
  test('kyc_approved → proposta', () => expect(stageToColumn('kyc_approved')).toBe('proposta'));
  test('residents_docs_complete → proposta', () => expect(stageToColumn('residents_docs_complete')).toBe('proposta'));
  test('contract_pending → proposta', () => expect(stageToColumn('contract_pending')).toBe('proposta'));
  test('contract_signed → proposta', () => expect(stageToColumn('contract_signed')).toBe('proposta'));
  test('converted → ganho', () => expect(stageToColumn('converted')).toBe('ganho'));
  test('todos os 10 stages têm mapeamento', () => {
    for (const stage of ALL_STAGES) {
      expect(['novo', 'qualificacao', 'visita', 'proposta', 'ganho']).toContain(stageToColumn(stage));
    }
  });
});
