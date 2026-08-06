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

describe('expected_residents', () => {
  test('aceita quantidade de moradores', () => {
    const parsed = LeadExtractionSchema.parse({ expected_residents: 3 });
    expect(parsed.expected_residents).toBe(3);
  });
  test('default null', () => {
    const parsed = LeadExtractionSchema.parse({});
    expect(parsed.expected_residents).toBeNull();
  });
});

describe('sexo/idade — campo dedicado pra resposta de sexo/idade nao virar "name"', () => {
  // Achado real: sem um campo proprio no schema, "Feminino 42" (resposta a
  // "informe seu sexo e idade") foi classificado como name_is_explicit=true —
  // o unico campo de texto livre sobre a pessoa que sobrou no schema era
  // `name`. sexo/idade existem pra dar ao modelo um lugar correto, mas
  // extractLeadUpdate nunca le raw.sexo/raw.idade pra dentro de `updates` —
  // quem grava de fato e' a tool registrar_moradores.
  test('aceita sexo e idade', () => {
    const parsed = LeadExtractionSchema.parse({ sexo: 'feminino', idade: 42 });
    expect(parsed.sexo).toBe('feminino');
    expect(parsed.idade).toBe(42);
  });

  test('default null quando ausentes', () => {
    const parsed = LeadExtractionSchema.parse({});
    expect(parsed.sexo).toBeNull();
    expect(parsed.idade).toBeNull();
  });
});
