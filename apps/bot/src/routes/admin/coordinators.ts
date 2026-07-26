import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '@/db/client';
import { VALID_RESPONSIBILITIES, validateResponsibilities } from '@/lib/coordinator-responsibilities';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { invalidateAvailablePropertiesCache, invalidatePropertyCache } from '@/services/catalog';

function sendInvalidResponsibilities(reply: FastifyReply) {
  return reply
    .status(400)
    .send({ error: `responsibilities must be an array of: ${[...VALID_RESPONSIBILITIES].join(', ')}` });
}

export async function coordinatorsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── list coordinators ──────────────────────────────────────────────────
  fastify.get('/admin/coordinators', { preHandler: verifyAdminJwt }, async (_request, reply) => {
    const coordinators = await prisma.coordinator.findMany({
      include: { _count: { select: { properties: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(coordinators);
  });

  // ─── create coordinator ─────────────────────────────────────────────────
  fastify.post<{ Body: { name: string; phone: string } }>(
    '/admin/coordinators',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, phone } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      if (!phone) return reply.status(400).send({ error: 'phone is required' });
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const coordinator = await prisma.coordinator.create({
        data: { name, phone, ownerId: owner.id },
      });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_created',
        subject: coordinator.name,
        subjectId: coordinator.id,
        subjectType: 'coordinator',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send(coordinator);
    },
  );

  // ─── update coordinator ─────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { name?: string; phone?: string } }>(
    '/admin/coordinators/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { name, phone } = request.body;
      if (name !== undefined && !name) return reply.status(400).send({ error: 'name cannot be empty' });
      if (phone !== undefined && !phone) return reply.status(400).send({ error: 'phone cannot be empty' });
      const existing = await prisma.coordinator.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Coordinator not found' });
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (phone !== undefined) data.phone = phone;
      const coordinator = await prisma.coordinator.update({ where: { id }, data });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_updated',
        subject: coordinator.name,
        subjectId: coordinator.id,
        subjectType: 'coordinator',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send(coordinator);
    },
  );

  // ─── delete coordinator ─────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/coordinators/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await prisma.coordinator.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Coordinator not found' });
      const linked = await prisma.propertyCoordinator.count({ where: { coordinatorId: id } });
      if (linked > 0) {
        return reply.status(409).send({ error: 'Coordinator is linked to properties — unlink first' });
      }
      await prisma.coordinator.delete({ where: { id } });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: existing.ownerId,
        action: 'coordinator_deleted',
        subject: existing.name,
        subjectId: existing.id,
        subjectType: 'coordinator',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send({ success: true });
    },
  );

  // ─── link property to coordinator ──────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { propertyId: string; responsibilities: string[] } }>(
    '/admin/coordinators/:id/properties',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { propertyId } = request.body;
      if (!propertyId) return reply.status(400).send({ error: 'propertyId is required' });
      const responsibilities = validateResponsibilities(request.body.responsibilities);
      if (!responsibilities) return sendInvalidResponsibilities(reply);
      const coordinator = await prisma.coordinator.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      if (!coordinator) return reply.status(404).send({ error: 'Coordinator not found' });
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true, ownerId: true },
      });
      if (!property || property.ownerId !== coordinator.ownerId) {
        return reply.status(404).send({ error: 'Property not found' });
      }
      const existing = await prisma.propertyCoordinator.findUnique({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Property is already linked to this coordinator' });
      }
      await prisma.propertyCoordinator.create({
        data: { coordinatorId: id, propertyId, responsibilities },
      });
      await invalidatePropertyCache(propertyId);
      await invalidateAvailablePropertiesCache();
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_linked',
        subject: coordinator.name,
        subjectId: id,
        subjectType: 'coordinator',
        metadata: { propertyId, responsibilities },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send({ success: true });
    },
  );

  // ─── update link responsibilities ──────────────────────────────────────
  fastify.patch<{
    Params: { id: string; propertyId: string };
    Body: { responsibilities: string[] };
  }>(
    '/admin/coordinators/:id/properties/:propertyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, propertyId } = request.params;
      const responsibilities = validateResponsibilities(request.body.responsibilities);
      if (!responsibilities) return sendInvalidResponsibilities(reply);
      const existing = await prisma.propertyCoordinator.findUnique({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      if (!existing) return reply.status(404).send({ error: 'Link not found' });
      const link = await prisma.propertyCoordinator.update({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
        data: { responsibilities },
      });
      await invalidatePropertyCache(propertyId);
      await invalidateAvailablePropertiesCache();
      return reply.send(link);
    },
  );

  // ─── unlink property from coordinator ──────────────────────────────────
  fastify.delete<{ Params: { id: string; propertyId: string } }>(
    '/admin/coordinators/:id/properties/:propertyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, propertyId } = request.params;
      const coordinator = await prisma.coordinator.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      const existing = await prisma.propertyCoordinator.findUnique({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      if (!existing || !coordinator) return reply.status(404).send({ error: 'Link not found' });
      await prisma.propertyCoordinator.delete({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      await invalidatePropertyCache(propertyId);
      await invalidateAvailablePropertiesCache();
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_unlinked',
        subject: coordinator.name,
        subjectId: id,
        subjectType: 'coordinator',
        metadata: { propertyId },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send({ success: true });
    },
  );

  // ─── bulk-link coordinator to all active properties ────────────────────
  fastify.post<{ Params: { id: string }; Body: { responsibilities: string[] } }>(
    '/admin/coordinators/:id/properties/bulk-link',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const responsibilities = validateResponsibilities(request.body.responsibilities);
      if (!responsibilities) return sendInvalidResponsibilities(reply);
      const coordinator = await prisma.coordinator.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      if (!coordinator) return reply.status(404).send({ error: 'Coordinator not found' });

      const alreadyLinked = await prisma.propertyCoordinator.findMany({
        where: { coordinatorId: id },
        select: { propertyId: true },
      });
      const linkedIds = new Set(alreadyLinked.map((l) => l.propertyId));

      const targetProperties = await prisma.property.findMany({
        where: {
          ownerId: coordinator.ownerId,
          status: { not: 'archived' },
          id: { notIn: [...linkedIds] },
        },
        select: { id: true },
      });
      if (targetProperties.length === 0) {
        return reply.send({ success: true, propertyCount: 0 });
      }

      await prisma.$transaction(
        targetProperties.map((p) =>
          prisma.propertyCoordinator.create({
            data: { coordinatorId: id, propertyId: p.id, responsibilities },
          }),
        ),
      );
      await Promise.all(targetProperties.map((p) => invalidatePropertyCache(p.id)));
      await invalidateAvailablePropertiesCache();
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_bulk_linked',
        subject: coordinator.name,
        subjectId: id,
        subjectType: 'coordinator',
        metadata: { propertyCount: targetProperties.length, responsibilities },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send({ success: true, propertyCount: targetProperties.length });
    },
  );
}
