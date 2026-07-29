import type { ComplaintStatus } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';

const VALID_STATUSES: ComplaintStatus[] = ['open', 'acknowledged', 'resolved'];

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
      const complaint = await prisma.complaint.update({ where: { id }, data: { status } });
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
