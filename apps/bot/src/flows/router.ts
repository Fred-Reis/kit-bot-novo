import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { handleLeadMessage } from '@/flows/lead/index';
import { handleTenantMessage } from '@/flows/tenant/index';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';

export async function routeMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
): Promise<void> {
  const owner = await prisma.owner.findFirst();
  if (!owner) {
    logger.error('[router] No owner record found — cannot route message');
    return;
  }

  const [existing, tenant, conversation] = await Promise.all([
    prisma.lead.findUnique({ where: { phone: chatId }, select: { id: true } }),
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

  const lead = await prisma.lead.upsert({
    where: { phone: chatId },
    update: {},
    create: { phone: chatId, stage: 'interest', source: 'whatsapp', ownerId: owner.id },
  });

  if (!existing) {
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_created',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_created failed'));
  }

  await handleLeadMessage(chatId, text, mediaItems, owner.id);
}
