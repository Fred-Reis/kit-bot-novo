import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { invalidateTenantSnapshotCache } from '@/flows/tenant/context';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function paymentsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── list payments ────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: { type?: string; period?: string; limit?: string };
  }>('/admin/payments', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { type, period, limit: limitStr } = request.query;
    const parsed = parseInt(limitStr ?? '', 10);
    const limit = !isNaN(parsed) && parsed > 0 ? Math.min(parsed, 200) : 50;

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.send([]);

    const where: Prisma.PaymentWhereInput = { ownerId: owner.id };
    if (type === 'income' || type === 'expense') where.type = type;
    if (period && MONTH_REGEX.test(period)) where.month = period;

    const payments = await prisma.payment.findMany({
      where,
      orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    return reply.send(payments);
  });

  // ─── create payment (manual) ──────────────────────────────────────────────
  fastify.post<{
    Body: {
      type: string;
      amount: number;
      month: string;
      description?: string;
      status?: string;
      inquilinoId?: string;
      propertyId?: string;
    };
  }>('/admin/payments', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { type, amount, month, description, inquilinoId, propertyId } = request.body;
    const status = request.body.status ?? 'paid';

    if (type !== 'income' && type !== 'expense') {
      return reply.status(400).send({ error: "type must be 'income' or 'expense'" });
    }
    if (amount == null || isNaN(Number(amount)) || Number(amount) <= 0) {
      return reply.status(400).send({ error: 'amount must be a positive number' });
    }
    if (!month || !MONTH_REGEX.test(month)) {
      return reply.status(400).send({ error: 'month must be in YYYY-MM format' });
    }
    if (!['paid', 'pending', 'overdue'].includes(status)) {
      return reply.status(400).send({ error: "status must be 'paid', 'pending', or 'overdue'" });
    }
    if (type === 'income' && !inquilinoId) {
      return reply.status(400).send({ error: 'inquilinoId is required for income payments' });
    }
    if (type === 'expense' && !propertyId) {
      return reply.status(400).send({ error: 'propertyId is required for expense payments' });
    }
    if (type === 'expense' && !description) {
      return reply.status(400).send({ error: 'description is required for expense payments' });
    }

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(400).send({ error: 'No owner found' });

    let tenantPhone: string | null = null;
    if (type === 'income' && inquilinoId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: inquilinoId } });
      if (!tenant) return reply.status(400).send({ error: 'Tenant not found' });
      tenantPhone = tenant.phone;
    }
    if (type === 'expense' && propertyId) {
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      if (!property) return reply.status(400).send({ error: 'Property not found' });
    }

    const payment = await prisma.payment.create({
      data: {
        ownerId: owner.id,
        tenantId: type === 'income' ? inquilinoId : null,
        propertyId: type === 'expense' ? propertyId : null,
        month,
        amount,
        status,
        description: description ?? null,
        type,
      },
    });

    logActivityHelper({
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: owner.id,
      action: 'payment_recorded',
      subject: description ?? (type === 'income' ? 'Receita' : 'Despesa'),
      subjectId: payment.id,
      subjectType: 'payment',
    }).catch(fastify.log.warn.bind(fastify.log));

    if (tenantPhone) {
      invalidateTenantSnapshotCache(tenantPhone).catch(fastify.log.warn.bind(fastify.log));
    }

    return reply.status(201).send({ ...payment, amount: Number(payment.amount) });
  });
}
