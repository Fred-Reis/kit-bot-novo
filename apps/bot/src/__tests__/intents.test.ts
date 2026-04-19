import { describe, expect, test } from 'bun:test';
import {
  normalizeIntentText,
  getSimpleGreetingReply,
  getDeterministicLeadUpdates,
} from '@/flows/lead/intents';

// ─── normalizeIntentText ──────────────────────────────────────────────────────

describe('normalizeIntentText', () => {
  test('lowercases and trims', () => {
    expect(normalizeIntentText('  OI  ')).toBe('oi');
  });

  test('strips diacritics', () => {
    expect(normalizeIntentText('Olá')).toBe('ola');
    expect(normalizeIntentText('situação')).toBe('situacao');
  });

  test('replaces punctuation with spaces and collapses them', () => {
    expect(normalizeIntentText('oi, tudo bem?')).toBe('oi tudo bem');
  });

  test('collapses multiple spaces', () => {
    expect(normalizeIntentText('bom   dia')).toBe('bom dia');
  });

  test('null/empty returns empty string', () => {
    expect(normalizeIntentText('')).toBe('');
  });
});

// ─── getSimpleGreetingReply ───────────────────────────────────────────────────

describe('getSimpleGreetingReply', () => {
  test('oi → Olá!', () => {
    expect(getSimpleGreetingReply('oi')).toBe('Olá!');
  });

  test('olá → Olá! (strips accent)', () => {
    expect(getSimpleGreetingReply('olá')).toBe('Olá!');
  });

  test('bom dia → Bom dia!', () => {
    expect(getSimpleGreetingReply('bom dia')).toBe('Bom dia!');
  });

  test('boa tarde → Boa tarde!', () => {
    expect(getSimpleGreetingReply('boa tarde')).toBe('Boa tarde!');
  });

  test('boa noite → Boa noite!', () => {
    expect(getSimpleGreetingReply('boa noite')).toBe('Boa noite!');
  });

  test('oi tudo bem → Olá!', () => {
    expect(getSimpleGreetingReply('oi tudo bem')).toBe('Olá!');
  });

  test('bom dia tudo bem → Bom dia!', () => {
    expect(getSimpleGreetingReply('bom dia tudo bem')).toBe('Bom dia!');
  });

  test('opa → Olá!', () => {
    expect(getSimpleGreetingReply('opa')).toBe('Olá!');
  });

  test('non-greeting returns null', () => {
    expect(getSimpleGreetingReply('quero alugar')).toBeNull();
    expect(getSimpleGreetingReply('qual o valor?')).toBeNull();
  });

  test('null input returns null', () => {
    expect(getSimpleGreetingReply(null)).toBeNull();
  });

  test('oi + non-small-talk does NOT trigger greeting', () => {
    expect(getSimpleGreetingReply('oi quero alugar')).toBeNull();
  });
});

// ─── getDeterministicLeadUpdates ─────────────────────────────────────────────

describe('getDeterministicLeadUpdates', () => {
  test('saw-ad term → visitedProperty: false', () => {
    expect(getDeterministicLeadUpdates('vi o anuncio')).toMatchObject({
      visitedProperty: false,
    });
  });

  test('peguei seu numero → visitedProperty: false', () => {
    expect(getDeterministicLeadUpdates('peguei seu numero no olx')).toMatchObject({
      visitedProperty: false,
    });
  });

  test('nao visitei → visitedProperty: false', () => {
    expect(getDeterministicLeadUpdates('ainda nao visitei')).toMatchObject({
      visitedProperty: false,
    });
  });

  test('quitinete mention → propertyInterest: quitinete', () => {
    expect(getDeterministicLeadUpdates('vi uma quitinete no anuncio')).toMatchObject({
      propertyInterest: 'quitinete',
    });
  });

  test('kitnet mention → propertyInterest: quitinete', () => {
    expect(getDeterministicLeadUpdates('quero alugar uma kitnet')).toMatchObject({
      propertyInterest: 'quitinete',
    });
  });

  test('details term → intent: price_and_terms, wantsSchedule: false', () => {
    const result = getDeterministicLeadUpdates('quais as exigencias?');
    expect(result).toMatchObject({ currentIntent: 'price_and_terms', wantsSchedule: false });
  });

  test('nao quero visitar → intent: property_details, wantsSchedule: false', () => {
    const result = getDeterministicLeadUpdates('nao quero visitar');
    expect(result).toMatchObject({ currentIntent: 'property_details', wantsSchedule: false });
  });

  test('unrelated message → empty object', () => {
    expect(getDeterministicLeadUpdates('qual o valor do aluguel?')).toEqual({});
  });

  test('null input → empty object', () => {
    expect(getDeterministicLeadUpdates(null)).toEqual({});
  });
});
