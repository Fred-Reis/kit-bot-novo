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
import { createLeadDocumentUrl } from '@/services/storage';

const CHAT_HISTORY_LIMIT = 10;
const EMERGENCY_SNAPSHOT_TIMEOUT_MS = 2000;
const EMERGENCY_UNKNOWN_PROPERTY = 'imóvel não identificado';
const MEDIA_FORWARDED_REPLY = 'Recebi, encaminhei ao proprietário.';
const MEDIA_ATTACHED_REPLY = 'Recebi a foto, anexei ao chamado ✅';

function isAudioMedia(item: MediaItem): boolean {
  return (item.mime ?? '').startsWith('audio/') || (item.type ?? '').startsWith('audio');
}

function extractMediaUrls(items: MediaItem[]): string[] {
  return items.map((m) => m.url).filter((u): u is string => Boolean(u));
}

// Shared by the media pipeline and the frustration branch — both need to
// enrich an already-open chamado with incoming photos. Never throws: any
// failure (lookup, race with a concurrent resolve, infra) just means "did
// not attach", leaving the caller free to fall back (forward to owner) or,
// for frustration, to escalate regardless since a human is taking over anyway.
async function attachMediaToOpenChamado(tenantId: string, mediaUrls: string[]): Promise<boolean> {
  if (mediaUrls.length === 0) return false;
  try {
    const openRequest = await prisma.maintenanceRequest.findFirst({
      where: { tenantId, status: { in: ['open', 'acknowledged'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!openRequest) return false;
    // updateMany + status filter (not a plain `update`) closes the race
    // where the chamado gets resolved between the lookup and this write.
    const { count } = await prisma.maintenanceRequest.updateMany({
      where: { id: openRequest.id, status: { in: ['open', 'acknowledged'] } },
      data: { mediaUrls: { push: mediaUrls } },
    });
    return count > 0;
  } catch (err) {
    logger.error({ err, tenantId }, '[tenant.flow] falha ao tentar anexar mídia a chamado aberto');
    return false;
  }
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
    // 1. Emergency — hardcoded, zero LLM, highest priority. notifyOwner is
    // the single most important side effect here (a real fire/gas/flood) —
    // it must never be skipped because persisting history, replying to the
    // tenant, or looking up the property name happened to fail first, so
    // every side effect below is independent and best-effort.
    if (detectEmergency(messageText)) {
      const displayName = tenantName ?? chatId;

      // buildTenantSnapshot must never delay the emergency response — a hung
      // Redis/DB connection (no timeout configured on either client) could
      // otherwise block every side effect indefinitely. Race it against a
      // hard cap, and — critically — don't await that race before starting
      // the batch below: only the notifyOwner entry depends on it (chained,
      // not awaited up front), so sendText/persistTurn/logActivity are
      // invoked in the same tick, never delayed by a slow property lookup.
      let propertyNameTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const propertyNamePromise = Promise.race([
        buildTenantSnapshot(chatId)
          .then((snapshot) => snapshot?.property.name ?? EMERGENCY_UNKNOWN_PROPERTY)
          .catch((err) => {
            logger.error(
              { err, chatId },
              '[tenant.flow] buildTenantSnapshot falhou na emergência — segue sem nome do imóvel',
            );
            return EMERGENCY_UNKNOWN_PROPERTY;
          }),
        new Promise<string>((resolve) => {
          propertyNameTimeoutId = setTimeout(() => resolve(EMERGENCY_UNKNOWN_PROPERTY), EMERGENCY_SNAPSHOT_TIMEOUT_MS);
        }),
      ]).finally(() => {
        // Promise.race doesn't cancel the losing entry — if buildTenantSnapshot
        // wins, this timer would otherwise sit armed until it fires on its own,
        // leaking one timer per fast-resolving emergency under volume.
        if (propertyNameTimeoutId !== undefined) clearTimeout(propertyNameTimeoutId);
      });

      await Promise.allSettled([
        propertyNamePromise
          .then((propertyName) =>
            notifyOwner(ownerId, 'tenant_emergency', {
              tenantName: displayName,
              tenantPhone: chatId,
              propertyName,
            }),
          )
          .catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner tenant_emergency failed')),
        logActivity({
          ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'tenant_emergency',
          subjectType: 'tenant',
          subjectId: tenantId,
          subject: displayName,
        }).catch((err) => logger.error({ err }, '[tenant.flow] logActivity tenant_emergency failed')),
        persistTurn(chatId, ownerId, messageText, EMERGENCY_REPLY).catch((err) =>
          logger.error({ err, chatId }, '[tenant.flow] persistTurn falhou na emergência'),
        ),
        sendText(chatId, EMERGENCY_REPLY).catch((err) =>
          logger.error({ err, chatId }, '[tenant.flow] sendText falhou na emergência'),
        ),
      ]);
      return;
    }

    // 2. Non-audio media — deterministic pipeline (design §3, nota T3).
    // Zero LLM: attaches to an already-open chamado, or forwards to the
    // owner when there's nothing to attach to and no text accompanies it.
    // With text present, falls through to the agent (see step 7) with
    // pendingMediaUrls available for abrir_chamado to attach on creation.
    const nonAudioMedia = mediaItems.filter((item) => !isAudioMedia(item));
    if (nonAudioMedia.length > 0 && !messageText) {
      const displayName = tenantName ?? chatId;
      const mediaUrls = extractMediaUrls(nonAudioMedia);

      // Shared by both the "no open chamado" case and the "attach failed
      // unexpectedly" case below — the owner still needs the signed links
      // (not the raw storage paths, which aren't reachable without auth),
      // and the tenant must always get a reply, even if notify/log fail.
      const forwardMediaToOwner = async (): Promise<void> => {
        const signedMediaUrls = await Promise.all(
          mediaUrls.map((path) =>
            createLeadDocumentUrl(path).catch((err) => {
              logger.error({ err, path }, '[tenant.flow] falha ao assinar URL de mídia pro forward ao owner');
              return null;
            }),
          ),
        );
        await Promise.allSettled([
          notifyOwner(ownerId, 'tenant_media_forwarded', {
            tenantName: displayName,
            tenantPhone: chatId,
            mediaUrls: signedMediaUrls.filter((u): u is string => Boolean(u)),
          }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner tenant_media_forwarded failed')),
          logActivity({
            ownerId,
            actorType: 'bot',
            actorLabel: 'Bot',
            action: 'tenant_media_forwarded',
            subjectType: 'tenant',
            subjectId: tenantId,
            subject: displayName,
          }).catch((err) => logger.error({ err }, '[tenant.flow] logActivity tenant_media_forwarded failed')),
          persistTurn(chatId, ownerId, null, MEDIA_FORWARDED_REPLY).catch((err) =>
            logger.error({ err, chatId }, '[tenant.flow] persistTurn falhou no forward de mídia'),
          ),
          sendText(chatId, MEDIA_FORWARDED_REPLY).catch((err) =>
            logger.error({ err, chatId }, '[tenant.flow] sendText falhou no forward de mídia'),
          ),
        ]);
      };

      if (await attachMediaToOpenChamado(tenantId, mediaUrls)) {
        // Isolated (not one shared try/catch): the attach itself already
        // succeeded, so a failure in either of these must not stop the
        // other, and must never bubble up to fall through to
        // forwardMediaToOwner (which would mislabel already-attached media).
        await persistTurn(chatId, ownerId, null, MEDIA_ATTACHED_REPLY).catch((err) =>
          logger.error({ err, chatId }, '[tenant.flow] persistTurn falhou após anexar mídia'),
        );
        await sendText(chatId, MEDIA_ATTACHED_REPLY).catch((err) =>
          logger.error({ err, chatId }, '[tenant.flow] sendText falhou após anexar mídia'),
        );
        return;
      }

      await forwardMediaToOwner();
      return;
    }

    // 3. Greeting — hardcoded, zero LLM (only for pure text, no media)
    if (mediaItems.length === 0) {
      const greeting = getTenantGreetingReply(messageText, tenantName);
      if (greeting) {
        await persistTurn(chatId, ownerId, messageText, greeting);
        await sendText(chatId, greeting);
        return;
      }
    }

    // 4. Audio — hardcoded fallback until T7 (transcription)
    const audioReceived = mediaItems.some(isAudioMedia);
    if (audioReceived && !messageText) {
      await persistTurn(chatId, ownerId, null, AUDIO_FALLBACK_REPLY);
      await sendText(chatId, AUDIO_FALLBACK_REPLY);
      return;
    }

    // 5. Frustration → escalate before spending an LLM call
    if (detectFrustration(messageText)) {
      // A photo attached to a frustrated message (e.g. "isso aqui é um
      // lixo" + another photo of the same problem) must not vanish —
      // silently enrich an already-open chamado if there is one. No
      // separate owner notification here: escalateTenantToOwner already
      // notifies the owner that a human needs to step in, and a photo with
      // no open chamado to attach to just stays in Storage for the human to
      // ask for again — not worth a second, confusing notification.
      if (nonAudioMedia.length > 0) {
        await attachMediaToOpenChamado(tenantId, extractMediaUrls(nonAudioMedia));
      }
      await escalateTenantToOwner(chatId, ownerId, tenantId, tenantName, 'frustration');
      await persistTurn(chatId, ownerId, messageText || null, null);
      return;
    }

    // 6. Snapshot — factual context for the agent
    const snapshot = await buildTenantSnapshot(chatId);
    if (!snapshot) {
      logger.error({ chatId }, '[tenant.flow] Snapshot ausente — notificando owner');
      notifyOwner(ownerId, 'tenant_escalation', {
        tenantName: tenantName ?? chatId,
        tenantPhone: chatId,
        reason: 'Snapshot do inquilino não encontrado — inconsistência de dados',
      }).catch((err) => logger.error({ err }, '[tenant.flow] notifyOwner snapshot ausente falhou'));
      const neutralReply = 'Estou com uma instabilidade agora. Já avisei a equipe — tente de novo em instantes.';
      await persistTurn(chatId, ownerId, messageText || null, neutralReply);
      await sendText(chatId, neutralReply);
      return;
    }
    const tenantContext = renderTenantContext(snapshot);

    // 7. Chat history + question for the agent
    const chatHistory = await loadChatHistory(chatId);
    const question =
      messageText || (audioReceived ? 'O usuario enviou um audio sem texto.' : 'O usuario enviou apenas midia.');

    // 8. Run the tenant agent
    const tools = buildTenantTools({
      chatId,
      tenantId,
      ownerId,
      tenantName,
      propertyId: snapshot.property.id,
      pendingMediaUrls: extractMediaUrls(nonAudioMedia),
    });
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
