import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import {
  type ChecklistStatus,
  getChecklistForLead,
  renderChecklistText,
} from '@/flows/lead/checklist';
import { logger } from '@/lib/logger';
import {
  classifyDocument,
  DOC_TYPE_LABEL,
  type LeadDocumentType,
} from '@/services/doc-classifier';
import { extractTextFromBase64 } from '@/services/ocr';

export interface IntakeOutcome {
  processed: number;
  persisted: LeadDocumentType[];
  reply: string | null;
}

function isIntakeMedia(item: MediaItem): boolean {
  const type = item.type ?? '';
  const mime = item.mime ?? '';
  // PDFs cannot be processed by Vision images:annotate; skip OCR for them
  if (mime === 'application/pdf') return false;
  const isDocLike = type === 'image' || type === 'document' || mime.startsWith('image/');
  return isDocLike && (!!item.url || !!item.base64);
}

async function ocrMedia(item: MediaItem): Promise<string> {
  if (item.base64) return extractTextFromBase64(item.base64);
  if (!item.url) return '';
  // item.url is a Supabase storage path — resolve to a signed URL before fetching
  // Dynamic import avoids Supabase client initialization in test environments
  try {
    const { createLeadDocumentUrl } = await import('@/services/storage');
    const signedUrl = await createLeadDocumentUrl(item.url, 60);
    const res = await fetch(signedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    return extractTextFromBase64(buf.toString('base64'));
  } catch (err) {
    logger.warn({ err, url: item.url }, '[doc-intake] Failed to download media for OCR');
    return '';
  }
}

export function buildIntakeReply(
  persisted: LeadDocumentType[],
  duplicates: LeadDocumentType[],
  unknownCount: number,
  checklist: ChecklistStatus,
): string {
  const lines: string[] = [];

  for (const type of persisted.filter((t) => t !== 'unknown')) {
    lines.push(`✅ Recebi: ${DOC_TYPE_LABEL[type]}`);
  }
  for (const type of duplicates) {
    lines.push(`Eu já tinha recebido a ${DOC_TYPE_LABEL[type]} — não precisa enviar de novo 😉`);
  }
  if (unknownCount > 0) {
    lines.push(
      unknownCount === 1
        ? 'Recebi uma imagem, mas não consegui identificar o documento. É a CNH, o RG ou o CPF? Se a foto estiver escura ou cortada, tenta de novo com boa iluminação.'
        : `Recebi ${unknownCount} imagens que não consegui identificar. Pode reenviar com boa iluminação e o documento inteiro na foto?`,
    );
  }

  if (checklist.identity.complete && persisted.some((t) => t !== 'unknown')) {
    lines.push('', '📋 Documentos de identidade completos!');
  }

  if (!checklist.complete) {
    lines.push('', 'Status da análise:', renderChecklistText(checklist));
  }

  return lines.join('\n');
}

export function buildTransparencyReply(
  docs: Array<{ type: string; createdAt: Date }>,
  checklist: ChecklistStatus,
): string {
  if (docs.length === 0) {
    return (
      'Verifiquei aqui: não recebi nenhum documento no sistema até agora 😕\n' +
      'Pode ter havido falha no envio. Pode reenviar a foto, por favor?'
    );
  }

  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const lines = docs.map((d) => {
    const label = DOC_TYPE_LABEL[d.type as LeadDocumentType] ?? d.type;
    return `• ${label} — recebido em ${fmt.format(d.createdAt)}`;
  });

  const missing = checklist.identity.complete
    ? ''
    : `\n\nAinda falta: ${checklist.identity.missing.join(', ')}. Se você enviou algo que não está na lista, pode reenviar?`;

  return `Verifiquei aqui. No sistema recebi:\n${lines.join('\n')}${missing}`;
}

export async function handleDocumentIntake(
  chatId: string,
  leadId: string,
  ownerId: string,
  mediaItems: MediaItem[],
): Promise<IntakeOutcome> {
  const docItems = mediaItems.filter(isIntakeMedia);
  if (docItems.length === 0) return { processed: 0, persisted: [], reply: null };

  const existing = await prisma.leadDocument.findMany({
    where: { leadId },
    select: { type: true },
  });
  const existingTypes = new Set(existing.map((d) => d.type));

  const persisted: LeadDocumentType[] = [];
  const duplicates: LeadDocumentType[] = [];
  let unknownCount = 0;

  for (const item of docItems) {
    const ocrText = await ocrMedia(item);
    const type = classifyDocument(ocrText);

    if (type === 'unknown') {
      unknownCount += 1;
      continue;
    }
    if (existingTypes.has(type)) {
      duplicates.push(type);
      continue;
    }

    try {
      await prisma.leadDocument.upsert({
        where: { leadId_type: { leadId, type } },
        update: { url: item.url ?? '', ocrText: ocrText || null },
        create: { leadId, type, url: item.url ?? '', ocrText: ocrText || null, ownerId },
      });
      existingTypes.add(type);
      persisted.push(type);
    } catch (err) {
      logger.error({ err, leadId, type }, '[doc-intake] Falha ao persistir documento');
      unknownCount += 1;
    }
  }

  const checklist = await getChecklistForLead(leadId);
  const reply = buildIntakeReply(persisted, duplicates, unknownCount, checklist);

  logger.info(
    { chatId, persisted, duplicates, unknownCount },
    '[doc-intake] Documentos processados',
  );

  return { processed: docItems.length, persisted, reply };
}
