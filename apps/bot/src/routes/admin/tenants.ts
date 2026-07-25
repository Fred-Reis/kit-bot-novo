import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { invalidateAvailablePropertiesCache, invalidatePropertyCache } from '@/services/catalog';
import { nextExternalId } from '@/services/external-id';

export async function tenantsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── create tenant ────────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      phone: string;
      propertyId: string;
      contractStart: string;
      name?: string;
      cpf?: string;
      email?: string;
      score?: number;
      dueDay?: number;
      onTimeRate?: number;
      contractEnd?: string;
    };
  }>('/admin/tenants', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { phone, propertyId, contractStart, ...rest } = request.body;

    if (!phone || !propertyId || !contractStart) {
      return reply
        .status(400)
        .send({ error: 'Missing required fields: phone, propertyId, contractStart' });
    }

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(400).send({ error: 'No owner found' });

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, status: true, ownerId: true },
    });
    if (!property || property.ownerId !== owner.id) {
      return reply.status(404).send({ error: 'Property not found' });
    }
    if (property.status === 'rented') {
      return reply.status(409).send({ error: 'Property is already rented' });
    }

    const externalId = await nextExternalId('tenant');

    const ALLOWED_TENANT_FIELDS = new Set([
      'name',
      'cpf',
      'email',
      'score',
      'dueDay',
      'onTimeRate',
      'contractEnd',
    ]);
    const sanitized: Record<string, string | number | Date | undefined> = Object.fromEntries(
      Object.entries(rest).filter(([k]) => ALLOWED_TENANT_FIELDS.has(k)),
    );
    if (sanitized.contractEnd) {
      sanitized.contractEnd = new Date(sanitized.contractEnd as string);
    }

    const [tenant] = await prisma.$transaction([
      prisma.tenant.create({
        data: {
          phone,
          propertyId,
          contractStart: new Date(contractStart),
          externalId,
          ownerId: owner.id,
          ...sanitized,
        },
      }),
      prisma.property.update({
        where: { id: propertyId },
        data: { status: 'rented', active: false },
      }),
    ]);

    await invalidatePropertyCache(propertyId);
    await invalidateAvailablePropertiesCache();

    await logActivityHelper({
      ownerId: owner.id,
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'Admin',
      action: 'tenant_created',
      subjectType: 'tenant',
      subjectId: tenant.id,
      subject: tenant.name ?? tenant.phone,
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send({ success: true, id: tenant.id, tenant });
  });
}
