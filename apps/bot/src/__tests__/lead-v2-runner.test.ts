import { describe, expect, it } from 'bun:test';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runLeadAgentV2 } from '@/agents/lead-v2';

const echoTool = tool(async () => 'Status da análise:\n⬜ Renda', {
  name: 'status_checklist',
  description: 'x',
  schema: z.object({}),
});

function scriptedLLM(responses: AIMessage[]) {
  let i = 0;
  return {
    invoke: async (_messages: BaseMessage[]) => responses[Math.min(i++, responses.length - 1)],
  };
}

describe('runLeadAgentV2', () => {
  it('sem tool calls → devolve o texto direto', async () => {
    const llm = scriptedLLM([new AIMessage('Olá! Como posso ajudar?')]);
    const out = await runLeadAgentV2('oi', 'ctx', [], [echoTool], llm);
    expect(out).toBe('Olá! Como posso ajudar?');
  });

  it('com tool call → executa e usa o resultado na resposta final', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'status_checklist', args: {} }],
    });
    const final = new AIMessage('Falta a renda mensal. Pode me informar?');
    const llm = scriptedLLM([withCall, final]);
    const out = await runLeadAgentV2('o que falta?', 'ctx', [], [echoTool], llm);
    expect(out).toBe('Falta a renda mensal. Pode me informar?');
  });

  it('estoura o limite de rounds → fallback educado', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'status_checklist', args: {} }],
    });
    const llm = scriptedLLM([withCall, withCall, withCall, withCall]);
    const out = await runLeadAgentV2('?', 'ctx', [], [echoTool], llm);
    expect(out).toContain('tentar de novo');
  });
});
