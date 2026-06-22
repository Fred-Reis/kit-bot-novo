import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { handleLeadMessage } from '@/flows/lead/index';
import { handleTenantMessage } from '@/flows/tenant/index';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';

export async function routeMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
  senderName?: string | null,
): Promise<void> {
  const owner = await prisma.owner.findFirst();
  if (!owner) {
    logger.error('[router] No owner record found — cannot route message');
    return;
  }

  // Check global bot enabled flag (cached 60s in Redis)
  const cacheKey = `bot:enabled:${owner.id}`;
  const cached = await redis.get(cacheKey);
  let botEnabled: boolean;
  if (cached !== null) {
    botEnabled = cached === '1';
  } else {
    botEnabled = owner.botEnabled;
    await redis.set(cacheKey, botEnabled ? '1' : '0', 'EX', 60);
  }
  if (!botEnabled) {
    logger.info({ chatId }, '[router] Bot globally disabled — message suppressed');
    return;
  }

  const [existingLead, tenant, conversation] = await Promise.all([
    prisma.lead.findUnique({
      where: { phone: chatId },
      select: { id: true, name: true, archivedAt: true },
    }),
    prisma.tenant.findUnique({ where: { phone: chatId } }),
    prisma.conversation.findUnique({ where: { chatId }, select: { botPaused: true } }),
  ]);

  if (tenant) {
    await handleTenantMessage(chatId, text);
    return;
  }

  if (conversation?.botPaused) {
    logger.info({ chatId }, '[router] Bot paused — message suppressed');
    return;
  }

  const isNew = !existingLead;
  const isReactivation = !!existingLead?.archivedAt;

  let lead: { id: string; name: string | null };
  if (isNew) {
    lead = await prisma.lead.create({
      data: { phone: chatId, stage: 'interest', source: 'whatsapp', ownerId: owner.id, name: senderName ?? null },
    });
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_created',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_created failed'));
  } else if (isReactivation) {
    lead = await prisma.lead.update({
      where: { phone: chatId },
      data: { archivedAt: null, reactivatedAt: new Date() },
    });
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_reactivated',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: lead.name ?? chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_reactivated failed'));
  } else {
    lead = existingLead;
  }

  await handleLeadMessage(chatId, text, mediaItems, owner.id);
}
