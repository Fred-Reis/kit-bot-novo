import { describe, expect, test } from 'bun:test';
import {
  AUDIO_FALLBACK_REPLY,
  detectEmergency,
  EMERGENCY_REPLY,
  getTenantGreetingReply,
} from '@/flows/tenant/intents';

describe('getTenantGreetingReply', () => {
  test('oi + nome → saudação personalizada', () => {
    expect(getTenantGreetingReply('oi', 'Maria')).toBe('Olá, Maria!');
  });

  test('bom dia + nome → saudação personalizada', () => {
    expect(getTenantGreetingReply('bom dia', 'Maria')).toBe('Bom dia, Maria!');
  });

  test('saudação sem nome cadastrado → saudação genérica', () => {
    expect(getTenantGreetingReply('oi', null)).toBe('Olá!');
  });

  test('mensagem não é saudação → null', () => {
    expect(getTenantGreetingReply('o chuveiro queimou', 'Maria')).toBeNull();
  });

  test('mensagem vazia → null', () => {
    expect(getTenantGreetingReply(null, 'Maria')).toBeNull();
  });
});

describe('detectEmergency', () => {
  test('incêndio → true', () => {
    expect(detectEmergency('Socorro, tem um incêndio aqui!')).toBe(true);
  });

  test('cheiro de gás → true', () => {
    expect(detectEmergency('Estou sentindo cheiro de gás no apartamento')).toBe(true);
  });

  test('alagamento → true', () => {
    expect(detectEmergency('Houve um alagamento na cozinha')).toBe(true);
  });

  test('fogo → true', () => {
    expect(detectEmergency('Pegou fogo na tomada')).toBe(true);
  });

  test('mensagem normal → false', () => {
    expect(detectEmergency('Quando vence o aluguel?')).toBe(false);
  });

  test('null → false', () => {
    expect(detectEmergency(null)).toBe(false);
  });
});

describe('constantes de resposta', () => {
  test('EMERGENCY_REPLY orienta bombeiros/SAMU', () => {
    expect(EMERGENCY_REPLY).toContain('193');
  });

  test('AUDIO_FALLBACK_REPLY pede texto', () => {
    expect(AUDIO_FALLBACK_REPLY.length).toBeGreaterThan(0);
  });
});
