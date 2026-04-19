import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { handleLeadMessage } from '@/flows/lead/index';
import { handleTenantMessage } from '@/flows/tenant/index';

export async function routeMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
): Promise<void> {
  // Find or create the lead record
  await prisma.lead.upsert({
    where: { phone: chatId },
    update: {},
    create: { phone: chatId, stage: 'interest' },
  });

  // Check if this phone has an active Tenant record
  const tenant = await prisma.tenant.findUnique({ where: { phone: chatId } });

  if (tenant) {
    await handleTenantMessage(chatId, text);
  } else {
    await handleLeadMessage(chatId, text, mediaItems);
  }
}
