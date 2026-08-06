import { SERVICE_CATEGORIES, type ServiceProviderType } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';

const VALID_TYPES: readonly ServiceProviderType[] = SERVICE_CATEGORIES;

export async function providersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/admin/providers', { preHandler: verifyAdminJwt }, async (_request, reply) => {
    const providers = await prisma.serviceProvider.findMany({ orderBy: { createdAt: 'asc' } });
    return reply.send(providers);
  });

  fastify.post<{ Body: { name: string; phone: string; type: ServiceProviderType } }>(
    '/admin/providers',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, phone, type } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      if (!phone) return reply.status(400).send({ error: 'phone is required' });
      if (!VALID_TYPES.includes(type)) {
        return reply.status(400).send({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
      }
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const provider = await prisma.serviceProvider.create({
        data: { name, phone, type, ownerId: owner.id },
      });
      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: provider.ownerId,
        action: 'provider_created',
        subject: provider.name,
        subjectId: provider.id,
        subjectType: 'service_provider',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send(provider);
    },
  );

  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; phone?: string; type?: ServiceProviderType; active?: boolean };
  }>('/admin/providers/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, phone, type, active } = request.body;
    if (name !== undefined && !name) return reply.status(400).send({ error: 'name cannot be empty' });
    if (phone !== undefined && !phone) return reply.status(400).send({ error: 'phone cannot be empty' });
    if (type !== undefined && !VALID_TYPES.includes(type)) {
      return reply.status(400).send({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    const existing = await prisma.serviceProvider.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Provider not found' });
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (type !== undefined) data.type = type;
    if (active !== undefined) data.active = active;
    const provider = await prisma.serviceProvider.update({ where: { id }, data });
    await logActivity({
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: provider.ownerId,
      action: 'provider_updated',
      subject: provider.name,
      subjectId: provider.id,
      subjectType: 'service_provider',
      metadata: { active: active ?? null },
    }).catch(fastify.log.warn.bind(fastify.log));
    return reply.send(provider);
  });
}
