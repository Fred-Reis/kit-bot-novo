import type { Property, PropertyMedia } from '@prisma/client';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';

const PROPERTY_CACHE_TTL = 600; // 10 min
const KITNET_ALIASES = new Set(['kitnet', 'kit net', 'quitinete', 'kitinete', 'kitenet']);
const SINGLE_PROPERTY_ALIASES = new Set([
  'casa',
  'imovel',
  'essa',
  'essa casa',
  'essa kitnet',
  'essa quitinete',
  'a do anuncio',
  'do anuncio',
]);

export interface PropertyData extends Property {
  media: PropertyMedia[];
}

export function normalizeLookupText(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

function formatCurrency(value: number | null): string {
  if (value === null) return 'sob consulta';
  return `R$ ${value.toLocaleString('pt-BR')}`;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function cacheSet(key: string, value: unknown, ttl: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttl);
}

export async function invalidatePropertyCache(id: string): Promise<void> {
  await redis.del(`property:${id}`);
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function getProperty(id: string): Promise<PropertyData | null> {
  const cacheKey = `property:${id}`;
  const cached = await cacheGet<PropertyData>(cacheKey);
  if (cached) return cached;

  const property = await prisma.property.findUnique({
    where: { id },
    include: { media: { orderBy: { order: 'asc' } } },
  });

  if (property) await cacheSet(cacheKey, property, PROPERTY_CACHE_TTL);
  return property as PropertyData | null;
}

export async function getPropertyByExternalId(externalId: string): Promise<PropertyData | null> {
  const property = await prisma.property.findUnique({
    where: { externalId: externalId.toUpperCase() },
    include: { media: { orderBy: { order: 'asc' } } },
  });
  if (property) {
    await cacheSet(`property:${property.id}`, property, PROPERTY_CACHE_TTL);
  }
  return property as PropertyData | null;
}

const AVAILABLE_CACHE_KEY = 'properties:available';
const AVAILABLE_CACHE_TTL = 300; // 5 min

export async function listAvailableProperties(): Promise<PropertyData[]> {
  const cached = await cacheGet<PropertyData[]>(AVAILABLE_CACHE_KEY);
  if (cached) return cached;

  const properties = await prisma.property.findMany({
    where: { active: true },
    include: { media: { orderBy: { order: 'asc' } } },
    orderBy: { externalId: 'asc' },
  });
  await cacheSet(AVAILABLE_CACHE_KEY, properties, AVAILABLE_CACHE_TTL);
  return properties as PropertyData[];
}

export async function invalidateAvailablePropertiesCache(): Promise<void> {
  await redis.del(AVAILABLE_CACHE_KEY);
}

export async function findMatchingProperty(query: string): Promise<PropertyData | null> {
  const normalized = normalizeLookupText(query);
  if (!normalized) return null;

  // Exact externalId match
  const byRef = await getPropertyByExternalId(normalized.toUpperCase());
  if (byRef && byRef.active) return byRef;

  const available = await listAvailableProperties();

  // Single property shortcuts
  if (
    available.length === 1 &&
    (SINGLE_PROPERTY_ALIASES.has(normalized) ||
      Array.from(KITNET_ALIASES).some((a) => normalized.includes(a)) ||
      normalized.includes('retiro') ||
      normalized.includes('laranjeiras') ||
      normalized.includes('olx'))
  ) {
    return available[0];
  }

  // Kitnet aliases
  if (KITNET_ALIASES.has(normalized)) {
    const matches = available.filter(
      (p) =>
        normalizeLookupText(p.category ?? '') === 'kitnet' ||
        normalizeLookupText(p.category ?? '') === 'quitinete',
    );
    if (matches.length === 1) return matches[0];
  }

  // Exact neighborhood
  const byNeighborhood = available.filter(
    (p) => normalizeLookupText(p.neighborhood) === normalized,
  );
  if (byNeighborhood.length === 1) return byNeighborhood[0];

  // Name or category contains query
  const byTitle = available.filter(
    (p) =>
      normalizeLookupText(p.name).includes(normalized) ||
      normalizeLookupText(p.category ?? '').includes(normalized),
  );
  if (byTitle.length === 1) return byTitle[0];

  // Broad search
  const broad = available.filter(
    (p) =>
      normalizeLookupText(p.neighborhood).includes(normalized) ||
      normalizeLookupText(p.address).includes(normalized) ||
      normalizeLookupText(p.name).includes(normalized) ||
      normalizeLookupText(p.description ?? '').includes(normalized),
  );
  if (broad.length === 1) return broad[0];

  return null;
}

// ─── Text renderers (used by context.ts to build LLM prompt) ─────────────────

function describeMediaItems(media: PropertyMedia[]): string {
  if (media.length === 0) return 'Nenhuma midia cadastrada.';
  return media
    .map((m) => {
      const label = m.label ?? m.type;
      if (m.type === 'listing') {
        return `${label} (tipo: listing) — link de anuncio disponivel, sera enviado automaticamente quando solicitado. NUNCA copie a URL no texto.`;
      }
      return `${label} (tipo: ${m.type}) — disponivel para envio automatico via WhatsApp. NUNCA copie ou mencione a URL no texto.`;
    })
    .join('\n');
}

export function summarizeProperty(p: PropertyData): string {
  const parts = [p.externalId, p.name, p.neighborhood, formatCurrency(Number(p.rent))];
  if (p.rooms) parts.push(`${p.rooms} quarto${p.rooms > 1 ? 's' : ''}`);
  return parts.join(' | ');
}

export function describeProperty(p: PropertyData): string {
  const facts: string[] = [
    `Referencia: ${p.externalId}`,
    `Titulo: ${p.name}`,
    `Bairro: ${p.neighborhood}`,
    `Endereco: ${p.address}`,
    `Valor: ${formatCurrency(Number(p.rent))}`,
  ];
  if (p.category) facts.push(`Categoria: ${p.category}`);
  facts.push(`Quartos: ${p.rooms}`);
  facts.push(`Banheiros: ${p.bathrooms}`);
  if (p.firstRental !== null) facts.push(`Primeira locacao: ${p.firstRental ? 'sim' : 'nao'}`);
  if (p.includesWater !== null) facts.push(`Agua inclusa: ${p.includesWater ? 'sim' : 'nao'}`);
  if (p.acceptsPets !== null) facts.push(`Aceita animais: ${p.acceptsPets ? 'sim' : 'nao'}`);
  facts.push(`Maximo de moradores: ${p.maxAdults}`);
  if (p.acceptsChildren !== null)
    facts.push(`Aceita criancas: ${p.acceptsChildren ? 'sim' : 'nao'}`);
  if (p.independentEntrance !== null)
    facts.push(`Entrada independente: ${p.independentEntrance ? 'sim' : 'nao'}`);
  if (p.description) facts.push(`Descricao: ${p.description}`);
  if (p.media.length > 0) facts.push(`Midias e links:\n${describeMediaItems(p.media)}`);
  if (p.contractMonths) facts.push(`Contrato inicial: ${p.contractMonths} meses`);
  facts.push(`Caucao: ${formatCurrency(Number(p.deposit))}`);
  facts.push(`Caucao parcelavel em ate ${p.depositInstallmentsMax}x`);
  if (p.visitSchedule) facts.push(`Janela de visita: ${p.visitSchedule}`);
  if (p.rulesText) facts.push(`Regras adicionais: ${p.rulesText}`);
  return facts.map((f) => `- ${f}`).join('\n');
}

export function describePropertyTerms(p: PropertyData): string {
  const facts = [
    `Valor do aluguel: ${formatCurrency(Number(p.rent))}`,
    `Agua inclusa: ${p.includesWater ? 'sim' : 'nao'}`,
    `IPTU incluso: ${p.includesIptu ? 'sim' : 'nao'}`,
    `Luz inclusa: ${p.individualElectricity ? 'nao (individual)' : 'sim'}`,
    `Aceita animais: ${p.acceptsPets ? 'sim' : 'nao'}`,
    `Maximo de moradores: ${p.maxAdults}`,
    `Aceita criancas: ${p.acceptsChildren ? 'sim' : 'nao'}`,
    `Caucao: ${formatCurrency(Number(p.deposit))}`,
    `Caucao parcelavel em ate ${p.depositInstallmentsMax}x`,
  ];
  if (p.contractMonths) facts.push(`Contrato inicial: ${p.contractMonths} meses`);
  facts.push(
    'Documentos aceitos para analise: CNH ou RG + CPF; comprovante de renda tambem e exigido.',
  );
  if (p.visitSchedule) facts.push(`Visitas: ${p.visitSchedule}`);
  if (p.media.length > 0) facts.push(`Midias e links: ${describeMediaItems(p.media)}`);
  if (p.rulesText) facts.push(`Regras adicionais: ${p.rulesText}`);
  return facts.map((f) => `- ${f}`).join('\n');
}
