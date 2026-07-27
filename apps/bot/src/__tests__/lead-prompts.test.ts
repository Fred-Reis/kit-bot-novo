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
  test('instrui a responder "quem procurar" com o fato retornado por info_imovel', () => {
    expect(LEAD_AGENT_V2_PROMPT.toLowerCase()).toContain('responsavel pela visita');
  });
});
