// Port of services/lead_agent.py + chains.py + services/lead_router.py
// Uses LangChain JS: @langchain/openai + @langchain/core

import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { config } from '@/config';

import type { LeadContext, LeadResident } from '@/flows/lead/context';
import { getDeterministicLeadUpdates } from '@/flows/lead/intents';
import type { AgentName } from '@/flows/lead/rules';

// ─── Prompts (ported verbatim from prompts/lead_agents.py and prompts/lead_router.py) ──

const OPTIONS_AGENT_PROMPT = `Voce cuida apenas de apresentar opcoes disponiveis de imoveis para leads.

Regras ABSOLUTAS:
- Mencione APENAS os imoveis que aparecem em "Imoveis disponiveis no banco" no contexto do sistema. Nunca invente, sugira ou mencione imoveis que nao estejam nessa lista.
- Se a lista tiver apenas um imovel, apresente somente esse. Nunca invente outros.
- Se a lista estiver vazia, diga que nao ha imoveis disponiveis no momento.
- Seja cordial e objetivo.
- Se a pessoa apenas cumprimentar, responda somente com uma saudacao curta e educada, sem oferecer opcoes, sem perguntar por imovel especifico e sem conduzir para visita.
- Se ja houver um imovel em foco, nao volte a listar tudo sem necessidade.
- Se o contexto indicar que o imovel em foco esta travado, mantenha a conversa nele e nao ofereca outras opcoes sem pedido explicito.
- Se a pessoa mencionar bairro, referencia ou caracteristica, foque nisso.
- Nao peca renda nem documentos.
- Se a pessoa quiser visitar um imovel ja escolhido, oriente naturalmente para o proximo passo de visita.
- Nunca mencione URLs, links ou enderecos de midia no texto.`;

const INFO_AGENT_PROMPT = `Voce cuida apenas de responder duvidas sobre o imovel e sobre as condicoes da locacao.

Regras:
- Responda primeiro a pergunta atual da pessoa.
- Use apenas os fatos do contexto do sistema.
- Se a pessoa apenas cumprimentar, responda somente com uma saudacao curta e educada, como "Bom dia!" ou "Ola, tudo bem?", sem oferecer opcoes nem fazer pergunta de triagem.
- Pode responder sobre disponibilidade, valor, localizacao, regras, restricoes, estado do imovel e objecoes.
- Pode informar documentos/requisitos antes da visita quando a pessoa perguntar; isso e diferente de pedir que ela envie documentos.
- Nunca mencione URLs, links ou enderecos de midia no texto. O sistema envia midia automaticamente via WhatsApp quando disponivel.
- Se o contexto indicar que ha video ou foto cadastrada, responda apenas "estou enviando agora" ou "vou enviar em instantes". Nunca cole ou mencione a URL.
- Se a pessoa perguntar sobre o processo, explique usando exatamente o "Fluxo oficial da locacao" e a "Etapa oficial do processo agora" presentes no contexto.
- Nunca antecipe contrato, pagamento ou entrega das chaves como proximo passo se a etapa atual ainda for interesse, visita ou envio de documentacao para analise.
- Quando houver perguntas sobre taxas, caucao, contrato, regras, animais, moradores, midias, anuncio ou condicoes, responda apenas com os blocos "Imovel em foco" e "Condicoes factuais do imovel em foco".
- Nunca contradiga campos booleanos do contexto. Exemplo: se "Aceita animais: nao", a resposta deve ser nao.
- Se um fato nao estiver informado no contexto, diga que nao consta no sistema neste momento. Nunca use frases genericas como "geralmente", "normalmente", "pode haver" ou "depende do imovel" se houver um imovel em foco.
- Nao peca renda nem documentos.
- So sugira visita se a pessoa demonstrar interesse em visitar. Nao termine toda resposta oferecendo agendamento.
- Faca no maximo uma pergunta por vez.`;

const SCHEDULING_AGENT_PROMPT = `Voce cuida apenas do agendamento de visita.

Regras:
- Foque em visita, horario e disponibilidade.
- Se a pessoa disser que so quer ver o imovel, nao insista em renda nem documentos.
- Nao peca nome se a pessoa so pediu endereco, horario, dia disponivel ou quem procurar.
- Se a pessoa disser que ja visitou, nao tente reagendar; reconheca isso e devolva a conversa para o proximo passo natural da locacao.
- Nao entre em analise documental.
- Seja pratico, cordial e breve.`;

const COLLECTION_AGENT_PROMPT = `Voce cuida apenas da coleta de dados para analise do lead apos a visita.

Regras:
- Este agente so deve atuar quando o contexto indicar que o lead ja visitou o imovel e quer seguir.
- Se o estado atual for decisao apos visita, confirme se a pessoa quer seguir com a locacao e nao volte para visita.
- A etapa atual deste agente e sempre "envio de documentacao para analise".
- Nao fale que o proximo passo e contrato, pagamento ou entrega das chaves antes de confirmar que a documentacao foi enviada e seguira para analise.
- Colete apenas o proximo item pendente informado no contexto.
- Ordem da analise:
  1. nome completo
  2. renda mensal
  3. escolha documental entre CNH ou RG + CPF
  4. documentos
  5. moradores com nome, sexo e idade
- Na etapa documental:
  - CNH: frente e verso
  - RG + CPF: primeiro RG frente e verso, depois CPF
  - Se a pessoa responder apenas CPF ou apenas RG como escolha documental, interprete como RG + CPF
- Se os dados ja estiverem completos, apenas confirme que seguirao para analise.
- Seja objetivo e faca no maximo uma pergunta por vez.`;

const ROUTER_SYSTEM_PROMPT = `Voce e um roteador de atendimento para leads de locacao.

Escolha apenas um agente:
- options: quando a pessoa ainda nao sabe qual imovel quer, pede opcoes ou disponibilidade geral.
- info: quando a pessoa quer tirar duvidas, saber valor, regras, localizacao, detalhes do imovel ou tratar objecoes.
- scheduling: quando a pessoa quer visitar, negociar horario ou confirmar visita.
- collection: quando a pessoa ja visitou, quer seguir com a locacao e o assunto agora e coleta para analise.

Regras:
- Use o estado atual e os fatos do contexto.
- Se a pessoa ainda nao visitou, nunca escolha collection.
- Se o estado atual estiver em visita, prefira scheduling.
- Se o estado atual estiver em analise, prefira collection.
- Se houver um imovel em foco e a pessoa fizer uma pergunta sobre ele, prefira info.
- Se houver um imovel em foco travado, nao mande a conversa para options a menos que o usuario peca explicitamente outras opcoes.
- Respostas curtas como "sim", "quero", "pode ser" devem ser interpretadas com ajuda do contexto.`;

const EXTRACTOR_SYSTEM_PROMPT = `Voce extrai apenas dados estruturados explicitamente presentes na mensagem do lead.

Regras:
- Identifique a intencao principal atual do lead.
- Nunca invente informacoes ausentes.
- Use o contexto atual para interpretar respostas curtas como "sim", "quero", "pode ser", "cpf".
- "CPF" ou "RG" como resposta na etapa de escolha documental significa "rg_cpf".
- Se a pessoa disser "ja visitei", "ja vi", "ja conheco", "eu ja fui" ou equivalente, visited_property = true.
- "Vi uma quitinete alugando", "vi o anuncio", "vi esse numero", "peguei seu numero na OLX" ou equivalente significa que a pessoa viu o anuncio/contato, nao que visitou o imovel.
- visited_property = true apenas se a pessoa deixar claro que ja visitou o imovel.
- visited_property = false se a pessoa disser que ainda nao visitou, pedir visita ou negociar horario de visita.
- name_is_explicit = true quando a pessoa informar o nome claramente, inclusive em resposta direta a um pedido de nome.
- income_is_explicit = true apenas quando a pessoa informar renda, salario ou valor recebido por mes.
- wants_options = true quando a pessoa pedir opcoes, disponibilidade geral ou disser que ainda nao sabe qual imovel quer.
- wants_schedule = true quando a pessoa pedir visita, negociar horario ou demonstrar intencao de agendar visita.
- wants_application = true quando a pessoa indicar que quer seguir com a locacao ou com a analise.
- Residents so devem ser preenchidos quando a pessoa informar nome, sexo e idade dos moradores.
- Para property_interest: se a mensagem pede informacao, video, foto, visita ou qualquer dado sobre um imovel sem mencionar qual, e houver apenas um imovel na lista de disponiveis, preencha com o externalId desse imovel. Se houver mais de um e nao for possivel inferir, deixe null.`;

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const ResidentSchema = z.object({
  name: z.string(),
  sex: z.string(),
  age: z.number().int(),
});

const LeadExtractionSchema = z.object({
  intent: z
    .enum([
      'availability',
      'visit',
      'price_and_terms',
      'location',
      'property_details',
      'restrictions',
      'objection',
      'application',
      'options',
      'unknown',
    ])
    .default('unknown'),
  name: z.string().nullable().default(null),
  name_is_explicit: z.boolean().default(false),
  property_reference: z.string().nullable().default(null),
  property_interest: z.string().nullable().default(null),
  visited_property: z.boolean().nullable().default(null),
  income: z.string().nullable().default(null),
  income_is_explicit: z.boolean().default(false),
  document_choice: z.enum(['cnh', 'rg_cpf']).nullable().default(null),
  wants_options: z.boolean().default(false),
  wants_schedule: z.boolean().default(false),
  wants_application: z.boolean().default(false),
  residents: z.array(ResidentSchema).default([]),
  residents_complete: z.boolean().nullable().default(null),
  wants_pause: z.boolean().default(false),
  wants_human: z.boolean().default(false),
});

const RouterSchema = z.object({
  target_agent: z.enum(['options', 'info', 'scheduling', 'collection']).default('info'),
  reason: z.string().default(''),
});

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function normalizePropertyReference(value: string | null | undefined): string | null {
  const n = normalizeText(value);
  return n ? n.toUpperCase() : null;
}

function normalizeDocumentChoice(value: string | null | undefined): 'cnh' | 'rg_cpf' | null {
  const n = (normalizeText(value) ?? '').toLowerCase();
  if (['cnh', 'carteira'].includes(n)) return 'cnh';
  if (['rg_cpf', 'rg + cpf', 'rg+cpf', 'rg', 'cpf'].includes(n)) return 'rg_cpf';
  return null;
}

function normalizeResidents(
  raw: Array<{ name: string; sex: string; age: number }>,
): LeadResident[] {
  return raw
    .filter((r) => r.name?.trim() && r.sex?.trim() && typeof r.age === 'number')
    .map((r) => ({ name: r.name.trim(), sex: r.sex.trim().toLowerCase(), age: r.age }));
}

// ─── Extractor ────────────────────────────────────────────────────────────────

function makeLLM(maxTokens = 400) {
  return new ChatOpenAI({
    model: config.OPENAI_MODEL_NAME,
    temperature: 0,
    maxTokens,
    openAIApiKey: config.OPENAI_API_KEY,
  });
}

export async function extractLeadUpdate(
  message: string,
  context: LeadContext,
  availablePropertiesSummary?: string,
): Promise<Partial<LeadContext>> {
  const extractor = makeLLM(400).withStructuredOutput(LeadExtractionSchema);

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', EXTRACTOR_SYSTEM_PROMPT],
    [
      'human',
      'Contexto atual (JSON):\n{context}\n\nImóveis disponíveis no sistema:\n{available}\n\nMensagem do usuario:\n{message}',
    ],
  ]);

  const chain = prompt.pipe(extractor);

  let raw: z.infer<typeof LeadExtractionSchema>;
  try {
    raw = (await chain.invoke({
      message,
      context: JSON.stringify(context),
      available: availablePropertiesSummary ?? 'nao informado',
    })) as z.infer<typeof LeadExtractionSchema>;
  } catch (err) {
    console.error('[lead.agent] extractLeadUpdate failed:', err);
    return {};
  }

  const updates: Partial<LeadContext> = { currentIntent: raw.intent };

  const name = normalizeText(raw.name);
  if (raw.name_is_explicit && name) updates.name = name;

  const propertyReference = normalizePropertyReference(raw.property_reference);
  if (propertyReference) updates.propertyReference = propertyReference;

  const propertyInterest = normalizeText(raw.property_interest);
  if (propertyInterest) updates.propertyInterest = propertyInterest;

  if (typeof raw.visited_property === 'boolean') updates.visitedProperty = raw.visited_property;

  const income = normalizeText(raw.income);
  if (raw.income_is_explicit && income) updates.income = income;

  const docChoice = normalizeDocumentChoice(raw.document_choice);
  if (docChoice) updates.docsPreference = docChoice;

  if (raw.wants_options) updates.wantsOptions = true;
  if (raw.wants_schedule) updates.wantsSchedule = true;
  if (raw.wants_application) updates.wantsApplication = true;

  const residents = normalizeResidents(raw.residents);
  if (residents.length > 0) updates.residents = residents;

  if (typeof raw.residents_complete === 'boolean')
    updates.residentsComplete = raw.residents_complete;
  if (raw.wants_pause) updates.wantsPause = true;
  if (raw.wants_human) updates.wantsHuman = true;

  // Deterministic overrides always win over LLM extraction
  const deterministic = getDeterministicLeadUpdates(message);
  Object.assign(updates, deterministic);

  return updates;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export async function routeLeadMessage(question: string, leadContext: string): Promise<AgentName> {
  const router = makeLLM(200).withStructuredOutput(RouterSchema);

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', ROUTER_SYSTEM_PROMPT],
    ['human', 'Contexto do sistema:\n{lead_context}\n\nMensagem do usuario:\n{question}'],
  ]);

  const chain = prompt.pipe(router);

  try {
    const result = await chain.invoke({ question, lead_context: leadContext });
    return result.target_agent as AgentName;
  } catch (err) {
    console.error('[lead.agent] routeLeadMessage failed:', err);
    return 'info';
  }
}

// ─── Conversation agents ──────────────────────────────────────────────────────

const AGENT_PROMPTS: Record<AgentName, string> = {
  options: OPTIONS_AGENT_PROMPT,
  info: INFO_AGENT_PROMPT,
  scheduling: SCHEDULING_AGENT_PROMPT,
  collection: COLLECTION_AGENT_PROMPT,
};

export async function runLeadAgent(
  agent: AgentName,
  question: string,
  leadContext: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const systemPrompt = AGENT_PROMPTS[agent];

  const historyMessages = chatHistory.map((m) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content),
  );

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('chat_history'),
    ['human', 'Contexto do sistema:\n{lead_context}\n\nMensagem do usuario:\n{question}'],
  ]);

  const chain = prompt.pipe(makeLLM(600)).pipe(new StringOutputParser());

  try {
    return (await chain.invoke({
      question,
      lead_context: leadContext,
      chat_history: historyMessages,
    })) as string;
  } catch (err) {
    console.error(`[lead.agent] runLeadAgent(${agent}) failed:`, err);
    return 'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';
  }
}
