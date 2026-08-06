import type { ComplaintStatus } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';
import { sendText } from '@/services/evolution';

const VALID_STATUSES: ComplaintStatus[] = ['open', 'acknowledged', 'resolved'];

// null = no message for that transition (e.g. reopening to "open" isn't a
// tenant-facing event worth a WhatsApp text).
const STATUS_TENANT_MESSAGE: Record<ComplaintStatus, string | null> = {
  open: null,
  acknowledged: 'Sua reclamação foi recebida e está sendo analisada pelo proprietário.',
  resolved: 'Sua reclamação foi marcada como resolvida. Qualquer coisa, é só chamar 🙂',
};

export async function complaintsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch<{ Params: { id: string }; Body: { status: ComplaintStatus } }>(
    '/admin/complaints/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;
      if (!VALID_STATUSES.includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const existing = await prisma.complaint.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Complaint not found' });
      const { tenant, ...complaint } = await prisma.complaint.update({
        where: { id },
        data: { status },
        include: { tenant: { select: { phone: true } } },
      });

      const tenantMessage = STATUS_TENANT_MESSAGE[status];
      if (tenantMessage) {
        sendText(tenant.phone, tenantMessage).catch((err) =>
          fastify.log.warn({ err }, 'Failed to notify tenant of complaint status change'),
        );
      }

      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: complaint.ownerId,
        action: 'complaint_status_changed',
        subject: complaint.summary,
        subjectId: complaint.id,
        subjectType: 'complaint',
        metadata: { status },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send(complaint);
    },
  );
}
