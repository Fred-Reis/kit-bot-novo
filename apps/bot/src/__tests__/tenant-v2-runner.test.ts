import { describe, expect, it } from 'bun:test';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { runTenantAgentV2 } from '@/agents/tenant-v2';

const escalarTool = tool(async () => 'Assunto encaminhado ao proprietário; o bot foi pausado.', {
  name: 'escalar_owner',
  description: 'x',
  schema: z.object({ motivo: z.string() }),
});

function scriptedLLM(responses: AIMessage[]) {
  let i = 0;
  return {
    invoke: async (_messages: BaseMessage[]) => responses[Math.min(i++, responses.length - 1)],
  };
}

describe('runTenantAgentV2', () => {
  it('sem tool calls → devolve o texto direto', async () => {
    const llm = scriptedLLM([new AIMessage('Olá! Em que posso ajudar?')]);
    const out = await runTenantAgentV2('oi', 'ctx', [], [escalarTool], llm);
    expect(out).toBe('Olá! Em que posso ajudar?');
  });

  it('com tool call → executa e usa o resultado na resposta final', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'escalar_owner', args: { motivo: 'negociação' } }],
    });
    const final = new AIMessage('Encaminhei ao proprietário, ele responde em breve.');
    const llm = scriptedLLM([withCall, final]);
    const out = await runTenantAgentV2('quero desconto', 'ctx', [], [escalarTool], llm);
    expect(out).toBe('Encaminhei ao proprietário, ele responde em breve.');
  });

  it('estoura o limite de rounds → fallback educado', async () => {
    const withCall = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'escalar_owner', args: { motivo: 'x' } }],
    });
    const llm = scriptedLLM([withCall, withCall, withCall, withCall]);
    const out = await runTenantAgentV2('?', 'ctx', [], [escalarTool], llm);
    expect(out).toContain('tentar de novo');
  });
});
