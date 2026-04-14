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
  if (!normalized) return {};

  const updates: Record<string, unknown> = {};

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
