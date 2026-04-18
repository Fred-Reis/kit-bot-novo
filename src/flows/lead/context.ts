// Port of services/lead_context.py
import { prisma } from '@/db/client';
import type { PropertyData } from '@/services/catalog';
import {
  describeProperty,
  describePropertyTerms,
  findMatchingProperty,
  getPropertyByExternalId,
  listAvailableProperties,
  summarizeProperty,
} from '@/services/catalog';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeadResident {
  name: string;
  sex: string;
  age: number;
}

export interface LeadContext {
  state?: string;
  propertyReference?: string | null;
  propertyTitle?: string | null;
  propertyReferenceLocked?: boolean;
  propertyInterest?: string | null;
  currentIntent?: string | null;
  visitedProperty?: boolean | null;
  visitRequested?: boolean;
  wantsPause?: boolean;
  wantsHuman?: boolean;
  wantsOptions?: boolean;
  wantsSchedule?: boolean;
  wantsApplication?: boolean;
  audioReceived?: boolean;
  name?: string | null;
  income?: string | null;
  docsPreference?: 'cnh' | 'rg_cpf' | null;
  residents?: LeadResident[];
  residentsComplete?: boolean | null;
  analysisSubmitted?: boolean;
  docsReceivedCount?: number;
  lastUserMessage?: string;
  lastRoutedAgent?: string;
  lastRequestedMediaType?: string | null;
}

export interface LeadSnapshot {
  context: LeadContext;
  intent: string;
  name: string | null;
  propertyInFocus: PropertyData | null;
  propertyLocked: boolean;
  availableProperties: PropertyData[];
  applicationMissingItems: string[];
  docsPreference: 'cnh' | 'rg_cpf' | null;
  docsReceivedCount: number;
  docsRequiredCount: number;
  docsMissingCount: number;
  docsStage: 'choose' | 'cnh_images' | 'rg_images' | 'cpf_image' | 'complete';
  docsSummary: string;
  residentsSummary: string;
  residentsComplete: boolean;
  state: string;
  stateGuidance: string;
  currentProcessStep: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOCS_REQUIRED_COUNT: Record<string, number> = { cnh: 2, rg_cpf: 3 };

const PROCESS_STEPS = [
  'interesse',
  'visita',
  'envio de documentacao para analise',
  'contrato',
  'pagamento',
  'entrega das chaves',
];

const STATE_GUIDANCE: Record<string, string> = {
  'lead.start':
    'Entenda a necessidade imediata do lead e responda a pergunta atual antes de avancar. Se for apenas saudacao, responda curto e aguarde a pessoa dizer o que precisa.',
  'lead.offer_options': 'Ofereca apenas as opcoes reais disponiveis e ajude o lead a escolher uma.',
  'lead.property_info':
    'Responda a duvida atual sobre o imovel, valor, regras, localizacao ou disponibilidade.',
  'lead.visit_scheduling': 'Conduza apenas o agendamento de visita. Nao peca renda nem documentos.',
  'lead.visit_requested':
    'Confirme que a visita foi solicitada e mantenha o atendimento aberto para novas duvidas.',
  'lead.objection_handling':
    'Responda a objecao com clareza antes de qualquer tentativa de avancar etapa.',
  'lead.post_visit_decision':
    'Confirme se o lead quer seguir com a locacao agora que ja visitou o imovel.',
  'lead.collect_application': 'Colete apenas o proximo item pendente para a analise.',
  'lead.review_submitted':
    'Confirme que os dados seguiram para analise e que depois havera contato.',
};

const PROPERTY_INFO_INTENTS = new Set([
  'availability',
  'price_and_terms',
  'location',
  'property_details',
  'restrictions',
  'options',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentProcessStep(state: string): string {
  if (
    ['lead.start', 'lead.offer_options', 'lead.property_info', 'lead.objection_handling'].includes(
      state,
    )
  )
    return 'interesse';
  if (['lead.visit_scheduling', 'lead.visit_requested'].includes(state)) return 'visita';
  if (['lead.post_visit_decision', 'lead.collect_application'].includes(state))
    return 'envio de documentacao para analise';
  if (state === 'lead.review_submitted') return 'envio de documentacao para analise concluido';
  return 'interesse';
}

async function resolvePropertyInFocus(context: LeadContext): Promise<PropertyData | null> {
  const reference = (context.propertyReference ?? '').trim();
  if (reference) {
    const property = await getPropertyByExternalId(reference);
    if (property && property.active) return property;
  }
  const interest = (context.propertyInterest ?? '').trim();
  if (interest) {
    return findMatchingProperty(interest);
  }
  return null;
}

function isPropertyLocked(context: LeadContext): boolean {
  return context.propertyReferenceLocked === true && !!(context.propertyReference ?? '').trim();
}

function buildApplicationMissingItems(context: LeadContext): string[] {
  const missing: string[] = [];
  if (!context.name) missing.push('nome completo');
  if (!context.income) missing.push('renda mensal');
  if (!context.docsPreference) missing.push('escolha documental');
  return missing;
}

async function getDocsReceivedCount(leadId: string): Promise<number> {
  const count = await prisma.leadDocument.count({ where: { leadId } });
  return count;
}

function buildDocsStage(
  docsPreference: 'cnh' | 'rg_cpf' | null,
  docsReceivedCount: number,
): LeadSnapshot['docsStage'] {
  if (!docsPreference) return 'choose';
  if (docsPreference === 'cnh') return docsReceivedCount >= 2 ? 'complete' : 'cnh_images';
  if (docsReceivedCount >= 3) return 'complete';
  if (docsReceivedCount >= 2) return 'cpf_image';
  return 'rg_images';
}

function buildDocsSummary(
  docsPreference: 'cnh' | 'rg_cpf' | null,
  docsStage: string,
  docsReceivedCount: number,
): string {
  if (docsStage === 'choose') return 'Ainda falta escolher entre CNH ou RG + CPF.';
  if (docsPreference === 'cnh') {
    if (docsReceivedCount === 0) return 'Envie as imagens da CNH frente e verso.';
    if (docsReceivedCount === 1) return 'Ja recebemos uma imagem da CNH. Agora falta a outra face.';
    return 'As imagens da CNH ja foram recebidas.';
  }
  if (docsStage === 'rg_images') {
    if (docsReceivedCount === 0) return 'Na opcao RG + CPF, envie primeiro o RG frente e verso.';
    return 'Ja recebemos uma imagem do RG. Agora falta a segunda imagem do RG.';
  }
  if (docsStage === 'cpf_image')
    return 'O RG frente e verso ja foi recebido. Agora falta apenas a imagem do CPF.';
  return 'Documentacao completa.';
}

function buildResidentsSummary(context: LeadContext): [string, boolean] {
  const residents = context.residents ?? [];
  if (residents.length === 0) return ['Nenhum morador informado ainda.', false];

  const lines = residents.map((r) => {
    const name = (r.name ?? '').trim() || 'nome nao informado';
    const sex = (r.sex ?? '').trim() || 'sexo nao informado';
    const age = r.age != null ? String(r.age) : 'idade nao informada';
    return `- ${name} | sexo: ${sex} | idade: ${age}`;
  });

  const complete = context.residentsComplete === true;
  let summary = lines.join('\n');
  if (complete) summary += '\nTodos os moradores ja foram informados.';
  return [summary, complete];
}

function deriveState(
  snapshot: Omit<LeadSnapshot, 'state' | 'stateGuidance' | 'currentProcessStep'>,
): string {
  const { context, propertyInFocus, applicationMissingItems, docsStage, residentsComplete } =
    snapshot;
  const intent = snapshot.intent;

  if (context.analysisSubmitted) return 'lead.review_submitted';
  if (intent === 'objection') return 'lead.objection_handling';

  if (!propertyInFocus) {
    if (context.wantsOptions || intent === 'availability' || intent === 'options')
      return 'lead.offer_options';
    return 'lead.start';
  }

  const visited = context.visitedProperty;

  if (visited === false) {
    if (context.wantsSchedule || intent === 'visit') {
      return context.visitRequested ? 'lead.visit_requested' : 'lead.visit_scheduling';
    }
    if (PROPERTY_INFO_INTENTS.has(intent)) return 'lead.property_info';
    return 'lead.property_info';
  }

  if (visited !== true) {
    if (intent === 'visit') return 'lead.visit_scheduling';
    return 'lead.property_info';
  }

  if (PROPERTY_INFO_INTENTS.has(intent)) return 'lead.property_info';

  const hasApplicationProgress =
    context.wantsApplication ||
    !!context.income ||
    !!context.docsPreference ||
    (context.residents ?? []).length > 0;

  if (!hasApplicationProgress) return 'lead.post_visit_decision';
  if (applicationMissingItems.length > 0) return 'lead.collect_application';
  if (docsStage !== 'complete') return 'lead.collect_application';
  if (!residentsComplete) return 'lead.collect_application';

  return 'lead.review_submitted';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildLeadSnapshot(
  leadId: string,
  context: LeadContext,
): Promise<LeadSnapshot> {
  const propertyInFocus = await resolvePropertyInFocus(context);
  const availableProperties = await listAvailableProperties();
  const docsPreference = context.docsPreference ?? null;
  const docsReceivedCount = await getDocsReceivedCount(leadId);
  const docsStage = buildDocsStage(docsPreference, docsReceivedCount);
  const docsRequiredCount = DOCS_REQUIRED_COUNT[docsPreference ?? ''] ?? 0;
  const docsMissingCount = Math.max(0, docsRequiredCount - docsReceivedCount);
  const docsSummary = buildDocsSummary(docsPreference, docsStage, docsReceivedCount);
  const [residentsSummary, residentsComplete] = buildResidentsSummary(context);
  const applicationMissingItems = buildApplicationMissingItems(context);
  const intent = context.currentIntent ?? 'unknown';

  const partial = {
    context,
    intent,
    name: (context.name ?? '').trim() || null,
    propertyInFocus,
    propertyLocked: isPropertyLocked(context),
    availableProperties,
    applicationMissingItems,
    docsPreference,
    docsReceivedCount,
    docsRequiredCount,
    docsMissingCount,
    docsStage,
    docsSummary,
    residentsSummary,
    residentsComplete,
  };

  const state = deriveState(partial);

  return {
    ...partial,
    state,
    stateGuidance: STATE_GUIDANCE[state] ?? STATE_GUIDANCE['lead.start'],
    currentProcessStep: currentProcessStep(state),
  };
}

export function renderLeadContext(snapshot: LeadSnapshot): string {
  const { context, propertyInFocus, availableProperties } = snapshot;

  const availableLines = availableProperties.map((p) => `- ${summarizeProperty(p)}`);
  const availableSummary =
    availableLines.length > 0
      ? availableLines.join('\n')
      : '- Nenhum imovel disponivel no momento.';

  const propertyFocusSummary = propertyInFocus
    ? describeProperty(propertyInFocus)
    : 'Nenhum imovel definido ainda.';

  const propertyTermsSummary = propertyInFocus
    ? describePropertyTerms(propertyInFocus)
    : 'Nenhuma condicao factual disponivel porque nenhum imovel foi definido.';

  const propertyInterest = (context.propertyInterest ?? '').trim() || 'nao informado';

  const lines = [
    'Fluxo: lead nao inquilino.',
    `Estado atual: ${snapshot.state}.`,
    `Etapa oficial do processo agora: ${snapshot.currentProcessStep}.`,
    `Fluxo oficial da locacao: ${PROCESS_STEPS.join(' -> ')}.`,
    `Objetivo do estado: ${snapshot.stateGuidance}`,
    `Intencao principal da mensagem atual: ${snapshot.intent}.`,
    `Audio recebido nesta interacao: ${context.audioReceived === true}.`,
    `Nome conhecido: ${snapshot.name ?? 'nao informado'}.`,
    `Imovel mencionado pelo lead: ${propertyInterest}.`,
    `Imovel em foco:\n${propertyFocusSummary}`,
    `Condicoes factuais do imovel em foco:\n${propertyTermsSummary}`,
    `Imovel em foco travado: ${snapshot.propertyLocked === true}.`,
    `Ja visitou o imovel: ${context.visitedProperty != null ? String(context.visitedProperty) : 'nao informado'}.`,
    `Pedido de visita ja registrado: ${context.visitRequested === true}.`,
    'Imoveis disponiveis no banco:',
    availableSummary,
  ];

  const applicationStates = [
    'lead.collect_application',
    'lead.post_visit_decision',
    'lead.review_submitted',
  ];
  if (applicationStates.includes(snapshot.state)) {
    const missingText =
      snapshot.applicationMissingItems.length > 0
        ? snapshot.applicationMissingItems.join(', ')
        : 'nenhum';
    const nextItem =
      snapshot.applicationMissingItems.length > 0
        ? snapshot.applicationMissingItems[0]
        : snapshot.docsStage !== 'complete'
          ? 'documentos pendentes'
          : !snapshot.residentsComplete
            ? 'moradores'
            : 'nenhum';

    lines.push(
      `Itens ainda pendentes para analise: ${missingText}.`,
      `Proximo item natural da analise: ${nextItem}.`,
      `Opcao documental escolhida: ${snapshot.docsPreference ?? 'nenhuma'}.`,
      `Etapa documental: ${snapshot.docsStage}.`,
      `Documentos recebidos: ${snapshot.docsReceivedCount}.`,
      `Documentos faltantes: ${snapshot.docsMissingCount}.`,
      `Resumo documental: ${snapshot.docsSummary}`,
      `Moradores informados:\n${snapshot.residentsSummary}`,
      `Lead quer seguir com a analise: ${context.wantsApplication === true}.`,
      `Analise submetida: ${context.analysisSubmitted === true}.`,
    );
  } else {
    lines.push('Nao peca renda, documentos ou moradores nesta etapa.');
  }

  return lines.join('\n');
}
