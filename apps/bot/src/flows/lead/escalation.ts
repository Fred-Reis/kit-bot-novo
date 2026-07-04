import { prisma } from '@/db/client';
import { normalizeIntentText } from '@/flows/lead/intents';
import { logger } from '@/lib/logger';
import { sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';

export type EscalationReason = 'human_request' | 'frustration' | 'loop' | 'contestation';

const REASON_LABEL: Record<EscalationReason, string> = {
  human_request: 'Lead pediu atendimento humano',
  frustration: 'Lead demonstrou frustração com o bot',
  loop: 'Bot detectou repetição da própria resposta',
  contestation: 'Lead insiste que enviou documentos que não constam no sistema',
};

const LEAD_MESSAGE: Record<EscalationReason, string> = {
  human_request:
    'Claro! Vou pedir para um atendente humano assumir a conversa. Você recebe retorno em breve 🙂',
  frustration:
    'Peço desculpas pela experiência. Vou passar seu atendimento para uma pessoa da equipe — retorno em breve.',
  loop: 'Percebi que não estou conseguindo te ajudar direito. Um atendente humano vai assumir a conversa em breve.',
  contestation:
    'Vou pedir para a equipe verificar seus documentos manualmente — pode ter havido falha no recebimento. Retorno em breve!',
};

const FRUSTRATION_TERMS = [
  'retardado',
  'burro',
  'idiota',
  'imbecil',
  'incompetente',
  'inutil',
  'lixo',
  'merda',
  'porra',
  'caralho',
  'nao esta entendendo',
  'nao ta entendendo',
  'voce nao entende',
  'vc nao entende',
];

export function detectFrustration(message: string | null): boolean {
  const normalized = normalizeIntentText(message ?? '');
  if (!normalized) return false;
  return FRUSTRATION_TERMS.some((t) => normalized.includes(t));
}

export function isSameReply(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normalizeIntentText(a) === normalizeIntentText(b);
}

export async function escalateToHuman(
  chatId: string,
  ownerId: string,
  leadName: string | null,
  reason: EscalationReason,
): Promise<void> {
  logger.warn({ chatId, reason }, '[escalation] Pausando bot e notificando owner');

  await prisma.conversation.upsert({
    where: { chatId },
    update: { botPaused: true },
    create: { chatId, data: {}, ownerId, botPaused: true },
  });

  await sendText(chatId, LEAD_MESSAGE[reason]).catch((err) =>
    logger.error({ err, chatId }, '[escalation] Falha ao avisar lead'),
  );

  notifyOwner(ownerId, 'human_needed', {
    leadName: leadName ?? chatId,
    leadPhone: chatId,
    reason: REASON_LABEL[reason],
  }).catch((err) => logger.error({ err }, '[escalation] notifyOwner falhou'));
}
