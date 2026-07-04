import { describe, expect, it } from 'bun:test';
import { detectFrustration, isSameReply } from '@/flows/lead/escalation';

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
