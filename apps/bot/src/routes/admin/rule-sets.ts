import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';

const VALID_POLICY_VALUES = new Set(['yes', 'no', 'conditional']);

export async function ruleSetsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── list rule sets ───────────────────────────────────────────────────────
  fastify.get('/admin/rule-sets', { preHandler: verifyAdminJwt }, async (_request, reply) => {
    const ruleSets = await prisma.ruleSet.findMany({
      include: { _count: { select: { policies: true, properties: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(ruleSets);
  });

  // ─── create rule set ──────────────────────────────────────────────────────
  fastify.post<{ Body: { name: string; description?: string } }>(
    '/admin/rule-sets',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, description } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const ruleSet = await prisma.ruleSet.create({
        data: { name, description, ownerId: owner.id },
      });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: ruleSet.ownerId,
        action: 'rule_set_created',
        subject: ruleSet.name,
        subjectId: ruleSet.id,
        subjectType: 'rule_set',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send(ruleSet);
    },
  );

  // ─── update rule set ──────────────────────────────────────────────────────
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      propagatePolicies?: boolean;
      propagateClauses?: boolean;
      propagateFields?: boolean;
    };
  }>('/admin/rule-sets/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, propagatePolicies, propagateClauses, propagateFields } =
      request.body;
    const existing = await prisma.ruleSet.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Rule set not found' });
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (propagatePolicies !== undefined) data.propagatePolicies = propagatePolicies;
    if (propagateClauses !== undefined) data.propagateClauses = propagateClauses;
    if (propagateFields !== undefined) data.propagateFields = propagateFields;
    const ruleSet = await prisma.ruleSet.update({ where: { id }, data });
    return reply.send(ruleSet);
  });

  // ─── delete rule set ──────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/rule-sets/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await prisma.ruleSet.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Rule set not found' });
      const linked = await prisma.propertyRuleSet.count({ where: { ruleSetId: id } });
      if (linked > 0) {
        return reply.status(409).send({ error: 'Rule set is linked to properties — unlink first' });
      }
      await prisma.ruleSet.delete({ where: { id } });
      return reply.send({ success: true });
    },
  );

  // ─── add policy ───────────────────────────────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { name: string; description?: string; value?: string; appliesToProperty?: boolean };
  }>('/admin/rule-sets/:id/policies', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, description, value = 'no', appliesToProperty = true } = request.body;
    if (!name) return reply.status(400).send({ error: 'name is required' });
    if (!VALID_POLICY_VALUES.has(value)) {
      return reply
        .status(400)
        .send({ error: `value must be one of: ${[...VALID_POLICY_VALUES].join(', ')}` });
    }
    const ruleSet = await prisma.ruleSet.findUnique({ where: { id }, select: { id: true } });
    if (!ruleSet) return reply.status(404).send({ error: 'Rule set not found' });
    const policy = await prisma.ruleSetPolicy.create({
      data: { ruleSetId: id, name, description, value, appliesToProperty },
    });
    return reply.status(201).send(policy);
  });

  // ─── update policy ────────────────────────────────────────────────────────
  fastify.patch<{
    Params: { id: string; policyId: string };
    Body: { value?: string; appliesToProperty?: boolean };
  }>(
    '/admin/rule-sets/:id/policies/:policyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { policyId } = request.params;
      const { value, appliesToProperty } = request.body;
      const existing = await prisma.ruleSetPolicy.findUnique({
        where: { id: policyId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Policy not found' });
      if (value !== undefined && !VALID_POLICY_VALUES.has(value)) {
        return reply
          .status(400)
          .send({ error: `value must be one of: ${[...VALID_POLICY_VALUES].join(', ')}` });
      }
      const data: Record<string, unknown> = {};
      if (value !== undefined) data.value = value;
      if (appliesToProperty !== undefined) data.appliesToProperty = appliesToProperty;
      const policy = await prisma.ruleSetPolicy.update({ where: { id: policyId }, data });
      return reply.send(policy);
    },
  );

  // ─── delete policy ────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string; policyId: string } }>(
    '/admin/rule-sets/:id/policies/:policyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { policyId } = request.params;
      const existing = await prisma.ruleSetPolicy.findUnique({
        where: { id: policyId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Policy not found' });
      await prisma.ruleSetPolicy.delete({ where: { id: policyId } });
      return reply.send({ success: true });
    },
  );

  // ─── link property to rule set ────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { propertyId: string } }>(
    '/admin/rule-sets/:id/properties',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { propertyId } = request.body;
      if (!propertyId) return reply.status(400).send({ error: 'propertyId is required' });
      const ruleSet = await prisma.ruleSet.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      if (!ruleSet) return reply.status(404).send({ error: 'Rule set not found' });
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true, ownerId: true },
      });
      if (!property || property.ownerId !== ruleSet.ownerId) {
        return reply.status(404).send({ error: 'Property not found' });
      }
      const existing = await prisma.propertyRuleSet.findUnique({
        where: { propertyId_ruleSetId: { propertyId, ruleSetId: id } },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Property is already linked to this rule set' });
      }
      try {
        await prisma.propertyRuleSet.create({ data: { ruleSetId: id, propertyId } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.status(409).send({ error: 'Property is already linked to this rule set' });
        }
        throw err;
      }
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: ruleSet.ownerId,
        action: 'rule_set_linked',
        subject: ruleSet.name,
        subjectId: id,
        subjectType: 'rule_set',
        metadata: { propertyId },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send({ success: true });
    },
  );

  // ─── unlink property from rule set ───────────────────────────────────────
  fastify.delete<{ Params: { id: string; propertyId: string } }>(
    '/admin/rule-sets/:id/properties/:propertyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, propertyId } = request.params;
      const existing = await prisma.propertyRuleSet.findUnique({
        where: { propertyId_ruleSetId: { propertyId, ruleSetId: id } },
      });
      if (!existing) return reply.status(404).send({ error: 'Link not found' });
      try {
        await prisma.propertyRuleSet.delete({
          where: { propertyId_ruleSetId: { propertyId, ruleSetId: id } },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.status(404).send({ error: 'Link not found' });
        }
        throw err;
      }
      return reply.send({ success: true });
    },
  );
}
