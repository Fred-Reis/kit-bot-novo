import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { config } from '@/config';
import { logger } from '@/lib/logger';

export const MAX_TOOL_ROUNDS = 3;

export const FALLBACK_REPLY =
  'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';

export interface BoundLLM {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

export function makeDefaultLLM(tools: StructuredToolInterface[]): BoundLLM {
  const llm = new ChatOpenAI({
    model: config.OPENAI_MODEL_NAME,
    temperature: 0,
    maxTokens: 600,
    openAIApiKey: config.OPENAI_API_KEY,
  });
  return llm.bindTools(tools) as unknown as BoundLLM;
}

export async function runToolAgent(
  systemPrompt: string,
  question: string,
  contextStr: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM,
): Promise<string> {
  const bound = llm ?? makeDefaultLLM(tools);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...chatHistory.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
    new HumanMessage(`Contexto do sistema:\n${contextStr}\n\nMensagem do usuario:\n${question}`),
  ];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const ai = await bound.invoke(messages);

      if (!ai.tool_calls || ai.tool_calls.length === 0) {
        const content = typeof ai.content === 'string' ? ai.content.trim() : '';
        return content || FALLBACK_REPLY;
      }

      if (round === MAX_TOOL_ROUNDS) break;

      messages.push(ai);
      for (const call of ai.tool_calls) {
        const t = toolsByName.get(call.name);
        let result: string;
        try {
          result = t ? String(await t.invoke(call.args)) : `Erro: tool ${call.name} nao existe.`;
        } catch (err) {
          logger.error({ err, tool: call.name }, '[agent-runner] tool falhou');
          result = 'Erro: a tool falhou.';
        }
        messages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
      }
    }
  } catch (err) {
    logger.error({ err }, '[agent-runner] runner falhou');
  }

  return FALLBACK_REPLY;
}
