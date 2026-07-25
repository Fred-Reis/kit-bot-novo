import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';

const STAGES_PAST_VISITING = new Set([
  'collection',
  'kyc_pending',
  'kyc_approved',
  'residents_docs_complete',
  'contract_pending',
  'contract_signed',
  'converted',
]);

export async function visitsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{
    Body: { leadId: string; propertyId: string; scheduledVisitAt: string; note?: string };
  }>('/admin/visits', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { leadId, propertyId, scheduledVisitAt, note } = request.body;

    if (!leadId || !propertyId || !scheduledVisitAt) {
      return reply
        .status(400)
        .send({ error: 'leadId, propertyId and scheduledVisitAt are required' });
    }

    const visitDate = new Date(scheduledVisitAt);
    if (isNaN(visitDate.getTime())) {
      return reply.status(400).send({ error: 'Invalid scheduledVisitAt date' });
    }

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(400).send({ error: 'No owner found' });

    const [lead, property] = await Promise.all([
      prisma.lead.findUnique({ where: { id: leadId } }),
      prisma.property.findUnique({ where: { id: propertyId } }),
    ]);
    if (!lead || lead.ownerId !== owner.id) {
      return reply.status(404).send({ error: 'Lead not found' });
    }
    if (lead.archivedAt) {
      return reply.status(409).send({ error: 'Cannot schedule visit for archived lead' });
    }
    if (STAGES_PAST_VISITING.has(lead.stage)) {
      return reply
        .status(409)
        .send({ error: 'Cannot schedule visit: lead is already past the visiting stage' });
    }
    if (!property || property.ownerId !== owner.id) {
      return reply.status(404).send({ error: 'Property not found' });
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { scheduledVisitAt: visitDate, stage: 'visiting', propertyId },
    });

    logActivityHelper({
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'Admin',
      ownerId: owner.id,
      action: 'visit_scheduled',
      subject: lead.name ?? lead.phone,
      subjectId: leadId,
      subjectType: 'lead',
      metadata: { scheduledVisitAt, note: note ?? null },
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send({ leadId, scheduledVisitAt: updated.scheduledVisitAt });
  });

  fastify.patch<{ Params: { id: string } }>(
    '/admin/leads/:id/complete-visit',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead || lead.ownerId !== owner.id) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.archivedAt) {
        return reply.status(409).send({ error: 'Cannot complete visit for archived lead' });
      }

      if (!lead.scheduledVisitAt) {
        return reply.status(409).send({ error: 'No visit scheduled for this lead' });
      }

      if (lead.visitedAt) {
        return reply.status(409).send({ error: 'Visit already completed' });
      }

      const updated = await prisma.lead.update({
        where: { id },
        data: { visitedAt: new Date(), stage: 'post_visit_decision' },
      });

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'Admin',
        ownerId: owner.id,
        action: 'visit_completed',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ leadId: id, visitedAt: updated.visitedAt, stage: updated.stage });
    },
  );

  // ─── update visit status ─────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/admin/leads/:id/visit-status',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;

      if (!['upcoming', 'completed', 'cancelled'].includes(status)) {
        return reply.status(400).send({ error: 'status must be upcoming | completed | cancelled' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead || lead.ownerId !== owner.id) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      let data: Prisma.LeadUpdateInput;
      let action: 'visit_completed' | 'visit_cancelled' | 'visit_scheduled';

      if (status === 'completed') {
        if (STAGES_PAST_VISITING.has(lead.stage)) {
          return reply.status(409).send({
            error: 'Cannot complete visit: lead is already past the visiting stage',
          });
        }
        data = { visitedAt: new Date(), stage: 'post_visit_decision' };
        action = 'visit_completed';
      } else if (status === 'cancelled') {
        data = { scheduledVisitAt: null, visitedAt: null };
        action = 'visit_cancelled';
      } else {
        if (STAGES_PAST_VISITING.has(lead.stage)) {
          return reply.status(409).send({
            error: 'Cannot set visit to upcoming: lead is already past the visiting stage',
          });
        }
        if (!lead.scheduledVisitAt) {
          return reply.status(409).send({
            error: 'Cannot set visit to upcoming: no scheduledVisitAt on this lead',
          });
        }
        data = { visitedAt: null, stage: 'visiting' };
        action = 'visit_scheduled';
      }

      await prisma.lead.update({ where: { id }, data });

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'Admin',
        ownerId: owner.id,
        action,
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
        metadata: { status },
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ leadId: id, status });
    },
  );

  // ─── reschedule visit ─────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { scheduledVisitAt: string } }>(
    '/admin/leads/:id/scheduled-visit',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { scheduledVisitAt } = request.body;

      if (!scheduledVisitAt) {
        return reply.status(400).send({ error: 'scheduledVisitAt is required' });
      }

      const visitDate = new Date(scheduledVisitAt);
      if (isNaN(visitDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid scheduledVisitAt date' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead || lead.ownerId !== owner.id) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.archivedAt) {
        return reply.status(409).send({ error: 'Cannot reschedule visit for archived lead' });
      }

      const updated = await prisma.lead.update({
        where: { id },
        data: { scheduledVisitAt: visitDate },
      });

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'Admin',
        ownerId: owner.id,
        action: 'visit_scheduled',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
        metadata: { scheduledVisitAt },
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.status(201).send({ leadId: id, scheduledVisitAt: updated.scheduledVisitAt });
    },
  );
}
