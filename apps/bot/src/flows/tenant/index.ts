import { buildTenantTools } from '@/agents/tenant-tools';
import { runTenantAgentV2 } from '@/agents/tenant-v2';
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { detectFrustration } from '@/flows/lead/escalation';
import { buildTenantSnapshot, renderTenantContext } from '@/flows/tenant/context';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import {
  AUDIO_FALLBACK_REPLY,
  detectEmergency,
  EMERGENCY_REPLY,
  getTenantGreetingReply,
} from '@/flows/tenant/intents';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';
import { notifyOwner } from '@/services/notify';

const CHAT_HISTORY_LIMIT = 10;

function isAudioMedia(item: MediaItem): boolean {
  return (item.mime ?? '').startsWith('audio/') || (item.type ?? '').startsWith('audio');
}

async function loadChatHistory(
  chatId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const events = await prisma.event.findMany({
    where: { chatId },
    orderBy: { createdAt: 'desc' },
    take: CHAT_HISTORY_LIMIT,
  });
  return events
    .reverse()
    .filter((event) => event.role === 'user' || event.role === 'assistant')
    .map((event) => ({ role: event.role as 'user' | 'assistant', content: event.content }));
}

async function persistTurn(
  chatId: string,
  ownerId: string,
  userMessage: string | null,
  assistantReply: string | null,
): Promise<void> {
  const ops: Array<ReturnType<typeof prisma.event.create>> = [];
  if (userMessage) {
    ops.push(prisma.event.create({ data: { chatId, role: 'user', content: userMessage, ownerId } }));
  }
  if (assistantReply) {
    ops.push(prisma.event.create({ data: { chatId, role: 'assistant', content: assistantReply, ownerId } }));
  }
  await prisma.$transaction(ops);
}

export async function handleTenantMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
  ownerId: string,
  tenantId: string,
  tenantName: string | null,
): Promise<void> {
  logger.info({ chatId }, '[tenant.flow] Message received');

  const messageText = text ?? '';

  try {
    // 1. Emergency — hardcoded, zero LLM, highest priority
    if (detectEmergency(messageText)) {
      await sendText(chatId, EMERGENCY_REPLY);
      await persistTurn(chatId, ownerId, messageText, EMERGENCY_REPLY);

      const snapshot = await buildTenantSnapshot(chatId);
      const propertyName = snapshot?.property.name ?? 'imóvel não identificado';
      const displayName = tenantName ?? chatId;

      notifyOwner(ownerId, 'tenant_emergency', {
        tenantName: displayName,
        tenantPhone: chatId,
        propertyName,
      }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner tenant_emergency failed'));

      logActivity({
        ownerId,
        actorType: 'bot',
        actorLabel: 'Bot',
        action: 'tenant_emergency',
        subjectType: 'tenant',
        subjectId: tenantId,
        subject: displayName,
      }).catch((err) => logger.error({ err }, '[tenant.flow] logActivity tenant_emergency failed'));
      return;
    }

    // 2. Greeting — hardcoded, zero LLM (only for pure text, no media)
    if (mediaItems.length === 0) {
      const greeting = getTenantGreetingReply(messageText, tenantName);
      if (greeting) {
        await sendText(chatId, greeting);
        await persistTurn(chatId, ownerId, messageText, greeting);
        return;
      }
    }

    // 3. Audio — hardcoded fallback until T7 (transcription)
    const audioReceived = mediaItems.some(isAudioMedia);
    if (audioReceived && !messageText) {
      await sendText(chatId, AUDIO_FALLBACK_REPLY);
      await persistTurn(chatId, ownerId, null, AUDIO_FALLBACK_REPLY);
      return;
    }

    // 4. Frustration → escalate before spending an LLM call
    if (detectFrustration(messageText)) {
      await escalateTenantToOwner(chatId, ownerId, tenantId, tenantName, 'frustration');
      await persistTurn(chatId, ownerId, messageText || null, null);
      return;
    }

    // 5. Snapshot — factual context for the agent
    const snapshot = await buildTenantSnapshot(chatId);
    if (!snapshot) {
      logger.error({ chatId }, '[tenant.flow] Snapshot ausente — notificando owner');
      notifyOwner(ownerId, 'tenant_escalation', {
        tenantName: tenantName ?? chatId,
        tenantPhone: chatId,
        reason: 'Snapshot do inquilino não encontrado — inconsistência de dados',
      }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner snapshot ausente falhou'));
      const neutralReply = 'Estou com uma instabilidade agora. Já avisei a equipe — tente de novo em instantes.';
      await sendText(chatId, neutralReply);
      await persistTurn(chatId, ownerId, messageText || null, neutralReply);
      return;
    }
    const tenantContext = renderTenantContext(snapshot);

    // 6. Chat history + question for the agent
    const chatHistory = await loadChatHistory(chatId);
    const question =
      messageText || (audioReceived ? 'O usuario enviou um audio sem texto.' : 'O usuario enviou apenas midia.');

    // 7. Run the tenant agent
    const tools = buildTenantTools({ chatId, tenantId, ownerId, tenantName });
    let replyText: string;
    try {
      replyText = await runTenantAgentV2(question, tenantContext, chatHistory, tools);
    } catch (err) {
      logger.error({ err }, '[tenant.flow] runTenantAgentV2 failed');
      replyText = 'Desculpe, tive um problema para processar sua mensagem. Pode tentar de novo?';
    }

    // If the agent escalated (via escalar_owner), the bot is paused and the
    // tenant was already notified inside escalateTenantToOwner — don't send twice.
    const conv = await prisma.conversation.findUnique({ where: { chatId } });
    if (conv?.botPaused) {
      await persistTurn(chatId, ownerId, messageText || null, null);
      return;
    }

    await persistTurn(chatId, ownerId, messageText || null, replyText);
    await sendText(chatId, replyText);
  } catch (err) {
    logger.error({ err }, '[tenant.flow] Unhandled error');
  }
}
