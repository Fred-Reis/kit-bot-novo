// Port of services/lead_intents.py

const GREETING_REPLIES: Record<string, string> = {
  'bom dia': 'Bom dia!',
  'boa tarde': 'Boa tarde!',
  'boa noite': 'Boa noite!',
};

const SINGLE_GREETING_TERMS = new Set(['oi', 'ola', 'opa', 'salve']);

const TRAILING_SMALL_TALK = new Set(['tudo bem', 'td bem', 'tudo bom', 'beleza']);

const SAW_AD_TERMS = new Set([
  'vi o anuncio',
  'vi no anuncio',
  'vi esse numero',
  'vi o numero',
  'vi uma quitinete',
  'vi uma kitnet',
  'vi uma casa',
  'peguei seu numero',
]);

const NOT_VISITED_TERMS = new Set([
  'nao visitei',
  'nao fui',
  'ainda nao visitei',
  'ainda nao fui',
  'so vi o numero',
  'so vi o anuncio',
]);

const DETAILS_TERMS = new Set([
  'detalhe',
  'detalhes',
  'exigencia',
  'exigencias',
  'requisito',
  'requisitos',
  'condicao',
  'condicoes',
]);

// Mensagens que só chamam atenção, sem pedir nada. O extrator LLM tende a
// "completar" a intenção delas a partir do contexto e devolvia intenção de
// visita pra uma cutucada, rebobinando o funil de quem já estava na análise.
// Comparado com a mensagem INTEIRA (igualdade, não includes) — "e ai, quero
// visitar" continua indo pro extrator normalmente.
// Já normalizadas: normalizeIntentText remove acento e pontuação, então "E aí?"
// entra aqui como "e ai" e mensagens só de pontuação viram string vazia (tratadas
// à parte, em getDeterministicLeadUpdates).
const NUDGE_MESSAGES = new Set([
  'e ai',
  'eai',
  'e entao',
  'entao',
  'alo',
  'oi',
  'ola',
  'opa',
  'oie',
  'tudo bem',
  'tudo bom',
]);

const CONTESTATION_TERMS = [
  'ja enviei',
  'ja mandei',
  'ja te enviei',
  'ja te mandei',
  'enviei sim',
  'mandei sim',
  'acabei de enviar',
  'acabei de mandar',
];

export function detectDocContestation(message: string | null): boolean {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return false;
  return CONTESTATION_TERMS.some((t) => normalized.includes(t));
}

export function normalizeIntentText(value: string): string {
  const nfd = value.trim().toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
  const noSymbols = nfd.replace(/[,.:;?!]/g, ' ');
  return noSymbols.replace(/\s+/g, ' ').trim();
}

export function getSimpleGreetingReply(message: string | null): string | null {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return null;

  if (GREETING_REPLIES[normalized]) return GREETING_REPLIES[normalized];
  if (SINGLE_GREETING_TERMS.has(normalized)) return 'Olá!';

  // "oi tudo bem" → "Olá!"
  for (const term of SINGLE_GREETING_TERMS) {
    if (normalized.startsWith(term + ' ')) {
      const remainder = normalized.slice(term.length + 1);
      if (TRAILING_SMALL_TALK.has(remainder)) return 'Olá!';
    }
  }

  // "bom dia tudo bem" → "Bom dia!"
  for (const [greeting, reply] of Object.entries(GREETING_REPLIES)) {
    if (normalized.startsWith(greeting + ' ')) {
      const remainder = normalized.slice(greeting.length + 1);
      if (TRAILING_SMALL_TALK.has(remainder)) return reply;
    }
  }

  return null;
}

export function getDeterministicLeadUpdates(message: string | null): Record<string, unknown> {
  const normalized = normalizeIntentText(message ?? '');
  // Espelha a regra de cutucada do EXTRACTOR_SYSTEM_PROMPT: nenhuma etapa é
  // inferida a partir de uma mensagem sem conteúdo. visitedProperty fica de fora
  // de propósito — é fato durável, não intenção do turno.
  const nudgeUpdates = {
    currentIntent: 'unknown',
    wantsSchedule: false,
    wantsApplication: false,
    wantsOptions: false,
  };

  if (!normalized) {
    // Mensagem só de pontuação ("?", "!!") some na normalização, mas foi enviada
    // de propósito: é cutucada, não turno vazio.
    return (message ?? '').trim() ? nudgeUpdates : {};
  }

  const updates: Record<string, unknown> = {};

  if (NUDGE_MESSAGES.has(normalized)) return nudgeUpdates;

  if ([...SAW_AD_TERMS, ...NOT_VISITED_TERMS].some((t) => normalized.includes(t))) {
    updates['visitedProperty'] = false;
  }

  if (
    normalized.includes('quitinete') ||
    normalized.includes('kitnet') ||
    normalized.includes('kitinete')
  ) {
    updates['propertyInterest'] = 'quitinete';
  }

  if ([...DETAILS_TERMS].some((t) => normalized.includes(t))) {
    updates['currentIntent'] = 'price_and_terms';
    updates['wantsSchedule'] = false;
  }

  if (normalized.includes('nao quero visitar') || normalized.includes('nao quero agendar')) {
    updates['currentIntent'] = 'property_details';
    updates['wantsSchedule'] = false;
  }

  return updates;
}

// visitedProperty is monotonic against LLM drift (once true, an ambiguous later
// turn shouldn't silently un-set it) — but an explicit deterministic correction
// ("ainda nao visitei") must still be able to fix a wrongly-true flag.
export function resolveVisitedProperty(
  previous: boolean | null | undefined,
  extracted: boolean | null | undefined,
  message: string | null,
): boolean | null | undefined {
  if (previous === true && extracted !== true) {
    if (getDeterministicLeadUpdates(message).visitedProperty === false) return false;
    return true;
  }
  return extracted;
}
