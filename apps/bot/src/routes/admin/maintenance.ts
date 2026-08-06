import {
  MAINTENANCE_RESPONSIBILITIES,
  MAINTENANCE_STATUSES,
  type MaintenanceResponsibility,
  type MaintenanceStatus,
} from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';

const VALID_STATUSES: readonly MaintenanceStatus[] = MAINTENANCE_STATUSES;
const VALID_RESPONSIBILITIES: readonly MaintenanceResponsibility[] = MAINTENANCE_RESPONSIBILITIES;

// null = no message for that transition (e.g. reopening to "open" isn't a
// tenant-facing event worth a WhatsApp text).
const STATUS_TENANT_MESSAGE: Record<MaintenanceStatus, string | null> = {
  open: null,
  acknowledged: 'Seu chamado de manutenção foi reconhecido e está sendo avaliado.',
  in_progress: 'Seu chamado de manutenção está em andamento.',
  resolved: 'Seu chamado de manutenção foi concluído. Qualquer coisa, é só chamar 🙂',
};

export async function maintenanceRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch<{
    Params: { id: string };
    Body: { status?: MaintenanceStatus; responsibility?: MaintenanceResponsibility };
  }>('/admin/maintenance/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { status, responsibility } = request.body;

    if (status === undefined && responsibility === undefined) {
      return reply.status(400).send({ error: 'status or responsibility is required' });
    }
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }
    if (responsibility !== undefined && !VALID_RESPONSIBILITIES.includes(responsibility)) {
      return reply
        .status(400)
        .send({ error: `responsibility must be one of: ${VALID_RESPONSIBILITIES.join(', ')}` });
    }

    const existing = await prisma.maintenanceRequest.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Maintenance request not found' });

    const data: { status?: MaintenanceStatus; responsibility?: MaintenanceResponsibility } = {};
    if (status !== undefined) data.status = status;
    if (responsibility !== undefined) data.responsibility = responsibility;

    const { tenant, ...updated } = await prisma.maintenanceRequest.update({
      where: { id },
      data,
      include: { tenant: { select: { phone: true } } },
    });

    if (status !== undefined) {
      const tenantMessage = STATUS_TENANT_MESSAGE[status];
      if (tenantMessage) {
        sendText(tenant.phone, tenantMessage).catch((err) =>
          fastify.log.warn({ err }, 'Failed to notify tenant of maintenance status change'),
        );
      }
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
    }

    if (responsibility !== undefined) {
      // Owner manually correcting the LLM's tenant/owner/unclear classification
      // — this is the human-review step the design always assumed existed for
      // ambiguous cases, now actually reachable from the panel.
      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: updated.ownerId,
        action: 'maintenance_responsibility_changed',
        subject: updated.summary,
        subjectId: updated.id,
        subjectType: 'maintenance_request',
        metadata: { responsibility },
      }).catch(fastify.log.warn.bind(fastify.log));
    }

    return reply.send(updated);
  });
}
