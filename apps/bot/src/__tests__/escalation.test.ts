import { describe, expect, it } from 'bun:test';
import {
  detectFrustration,
  isSameReply,
  nextFrustrationStrikes,
  shouldEscalateForFrustration,
} from '@/flows/lead/escalation';

describe('detectFrustration', () => {
  it('detecta ofensa', () => {
    expect(detectFrustration('Retardado, eu já enviei. Consegue entender?')).toBe(true);
    expect(detectFrustration('que bot lixo')).toBe(true);
  });
  it('não dispara em mensagem neutra', () => {
    expect(detectFrustration('pode me mandar o endereço?')).toBe(false);
    expect(detectFrustration(null)).toBe(false);
  });
});

describe('isSameReply', () => {
  it('mesma resposta com pontuação/caixa diferente → true', () => {
    expect(
      isSameReply('Entendi, Frederico. Precisamos avançar!', 'entendi frederico precisamos avancar'),
    ).toBe(true);
  });
  it('respostas diferentes → false', () => {
    expect(isSameReply('Bom dia!', 'A visita foi confirmada.')).toBe(false);
  });
  it('null nunca é igual', () => {
    expect(isSameReply(null, null)).toBe(false);
  });
});

describe('nextFrustrationStrikes / shouldEscalateForFrustration', () => {
  // Achado real: o bot escalava (pausava e transferia) na PRIMEIRA vez que o
  // lead xingava, mesmo quando o motivo era um erro do bot que dava pra
  // corrigir na hora. "Desativar e transferir e ultimo recurso, nao a
  // primeira reacao" — precisa de uma chance de resolver antes de escalar.
  it('1ª frustração → 1 strike, ainda nao escala', () => {
    const strikes = nextFrustrationStrikes(undefined, true);
    expect(strikes).toBe(1);
    expect(shouldEscalateForFrustration(strikes)).toBe(false);
  });

  it('2ª frustração seguida → 2 strikes, escala', () => {
    const strikes = nextFrustrationStrikes(1, true);
    expect(strikes).toBe(2);
    expect(shouldEscalateForFrustration(strikes)).toBe(true);
  });

  it('turno sem frustração zera a contagem (lead esfriou)', () => {
    expect(nextFrustrationStrikes(1, false)).toBe(0);
  });

  it('sem frustração desde o início → 0, nunca escala', () => {
    const strikes = nextFrustrationStrikes(undefined, false);
    expect(strikes).toBe(0);
    expect(shouldEscalateForFrustration(strikes)).toBe(false);
  });
});
