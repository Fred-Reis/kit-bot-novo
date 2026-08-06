import { describe, expect, test } from 'bun:test';
import { EXTRACTOR_SYSTEM_PROMPT } from '@/agents/lead';
import { LEAD_AGENT_V2_PROMPT } from '@/agents/lead-v2';

describe('EXTRACTOR_SYSTEM_PROMPT — wants_human guardrail', () => {
  test('tem regra explícita de quando wants_human deve ser true', () => {
    expect(EXTRACTOR_SYSTEM_PROMPT).toMatch(/wants_human = true APENAS/);
  });

  test('explicita que perguntas ambíguas não configuram wants_human', () => {
    expect(EXTRACTOR_SYSTEM_PROMPT.toLowerCase()).toContain('nao configuram wants_human');
  });
});

describe('LEAD_AGENT_V2_PROMPT — fato do responsável pela visita', () => {
  const prompt = LEAD_AGENT_V2_PROMPT.toLowerCase();

  test('instrui a responder "quem procurar" com o fato retornado por info_imovel', () => {
    expect(prompt).toContain('responsavel pela visita');
    expect(prompt).toContain('info_imovel');
  });

  test('distingue falha da tool de ausência do fato', () => {
    expect(prompt).toContain('se a tool retornar erro');
    expect(prompt).toContain('nao ha responsavel especifico cadastrado');
  });

  test('nunca inventar nome ou telefone', () => {
    expect(prompt).toContain('nunca invente nome ou telefone');
  });
});

describe('LEAD_AGENT_V2_PROMPT — registro de moradores', () => {
  const prompt = LEAD_AGENT_V2_PROMPT.toLowerCase();

  test('deixa claro que informar so o total nao completa o cadastro', () => {
    expect(prompt).toContain('nao basta');
  });

  test('instrui a usar o nome ja conhecido quando o lead mora sozinho', () => {
    expect(prompt).toMatch(/somente eu|so eu|sozinho/);
    expect(prompt).toContain('nome ja conhecido');
  });
});
