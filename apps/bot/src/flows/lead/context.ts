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
import {
  type ChecklistStatus,
  getChecklistForLead,
  renderChecklistContext,
} from '@/flows/lead/checklist';

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
  expectedResidents?: number | null;
  analysisSubmitted?: boolean;
  visitConfirmationSent?: boolean;
  dataConfirmed?: boolean;
  dataConfirmationSent?: boolean;
  docsContestations?: number;
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
  checklist: ChecklistStatus;
  state: string;
  stateGuidance: string;
  currentProcessStep: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

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
  'lead.data_confirmation':
    'Confirme com o lead o nome e CPF extraídos dos documentos antes de enviar para análise.',
  'lead.review_submitted':
    'Confirme que os dados seguiram para analise e que depois havera contato.',
};

export const PROPERTY_INFO_INTENTS = new Set([
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
  if (state === 'lead.data_confirmation')
    return 'confirmacao de dados antes da analise';
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

// ─── State derivation ─────────────────────────────────────────────────────────

export interface DeriveStateInput {
  context: LeadContext;
  intent: string;
  propertyInFocus: PropertyData | null;
  checklist: ChecklistStatus;
}

export function deriveState(input: DeriveStateInput): string {
  const { context, intent, propertyInFocus, checklist } = input;

  if (context.analysisSubmitted) return 'lead.review_submitted';
  if (intent === 'objection') return 'lead.objection_handling';

  if (!propertyInFocus) {
    if (context.wantsOptions || intent === 'availability' || intent === 'options')
      return 'lead.offer_options';
    return 'lead.start';
  }

  const visited = context.visitedProperty;

  // Pedido explícito de visita sempre vai para scheduling (a menos que já visitou)
  if ((context.wantsSchedule || intent === 'visit') && visited !== true) {
    return context.visitRequested ? 'lead.visit_requested' : 'lead.visit_scheduling';
  }

  if (PROPERTY_INFO_INTENTS.has(intent)) return 'lead.property_info';

  // Visita é opcional — progresso no checklist avança a coleta
  const hasApplicationProgress =
    context.wantsApplication ||
    checklist.income ||
    checklist.identity.have.length > 0 ||
    checklist.residents.collected > 0 ||
    checklist.residents.expected != null;

  if (!hasApplicationProgress) {
    if (visited === true) return 'lead.post_visit_decision';
    return 'lead.property_info';
  }

  if (!checklist.complete) return 'lead.collect_application';
  if (!context.dataConfirmed) return 'lead.data_confirmation';

  return 'lead.review_submitted';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildLeadSnapshot(
  leadId: string,
  context: LeadContext,
): Promise<LeadSnapshot> {
  const propertyInFocus = await resolvePropertyInFocus(context);
  const availableProperties = await listAvailableProperties();
  const checklist = await getChecklistForLead(leadId);
  const intent = context.currentIntent ?? 'unknown';

  const state = deriveState({ context, intent, propertyInFocus, checklist });

  return {
    context,
    intent,
    name: (context.name ?? '').trim() || null,
    propertyInFocus,
    propertyLocked: isPropertyLocked(context),
    availableProperties,
    checklist,
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
    'lead.data_confirmation',
  ];
  if (applicationStates.includes(snapshot.state)) {
    lines.push(renderChecklistContext(snapshot.checklist));
    lines.push(`Analise submetida: ${snapshot.context.analysisSubmitted === true}.`);
  } else {
    lines.push('Nao peca renda, documentos ou moradores nesta etapa.');
  }

  return lines.join('\n');
}
