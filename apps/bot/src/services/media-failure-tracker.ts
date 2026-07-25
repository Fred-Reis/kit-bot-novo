import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';
import { notifyOwner } from '@/services/notify';

const FAILURE_TTL_SECONDS = 3600;
const FAILURE_THRESHOLD = 2;

/**
 * Tracks repeated media-receive failures (upload to Storage, or Evolution
 * never giving us a usable base64) for the same lead. Per lead-flow-v2 spec
 * §2.8: 2 failures in a row → notify the owner (without pausing the bot —
 * this is an infra hiccup, not a conversation the bot is stuck in).
 */
export async function recordMediaFailure(chatId: string): Promise<void> {
  const key = `media_fail:${chatId}`;
  // redis.incr is atomic and returns a value unique to this call — two
  // concurrent failures can never both observe the same count, so reacting
  // to the *exact* threshold (rather than >=) means only one caller ever
  // notifies, even under a concurrent burst of failures.
  const count = await redis.incr(key);
  await redis.expire(key, FAILURE_TTL_SECONDS);

  if (count !== FAILURE_THRESHOLD) return;

  // Reset so a later, unrelated streak still needs FAILURE_THRESHOLD of its
  // own to notify again.
  await redis.del(key);

  const lead = await prisma.lead.findUnique({
    where: { phone: chatId },
    select: { name: true, phone: true, ownerId: true },
  });
  if (!lead) return;

  notifyOwner(lead.ownerId, 'media_receive_failure', {
    leadName: lead.name ?? lead.phone,
    leadPhone: lead.phone,
    failureCount: count,
  }).catch((err) => logger.error({ err }, '[media-failure-tracker] notifyOwner failed'));
}

/**
 * Clears the failure streak after a successful media receipt — the spec's
 * "2 failures in a row" shouldn't accumulate across unrelated successes.
 */
export async function resetMediaFailures(chatId: string): Promise<void> {
  await redis.del(`media_fail:${chatId}`);
}
