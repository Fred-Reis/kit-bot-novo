import { logger } from '@/lib/logger';

export async function handleTenantMessage(chatId: string, text: string | null): Promise<void> {
  logger.info({ chatId }, '[tenant] Flow not yet implemented');
  // Phase 2: implement financial, maintenance, and complaint flows
}
