import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';

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
}
