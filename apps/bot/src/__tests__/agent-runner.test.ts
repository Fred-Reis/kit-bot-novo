import { describe, expect, it } from 'bun:test';
import { AIMessage, type BaseMessage, HumanMessage } from '@langchain/core/messages';
import { runToolAgent } from '@/agents/agent-runner';

function capturingLLM(response: AIMessage) {
  const calls: BaseMessage[][] = [];
  return {
    llm: {
      invoke: async (messages: BaseMessage[]) => {
        calls.push(messages);
        return response;
      },
    },
    calls,
  };
}

describe('runToolAgent', () => {
  it('inclui a data e hora atual na mensagem enviada ao modelo', async () => {
    const { llm, calls } = capturingLLM(new AIMessage('ok'));
    await runToolAgent('sistema', 'oi', 'ctx', [], [], llm);

    const lastMessage = calls[0].at(-1) as HumanMessage;
    expect(String(lastMessage.content)).toMatch(/Data e hora atual/);
  });
});
