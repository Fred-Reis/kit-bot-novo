import { describe, test, expect } from 'vitest';
import { ACTION_LABELS, formatActivityLabel } from '@/lib/activity-labels';

const KNOWN_KEYS = [
  'lead_created', 'lead_source_corrected', 'bot_paused', 'bot_resumed',
  'kyc_approved', 'contract_created', 'contract_signed', 'payment_confirmed',
  'payment_recorded', 'property_created', 'property_archived', 'tenant_created',
  'rule_set_created', 'rule_set_linked', 'template_created', 'template_published',
];

describe('ACTION_LABELS', () => {
  test('tem as 16 chaves esperadas', () => {
    for (const key of KNOWN_KEYS) {
      expect(ACTION_LABELS).toHaveProperty(key);
    }
  });

  test('todos os valores são strings não-vazias', () => {
    for (const val of Object.values(ACTION_LABELS)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});

describe('formatActivityLabel', () => {
  test('retorna label PT-BR para chave conhecida', () => {
    expect(formatActivityLabel('lead_created')).toBe('criou lead');
  });

  test('retorna fallback legível para chave desconhecida', () => {
    expect(formatActivityLabel('some_unknown_action')).toBe('some unknown action');
  });

  test('fallback substitui underscores por espaços', () => {
    expect(formatActivityLabel('foo_bar_baz')).toBe('foo bar baz');
  });
});
