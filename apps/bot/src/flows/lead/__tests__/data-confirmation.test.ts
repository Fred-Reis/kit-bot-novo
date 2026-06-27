import { describe, expect, test } from 'bun:test';
import { shouldTransitionToKyc, TERMINAL_STAGES } from '@/flows/lead/kyc';

describe('data_confirmation FSM behavior', () => {
  test('data_confirmation is in TERMINAL_STAGES (prevents regression)', () => {
    expect(TERMINAL_STAGES.has('data_confirmation')).toBe(true);
  });

  test('allows KYC transition from data_confirmation when confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', true)).toBe(true);
  });

  test('blocks KYC transition from data_confirmation when not confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', false)).toBe(false);
  });

  test('blocks KYC from kyc_pending even when confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'kyc_pending', true)).toBe(false);
  });

  test('blocks KYC from contract_pending even when confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'contract_pending', true)).toBe(false);
  });

  test('blocks KYC from converted', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'converted', true)).toBe(false);
  });
});
