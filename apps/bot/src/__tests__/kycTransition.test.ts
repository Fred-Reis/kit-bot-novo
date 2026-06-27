import { describe, expect, test } from 'bun:test';
import {
  KYC_BLOCKER_STAGES,
  shouldTransitionToKyc,
  shouldUpdateLeadSource,
  TERMINAL_STAGES,
} from '@/flows/lead/kyc';

describe('shouldTransitionToKyc', () => {
  test('transitions when all conditions met (interest)', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'interest', true)).toBe(true);
  });

  test('transitions when stage is collection', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'collection', true)).toBe(true);
  });

  test('transitions when stage is visiting', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'visiting', true)).toBe(true);
  });

  test('does not transition when residents array is empty', () => {
    expect(shouldTransitionToKyc('complete', 0, true, 'interest', true)).toBe(false);
  });

  test('does not transition when residentsComplete is false', () => {
    expect(shouldTransitionToKyc('complete', 2, false, 'interest', true)).toBe(false);
  });

  test('does not transition when docs not complete', () => {
    expect(shouldTransitionToKyc('cnh_images', 1, true, 'interest', true)).toBe(false);
  });

  for (const stage of KYC_BLOCKER_STAGES) {
    test(`does not re-transition when stage is already ${stage}`, () => {
      expect(shouldTransitionToKyc('complete', 1, true, stage, true)).toBe(false);
    });
  }

  test('does not transition when dataConfirmed is false', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'interest', false)).toBe(false);
  });

  test('transitions from data_confirmation when dataConfirmed is true', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', true)).toBe(true);
  });

  test('does not transition from data_confirmation when dataConfirmed is false', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', false)).toBe(false);
  });
});

describe('shouldUpdateLeadSource', () => {
  test('updates when source is null', () => {
    expect(shouldUpdateLeadSource(null, 'olx')).toBe(true);
  });

  test('updates when source is undefined', () => {
    expect(shouldUpdateLeadSource(undefined, 'olx')).toBe(true);
  });

  test('updates when source is default whatsapp', () => {
    expect(shouldUpdateLeadSource('whatsapp', 'zap')).toBe(true);
  });

  test('does not overwrite manual correction', () => {
    expect(shouldUpdateLeadSource('olx', 'zap')).toBe(false);
  });

  test('does not overwrite any non-whatsapp source', () => {
    for (const src of ['site', 'instagram', 'indicacao', 'outro']) {
      expect(shouldUpdateLeadSource(src, 'olx')).toBe(false);
    }
  });

  test('does not update when extractedSource is null', () => {
    expect(shouldUpdateLeadSource(null, null)).toBe(false);
  });

  test('does not update when extractedSource is desconhecido', () => {
    expect(shouldUpdateLeadSource(null, 'desconhecido')).toBe(false);
  });

  test('treats desconhecido current source as a manually-set value (admin-only correction)', () => {
    expect(shouldUpdateLeadSource('desconhecido', 'olx')).toBe(false);
  });
});

test('TERMINAL_STAGES includes data_confirmation', () => {
  expect(TERMINAL_STAGES.has('data_confirmation')).toBe(true);
});
