import { MAINTENANCE_STATUSES, type MaintenanceStatus } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';

const VALID_STATUSES: readonly MaintenanceStatus[] = MAINTENANCE_STATUSES;

export async function maintenanceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch<{ Params: { id: string }; Body: { status: MaintenanceStatus } }>(
    '/admin/maintenance/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;
      if (!VALID_STATUSES.includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const existing = await prisma.maintenanceRequest.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Maintenance request not found' });
      const updated = await prisma.maintenanceRequest.update({ where: { id }, data: { status } });
      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: updated.ownerId,
        action: 'maintenance_status_changed',
        subject: updated.summary,
        subjectId: updated.id,
        subjectType: 'maintenance_request',
        metadata: { status },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send(updated);
    },
  );
}
