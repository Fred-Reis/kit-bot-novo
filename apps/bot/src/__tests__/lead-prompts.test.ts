import { describe, expect, test } from 'bun:test';
import { EXTRACTOR_SYSTEM_PROMPT, INFO_AGENT_PROMPT, SCHEDULING_AGENT_PROMPT } from '@/agents/lead';

describe('EXTRACTOR_SYSTEM_PROMPT — wants_human guardrail', () => {
  test('tem regra explícita de quando wants_human deve ser true', () => {
    expect(EXTRACTOR_SYSTEM_PROMPT).toMatch(/wants_human = true APENAS/);
  });

  test('explicita que perguntas ambíguas não configuram wants_human', () => {
    expect(EXTRACTOR_SYSTEM_PROMPT.toLowerCase()).toContain('nao configuram wants_human');
  });
});

describe('prompts de agente — fato do responsável pela visita', () => {
  test('INFO_AGENT_PROMPT instrui a responder "quem procurar" com o fato do contexto', () => {
    expect(INFO_AGENT_PROMPT.toLowerCase()).toContain('responsavel pela visita');
  });

  test('SCHEDULING_AGENT_PROMPT instrui a responder "quem procurar" com o fato do contexto', () => {
    expect(SCHEDULING_AGENT_PROMPT.toLowerCase()).toContain('responsavel pela visita');
  });
});
