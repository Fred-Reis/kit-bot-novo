import { describe, expect, test } from 'bun:test';
import { LeadExtractionSchema } from '@/agents/lead';

describe('LeadExtractionSchema — campo source', () => {
  test('aceita source válido olx', () => {
    const result = LeadExtractionSchema.parse({ source: 'olx' });
    expect(result.source).toBe('olx');
  });

  test('aceita todos os valores válidos', () => {
    const valid = [
      'olx',
      'zap',
      'site',
      'instagram',
      'indicacao',
      'outro',
      'desconhecido',
    ] as const;
    for (const v of valid) {
      expect(LeadExtractionSchema.parse({ source: v }).source).toBe(v);
    }
  });

  test('source é null por default quando ausente', () => {
    const result = LeadExtractionSchema.parse({});
    expect(result.source).toBeNull();
  });

  test('rejeita source inválido', () => {
    expect(() => LeadExtractionSchema.parse({ source: 'facebook' })).toThrow();
  });

  test('aceita source null explícito', () => {
    const result = LeadExtractionSchema.parse({ source: null });
    expect(result.source).toBeNull();
  });
});
