// Port of services/lead_agent.py + chains.py + services/lead_router.py
// Uses LangChain JS: @langchain/openai + @langchain/core

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { config } from '@/config';
import type { LeadContext } from '@/flows/lead/context';
import { getDeterministicLeadUpdates } from '@/flows/lead/intents';
import { logger } from '@/lib/logger';

export const EXTRACTOR_SYSTEM_PROMPT = `Voce extrai apenas dados estruturados explicitamente presentes na mensagem do lead.

Regras:
- Identifique a intencao principal atual do lead.
- Nunca invente informacoes ausentes.
- Use a ultima mensagem do bot para interpretar respostas curtas como "sim", "quero", "pode ser", "cpf".
- Cutucadas sem conteudo: quando a mensagem INTEIRA for so "e ai", "oi", "opa", "alo", "e entao", "tudo bem?", "?" ou so emoji, o lead esta apenas chamando atencao. Nesse caso intent = "unknown" e NAO preencha wants_schedule, wants_application, wants_options nem visited_property — nem que os fatos conhecidos sugiram alguma etapa. Isso NAO vale para respostas curtas afirmativas ("sim", "quero", "pode ser"), que continuam sendo interpretadas normalmente.
- "CPF" ou "RG" como resposta na etapa de escolha documental significa "rg_cpf".
- Se a pessoa disser "ja visitei", "ja vi", "ja conheco", "eu ja fui" ou equivalente, visited_property = true.
- "Vi uma quitinete alugando", "vi o anuncio", "vi esse numero", "peguei seu numero na OLX" ou equivalente significa que a pessoa viu o anuncio/contato, nao que visitou o imovel.
- visited_property = true apenas se a pessoa deixar claro que ja visitou o imovel.
- visited_property = false se a pessoa disser que ainda nao visitou, pedir visita ou negociar horario de visita.
- name_is_explicit = true quando a pessoa informar o nome claramente, inclusive em resposta direta a um pedido de nome.
- wants_options = true quando a pessoa pedir opcoes, disponibilidade geral ou disser que ainda nao sabe qual imovel quer.
- wants_schedule = true quando a pessoa pedir visita, negociar horario ou demonstrar intencao de agendar visita.
- wants_application = true quando a pessoa indicar que quer seguir com a locacao ou com a analise.
- Para property_interest: se a mensagem pede informacao, video, foto, visita ou qualquer dado sobre um imovel sem mencionar qual, e houver apenas um imovel na lista de disponiveis, preencha com o externalId desse imovel. Se houver mais de um e nao for possivel inferir, deixe null.
- Para source: preencha APENAS quando o lead citar explicitamente o portal ou canal pelo qual encontrou o imóvel (exemplos: "vi no OLX", "achei no Zap Imóveis", "vi no Instagram", "me indicaram", "vi no seu site"). Contato direto pelo WhatsApp sem menção de origem → retornar null. "Zap", "mandei um zap", "fiz um zap" são gíria para WhatsApp — não equivalem ao portal Zap Imóveis. Só preencher source = "zap" se o lead disser literalmente "Zap Imóveis" ou "portal Zap".
- expected_residents: preencher apenas quando o lead disser quantas pessoas vao morar. "So eu" = 1. "Eu e minha esposa" = 2.
- wants_human = true APENAS quando a pessoa pedir explicitamente para falar com atendente, pessoa, corretor ou humano (ex: "quero falar com alguem", "tem atendente?", "quero uma pessoa real"). Perguntas sobre o imovel, a visita ou o processo — mesmo que a resposta nao esteja clara no contexto — NAO configuram wants_human.`;

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const LeadExtractionSchema = z.object({
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
  document_choice: z.enum(['cnh', 'rg_cpf']).nullable().default(null),
  wants_options: z.boolean().default(false),
  wants_schedule: z.boolean().default(false),
  wants_application: z.boolean().default(false),
  wants_pause: z.boolean().default(false),
  wants_human: z.boolean().default(false),
  // 'whatsapp' excluded — leads arriving via WhatsApp get that default at creation, LLM detects referral source only
  source: z
    .enum(['olx', 'zap', 'site', 'instagram', 'indicacao', 'outro', 'desconhecido'])
    .nullable()
    .default(null),
  expected_residents: z
    .number()
    .int()
    .nullable()
    .default(null)
    .describe(
      'Quantidade TOTAL de pessoas que vão morar no imóvel, quando o lead informar. ' +
        'Ex: "vamos morar eu e minha esposa" → 2; "só eu" → 1; "somos 4" → 4. ' +
        'Sem informação → null.',
    ),
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

// ─── Extractor ────────────────────────────────────────────────────────────────

function makeLLM(maxTokens = 400) {
  return new ChatOpenAI({
    model: config.OPENAI_MODEL_NAME,
    temperature: 0,
    maxTokens,
    openAIApiKey: config.OPENAI_API_KEY,
  });
}

// Só estes campos vão pro extrator. O LeadContext inteiro é persistido em
// Conversation.data e cresce com sobras de sessão (estado derivado, intenção do
// turno anterior, telemetria, flags de features removidas) — despejá-lo cru
// criava um eco: o extrator relia a própria classificação antiga como se fosse
// fato e a reconfirmava, inclusive em mensagens sem conteúdo. Whitelist também
// descarta chaves legadas que sobraram no banco de builds antigos.
const EXTRACTION_VIEW_KEYS = [
  'name',
  'propertyReference',
  'propertyTitle',
  'propertyInterest',
  'visitedProperty',
  'expectedResidents',
] as const satisfies ReadonlyArray<keyof LeadContext>;

export function buildExtractionView(context: LeadContext): Partial<LeadContext> {
  const view: Record<string, unknown> = {};
  for (const key of EXTRACTION_VIEW_KEYS) {
    const value = context[key];
    if (value !== undefined && value !== null) view[key] = value;
  }
  return view as Partial<LeadContext>;
}

export async function extractLeadUpdate(
  message: string,
  context: LeadContext,
  availablePropertiesSummary?: string,
  lastAssistantMessage?: string | null,
): Promise<Partial<LeadContext> & { extractedSource: string | null }> {
  const extractor = makeLLM(400).withStructuredOutput(LeadExtractionSchema);

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', EXTRACTOR_SYSTEM_PROMPT],
    [
      'human',
      'Data e hora atual (use como referencia para datas relativas como "amanha", "terca", "semana que vem"): {hoje}\n\nFatos ja conhecidos do lead (JSON):\n{context}\n\nUltima mensagem enviada pelo bot (use para interpretar respostas curtas como "sim", "quero", "pode ser"):\n{lastAssistant}\n\nImoveis disponiveis no sistema:\n{available}\n\nMensagem do usuario:\n{message}',
    ],
  ]);

  const chain = prompt.pipe(extractor);

  const hoje = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  let raw: z.infer<typeof LeadExtractionSchema>;
  try {
    raw = (await chain.invoke({
      message,
      context: JSON.stringify(buildExtractionView(context)),
      lastAssistant: lastAssistantMessage?.trim() || 'nenhuma',
      available: availablePropertiesSummary ?? 'nao informado',
      hoje,
    })) as z.infer<typeof LeadExtractionSchema>;
  } catch (err) {
    logger.error({ err }, '[lead.agent] extractLeadUpdate failed');
    return { extractedSource: null };
  }

  const updates: Partial<LeadContext> = { currentIntent: raw.intent };

  const name = normalizeText(raw.name);
  if (raw.name_is_explicit && name) updates.name = name;

  const propertyReference = normalizePropertyReference(raw.property_reference);
  if (propertyReference) updates.propertyReference = propertyReference;

  const propertyInterest = normalizeText(raw.property_interest);
  if (propertyInterest) updates.propertyInterest = propertyInterest;

  if (typeof raw.visited_property === 'boolean') updates.visitedProperty = raw.visited_property;

  const docChoice = normalizeDocumentChoice(raw.document_choice);
  if (docChoice) updates.docsPreference = docChoice;

  if (raw.wants_options) updates.wantsOptions = true;
  if (raw.wants_schedule) updates.wantsSchedule = true;
  if (raw.wants_application) updates.wantsApplication = true;

  // A lista de moradores não é persistida a partir daqui: o extrator só enxerga
  // a mensagem atual, então produziria listas parciais. Quem grava é a tool
  // registrar_moradores, que tem o histórico e o contrato de mandar a lista
  // completa. Ver flows/lead/index.ts.

  if (typeof raw.expected_residents === 'number' && raw.expected_residents > 0) {
    updates.expectedResidents = raw.expected_residents;
  }

  if (raw.wants_pause) updates.wantsPause = true;
  if (raw.wants_human) updates.wantsHuman = true;

  // Deterministic overrides always win over LLM extraction
  const deterministic = getDeterministicLeadUpdates(message);
  Object.assign(updates, deterministic);

  return { ...updates, extractedSource: raw.source };
}
