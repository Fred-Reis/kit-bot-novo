import { describe, expect, it } from 'bun:test';
import { ANALYSIS_SUBMITTED_STAGES, KYC_BLOCKER_STAGES } from '../kyc';

describe('ANALYSIS_SUBMITTED_STAGES', () => {
  it('cobre todos os stages de KYC em diante', () => {
    for (const stage of KYC_BLOCKER_STAGES) {
      expect(ANALYSIS_SUBMITTED_STAGES.has(stage)).toBe(true);
    }
  });

  it('inclui review_submitted (override manual do proprietario: "Docs enviados")', () => {
    expect(ANALYSIS_SUBMITTED_STAGES.has('review_submitted')).toBe(true);
  });

  it('NAO inclui data_confirmation — a confirmacao ainda precisa acontecer', () => {
    // data_confirmation está em TERMINAL_STAGES, mas tratá-lo como submetido
    // travaria o lead pra sempre: dataConfirmed só vira true dentro do bloco
    // de confirmação, que deixaria de ser alcançado.
    expect(ANALYSIS_SUBMITTED_STAGES.has('data_confirmation')).toBe(false);
  });

  it('NAO inclui os stages iniciais', () => {
    for (const stage of ['interest', 'visiting', 'collection']) {
      expect(ANALYSIS_SUBMITTED_STAGES.has(stage)).toBe(false);
    }
  });
});
