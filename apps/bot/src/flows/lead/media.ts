// Port of services/lead_media.py
import type { PropertyMedia } from '@prisma/client';
import type { PropertyData } from '@/services/catalog';
import { normalizeLookupText } from '@/services/catalog';

const MEDIA_CONFIRMATION_TERMS = new Set([
  'manda',
  'mande',
  'envia',
  'envie',
  'pode mandar',
  'pode enviar',
  'quero sim',
  'cade',
  'cade o',
]);

const SENDABLE_MEDIA_TYPES = new Set(['audio', 'document', 'image', 'video']);

export interface LeadContextForMedia {
  lastRequestedMediaType?: string | null;
}

export function getRequestedMediaType(
  message: string | null,
  context: LeadContextForMedia,
): string | null {
  const normalized = normalizeLookupText(message ?? '');
  if (!normalized) return null;

  if (normalized.includes('video')) return 'video';
  if (normalized.includes('foto') || normalized.includes('imagem')) return 'listing';

  const lastType = context.lastRequestedMediaType;
  if (lastType && [...MEDIA_CONFIRMATION_TERMS].some((t) => normalized.includes(t))) {
    return lastType;
  }

  return null;
}

// Pedido de mídia resolvido negativamente (algo foi pedido, nada desse tipo foi
// encontrado) não pode deixar a intenção grudada na sessão — senão uma
// confirmação futura sem relação ("manda", "pode mandar" sobre outro assunto)
// resgataria por engano o pedido velho.
export function shouldClearRequestedMediaType(
  requestedMediaType: string | null,
  outboundMedia: unknown,
): boolean {
  return !!requestedMediaType && !outboundMedia;
}

export function findPropertyMedia(
  property: PropertyData | null,
  mediaType: string | null,
): PropertyMedia | null {
  if (!property || !mediaType) return null;

  for (const item of property.media) {
    if (item.type !== mediaType) continue;
    if (item.url) return item;
  }
  return null;
}

export function shouldSendMediaDeterministically(
  requestedMediaType: string | null,
  mediaItem: PropertyMedia | null,
): boolean {
  if (!mediaItem) return false;
  if (!SENDABLE_MEDIA_TYPES.has(mediaItem.type)) return false;
  return requestedMediaType === mediaItem.type;
}

export function mediaCaption(property: PropertyData | null, mediaItem: PropertyMedia): string {
  const label = mediaItem.label ?? 'Mídia';
  return property ? `${label} - ${property.name}` : label;
}
