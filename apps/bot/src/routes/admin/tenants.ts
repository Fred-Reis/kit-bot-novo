import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { invalidateAvailablePropertiesCache, invalidatePropertyCache } from '@/services/catalog';
import { nextExternalId } from '@/services/external-id';

class PropertyAlreadyRentedError extends Error {
  constructor() {
    super('Property is already rented');
    this.name = 'PropertyAlreadyRentedError';
  }
}

const ALLOWED_TENANT_FIELDS = new Set([
  'name',
  'cpf',
  'email',
  'score',
  'dueDay',
  'onTimeRate',
  'contractEnd',
]);

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

    const parsedContractStart = new Date(contractStart);
    if (isNaN(parsedContractStart.getTime())) {
      return reply.status(400).send({ error: 'contractStart must be a valid date' });
    }

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(400).send({ error: 'No owner found' });

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, ownerId: true },
    });
    if (!property || property.ownerId !== owner.id) {
      return reply.status(404).send({ error: 'Property not found' });
    }

    const externalId = await nextExternalId('tenant');

    const sanitized: Record<string, string | number | Date | undefined> = Object.fromEntries(
      Object.entries(rest).filter(([k]) => ALLOWED_TENANT_FIELDS.has(k)),
    );
    if (sanitized.contractEnd === '') {
      delete sanitized.contractEnd;
    } else if (sanitized.contractEnd !== undefined) {
      const parsedContractEnd = new Date(sanitized.contractEnd as string);
      if (isNaN(parsedContractEnd.getTime())) {
        return reply.status(400).send({ error: 'contractEnd must be a valid date' });
      }
      sanitized.contractEnd = parsedContractEnd;
    }

    let tenant;
    try {
      tenant = await prisma.$transaction(async (tx) => {
        // Conditional update — atomically claims the property only if it
        // isn't already rented, closing the race window between the
        // findUnique check above and this write.
        const { count } = await tx.property.updateMany({
          where: { id: propertyId, status: { not: 'rented' } },
          data: { status: 'rented', active: false },
        });
        if (count === 0) throw new PropertyAlreadyRentedError();

        return tx.tenant.create({
          data: {
            phone,
            propertyId,
            contractStart: parsedContractStart,
            externalId,
            ownerId: owner.id,
            ...sanitized,
          },
        });
      });
    } catch (err) {
      if (err instanceof PropertyAlreadyRentedError) {
        fastify.log.warn({ propertyId }, 'Tenant creation conflict: property already rented');
        return reply.status(409).send({ error: 'Property is already rented' });
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = err.meta?.target;
        const message =
          Array.isArray(target) && target.includes('phone')
            ? 'A tenant with this phone already exists'
            : 'A tenant with conflicting unique data already exists';
        fastify.log.warn({ target, phone }, 'Tenant creation conflict: unique constraint violated');
        return reply.status(409).send({ error: message });
      }
      throw err;
    }

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
