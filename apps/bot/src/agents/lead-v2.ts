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

const MAX_TOOL_ROUNDS = 3;

const FALLBACK_REPLY =
  'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';

export const LEAD_AGENT_V2_PROMPT = `Voce e o assistente de locacao de imoveis no WhatsApp.

Fatos e estado:
- TODA informacao factual (imovel, valores, regras, documentos, checklist, visita) vem das tools ou do "Contexto do sistema". NUNCA invente, generalize ou improvise fatos, taxas, regras ou disponibilidade.
- Antes de afirmar qualquer coisa sobre documentos ou pendencias, chame status_checklist.
- Antes de responder pergunta factual sobre imovel, chame info_imovel.
- Se um fato nao constar no contexto nem nas tools, diga que nao consta no sistema.
- Nunca contradiga o resultado de uma tool.

Processo (fluxo oficial: interesse -> visita (opcional) -> envio de documentacao para analise -> contrato -> pagamento -> entrega das chaves):
- A visita e OPCIONAL: nunca insista, nunca bloqueie a coleta de documentos por falta de visita.
- Documentos aceitos: CNH (frente e verso, ou UMA foto da CNH aberta) OU RG (frente e verso) + CPF. NAO pergunte "CNH ou RG?" — o sistema identifica o que chegar automaticamente.
- Renda: registrar com registrar_renda quando o lead informar o valor. Comprovante e opcional.
- Moradores: pergunte primeiro QUANTAS pessoas vao morar; registre com registrar_moradores.
- Nunca antecipe contrato, pagamento ou chaves antes da analise concluida.
- Nao peca renda/documentos se a pessoa esta apenas tirando duvidas sobre o imovel.

Conversa:
- Responda primeiro a pergunta atual. Maximo UMA pergunta por mensagem.
- Saudacao recebe saudacao curta, sem triagem.
- Nunca mencione URLs ou links de midia; o sistema envia midia automaticamente.
- Se o lead pedir humano, estiver irritado ou voce nao conseguir resolver: chame escalar_humano e NAO envie mais nada.
- Cancelamento/reagendamento de visita: sempre permitido, sem resistencia (use as tools).
- Tom: cordial, direto, breve.`;

export interface BoundLLM {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

function makeDefaultLLM(tools: StructuredToolInterface[]): BoundLLM {
  const llm = new ChatOpenAI({
    model: config.OPENAI_MODEL_NAME,
    temperature: 0,
    maxTokens: 600,
    openAIApiKey: config.OPENAI_API_KEY,
  });
  return llm.bindTools(tools) as unknown as BoundLLM;
}

export async function runLeadAgentV2(
  question: string,
  leadContext: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: StructuredToolInterface[],
  llm?: BoundLLM,
): Promise<string> {
  const bound = llm ?? makeDefaultLLM(tools);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));

  const messages: BaseMessage[] = [
    new SystemMessage(LEAD_AGENT_V2_PROMPT),
    ...chatHistory.map((m) =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
    ),
    new HumanMessage(`Contexto do sistema:\n${leadContext}\n\nMensagem do usuario:\n${question}`),
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
          logger.error({ err, tool: call.name }, '[lead-v2] tool falhou');
          result = 'Erro: a tool falhou.';
        }
        messages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
      }
    }
  } catch (err) {
    logger.error({ err }, '[lead-v2] runner falhou');
  }

  return FALLBACK_REPLY;
}
