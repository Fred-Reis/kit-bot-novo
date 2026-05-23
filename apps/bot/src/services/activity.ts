import type { LogActivityParams } from '@kit-manager/types';
import { prisma } from '../db/client';

export async function logActivity(params: LogActivityParams): Promise<void> {
  await prisma.activityLog.create({
    data: {
      ownerId: params.ownerId,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel,
      action: params.action,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subject: params.subject ?? null,
      metadata: params.metadata ?? {},
    },
  });
}
