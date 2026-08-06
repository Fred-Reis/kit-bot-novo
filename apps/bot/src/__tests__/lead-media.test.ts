import { describe, expect, it } from 'bun:test';
import { getRequestedMediaType, shouldClearRequestedMediaType } from '@/flows/lead/media';

describe('shouldClearRequestedMediaType', () => {
  // Regressão: sem isto, um pedido de vídeo sem vídeo cadastrado ficava preso
  // em lastRequestedMediaType pra sempre, e uma confirmação futura sem relação
  // ("pode mandar" sobre outro assunto) resgatava o pedido velho por engano.
  it('pedido feito, nada encontrado → limpa', () => {
    expect(shouldClearRequestedMediaType('video', null)).toBe(true);
  });

  it('pedido feito, algo encontrado → mantém (o envio bem-sucedido já limpa em outro ponto)', () => {
    expect(shouldClearRequestedMediaType('video', { type: 'video' })).toBe(false);
  });

  it('nenhum pedido nesta mensagem → não mexe (pode ser confirmação pendente de turno anterior)', () => {
    expect(shouldClearRequestedMediaType(null, null)).toBe(false);
  });
});

describe('getRequestedMediaType — drift do pedido resgatado por engano (documentação do cenário real)', () => {
  it('confirmação avulsa sem pedido anterior não resgata nada', () => {
    expect(getRequestedMediaType('pode mandar', {})).toBeNull();
  });

  it('com lastRequestedMediaType ainda preso, confirmação avulsa resgata o tipo antigo', () => {
    // Isto é esperado — é exatamente por isso que limpar o flag na hora certa
    // (shouldClearRequestedMediaType) importa: esta função não tem como saber
    // se o pedido "antigo" ainda faz sentido.
    expect(getRequestedMediaType('pode mandar', { lastRequestedMediaType: 'video' })).toBe(
      'video',
    );
  });
});
