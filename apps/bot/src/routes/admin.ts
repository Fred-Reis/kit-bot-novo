import type { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { sendText } from '@/services/evolution';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { config } from '@/config';
import type { LeadContext } from '@/flows/lead/context';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

const VALID_POLICY_VALUES = new Set(['yes', 'no', 'conditional']);

const PROPERTY_PATCH_FIELDS = new Set([
  'name', 'externalId', 'address', 'complement', 'neighborhood',
  'rent', 'deposit', 'depositInstallmentsMax', 'contractMonths',
  'rooms', 'bathrooms', 'area', 'maxAdults',
  'acceptsPets', 'acceptsChildren', 'includesWater', 'includesIptu',
  'individualElectricity', 'independentEntrance',
  'description', 'rulesText', 'visitSchedule', 'listingUrl', 'active',
]);

function logActivity(
  actor: string | null,
  action: string,
  subject: string,
  subjectId: string,
  subjectType: string,
  warn: (data: unknown, msg: string) => void,
): void {
  prisma.activityLog.create({ data: { actor, action, subject, subjectId, subjectType } })
    .catch((err: unknown) => warn({ err }, 'Failed to write activity log'));
}

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── update lead ──────────────────────────────────────────────────────────
  const VALID_LEAD_SOURCES = new Set(['whatsapp', 'zap', 'site', 'instagram', 'indicacao', 'other']);

  fastify.patch<{ Params: { id: string }; Body: { name?: string; source?: string; propertyId?: string } }>(
    '/admin/leads/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { name, source, propertyId } = request.body;

      if (source !== undefined && !VALID_LEAD_SOURCES.has(source)) {
        return reply.status(400).send({ error: `Invalid source. Must be one of: ${[...VALID_LEAD_SOURCES].join(', ')}` });
      }

      const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Lead not found' });

      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (source !== undefined) data.source = source;
      if (propertyId !== undefined) data.propertyId = propertyId;

      const lead = await prisma.lead.update({ where: { id }, data });
      return reply.send(lead);
    },
  );

  // ─── approve-kyc ──────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/approve-kyc',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { phone: true, name: true, stage: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const conv = await prisma.conversation.findUnique({ where: { chatId: lead.phone } });
      const ctx = (conv?.data ?? {}) as LeadContext;
      const extraResidents = ctx.residents?.length ?? 0;
      const nextStage = extraResidents > 0 ? 'kyc_approved' : 'residents_docs_complete';

      // Atomic update — only succeeds if stage is still 'kyc_pending'
      const { count } = await prisma.lead.updateMany({
        where: { id, stage: 'kyc_pending' },
        data: { stage: nextStage },
      });

      if (count === 0) {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'kyc_pending'`,
        });
      }

      const message =
        nextStage === 'residents_docs_complete'
          ? '✅ Seu KYC foi aprovado! Em breve entraremos em contato sobre o próximo passo.'
          : '✅ Seu KYC foi aprovado! Para prosseguir, precisamos dos documentos dos demais moradores.';

      await sendText(lead.phone, message).catch((err) => {
        fastify.log.warn({ err }, 'Failed to notify lead after KYC approval');
      });

      logActivity(request.adminUserId, 'aprovou KYC', lead.name ?? lead.phone, id, 'lead', fastify.log.warn.bind(fastify.log));

      return reply.send({ success: true, stage: nextStage });
    },
  );

  // ─── invalidate-property-cache ────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/admin/properties/:id/invalidate-cache',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const deleted = await redis.del(`property:${id}`);
      fastify.log.info({ propertyId: id, deleted }, 'Property cache invalidated');

      return reply.send({ success: true, keysDeleted: deleted });
    },
  );

  // ─── generate-contract ────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { paymentDayOfMonth: number } }>(
    '/admin/leads/:id/generate-contract',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { paymentDayOfMonth } = request.body;

      const lead = await prisma.lead.findUnique({ where: { id }, select: { phone: true, name: true, stage: true } });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const { count } = await prisma.lead.updateMany({
        where: { id, stage: 'residents_docs_complete' },
        data: { stage: 'contract_pending' },
      });

      if (count === 0) {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'residents_docs_complete'`,
        });
      }

      await sendText(
        lead.phone,
        `✅ Contrato em preparação! O vencimento será todo dia ${paymentDayOfMonth}. Entraremos em contato em breve.`,
      ).catch((err) => fastify.log.warn({ err }, 'Failed to notify lead after contract generation'));

      logActivity(request.adminUserId, 'gerou contrato', lead.name ?? lead.phone, id, 'lead', fastify.log.warn.bind(fastify.log));

      return reply.send({ success: true, stage: 'contract_pending' });
    },
  );

  // ─── confirm-payment ──────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/confirm-payment',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({ where: { id }, select: { phone: true, name: true, stage: true } });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const { count } = await prisma.lead.updateMany({
        where: { id, stage: 'contract_signed' },
        data: { stage: 'converted' },
      });

      if (count === 0) {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'contract_signed'`,
        });
      }

      logActivity(request.adminUserId, 'confirmou pagamento', lead.name ?? lead.phone, id, 'lead', fastify.log.warn.bind(fastify.log));

      return reply.send({ success: true, stage: 'converted' });
    },
  );

  // ─── create property ──────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      name: string; externalId?: string; address: string; neighborhood: string;
      rent: number; deposit: number; depositInstallmentsMax: number; rooms: number; bathrooms: number;
      title?: string; complement?: string; area?: number; parkingSpots?: number; amenities?: string[];
      type?: string; purpose?: string; status?: string; description?: string; rulesText?: string;
      visitSchedule?: string; listingUrl?: string; acceptsPets?: boolean; acceptsChildren?: boolean;
      maxAdults?: number; includesWater?: boolean; includesIptu?: boolean;
      individualElectricity?: boolean; contractMonths?: number; ownerId?: string;
    };
  }>(
    '/admin/properties',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, externalId: rawExternalId, address, neighborhood, rent, deposit, depositInstallmentsMax, rooms, bathrooms, ...rest } = request.body;

      if (!name || !address || !neighborhood || rent == null || deposit == null || depositInstallmentsMax == null || rooms == null || bathrooms == null) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      let externalId = rawExternalId;
      if (!externalId) {
        const count = await prisma.property.count();
        externalId = `IM-${String(count + 1).padStart(4, '0')}`;
      }

      const property = await prisma.property.create({
        data: { name, externalId, address, neighborhood, rent, deposit, depositInstallmentsMax, rooms, bathrooms, ownerId: rest.ownerId ?? owner.id, ...rest },
      });

      logActivity(request.adminUserId, 'publicou imóvel', property.name, property.id, 'property', fastify.log.warn.bind(fastify.log));

      return reply.status(201).send({ success: true, id: property.id, property });
    },
  );

  // ─── update property ──────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/properties/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const data = Object.fromEntries(
        Object.entries(request.body).filter(([k]) => PROPERTY_PATCH_FIELDS.has(k)),
      );

      const property = await prisma.property.update({ where: { id }, data });
      await redis.del(`property:${id}`);

      return reply.send(property);
    },
  );

  // ─── delete property (soft) ───────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/properties/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      await prisma.property.update({ where: { id }, data: { status: 'archived', active: false } });
      await redis.del(`property:${id}`);

      return reply.send({ success: true });
    },
  );

  // ─── delete property media ────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string; mediaId: string } }>(
    '/admin/properties/:id/media/:mediaId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, mediaId } = request.params;

      const media = await prisma.propertyMedia.findUnique({ where: { id: mediaId } });
      if (!media) return reply.status(404).send({ error: 'Media not found' });

      const urlPath = new URL(media.url).pathname;
      const storagePath = urlPath.split('/storage/v1/object/public/properties/')[1];
      if (storagePath) {
        await supabase.storage.from('properties').remove([storagePath]);
      }

      await prisma.propertyMedia.delete({ where: { id: mediaId } });
      await redis.del(`property:${id}`);

      return reply.send({ success: true });
    },
  );

  // ─── create tenant ────────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      phone: string; propertyId: string; contractStart: string;
      name?: string; cpf?: string; email?: string; score?: number;
      dueDay?: number; onTimeRate?: number; contractEnd?: string;
    };
  }>(
    '/admin/tenants',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { phone, propertyId, contractStart, ...rest } = request.body;

      if (!phone || !propertyId || !contractStart) {
        return reply.status(400).send({ error: 'Missing required fields: phone, propertyId, contractStart' });
      }

      const count = await prisma.tenant.count();
      const externalId = `IQ-${String(count + 1).padStart(3, '0')}`;

      const [tenant] = await prisma.$transaction([
        prisma.tenant.create({
          data: { phone, propertyId, contractStart: new Date(contractStart), externalId, ...rest },
        }),
        prisma.property.update({
          where: { id: propertyId },
          data: { status: 'rented', active: false },
        }),
      ]);

      await redis.del(`property:${propertyId}`);

      return reply.status(201).send({ success: true, id: tenant.id, tenant });
    },
  );

  // ─── signed upload URL for property media ─────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { fileName: string; contentType: string };
  }>(
    '/admin/properties/:id/media/signed-url',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { fileName, contentType } = request.body;

      if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
        return reply.status(400).send({ error: 'Unsupported file type' });
      }

      const ext = fileName.split('.').pop()?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
      const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { data, error } = await supabase.storage
        .from('properties')
        .createSignedUploadUrl(path);

      if (error || !data) {
        return reply.status(500).send({ error: 'Failed to create signed URL' });
      }

      return reply.send({ signedUrl: data.signedUrl, path, token: data.token });
    },
  );

  // ─── register property media after upload ─────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { path: string; type: 'photo' | 'video'; label?: string };
  }>(
    '/admin/properties/:id/media',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { path, type, label } = request.body;

      if (!path.startsWith(`${id}/`)) {
        return reply.status(400).send({ error: 'Invalid path for this property' });
      }

      const { data: { publicUrl } } = supabase.storage.from('properties').getPublicUrl(path);

      const media = await prisma.propertyMedia.create({
        data: { propertyId: id, url: publicUrl, type, label: label ?? null },
      });

      await redis.del(`property:${id}`);

      return reply.status(201).send({ success: true, media });
    },
  );

  // ─── list rule sets ───────────────────────────────────────────────────────
  fastify.get(
    '/admin/rule-sets',
    { preHandler: verifyAdminJwt },
    async (_request, reply) => {
      const ruleSets = await prisma.ruleSet.findMany({
        include: { _count: { select: { policies: true, properties: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send(ruleSets);
    },
  );

  // ─── create rule set ──────────────────────────────────────────────────────
  fastify.post<{ Body: { name: string; description?: string } }>(
    '/admin/rule-sets',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, description } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      const ruleSet = await prisma.ruleSet.create({ data: { name, description } });
      return reply.status(201).send(ruleSet);
    },
  );

  // ─── update rule set ──────────────────────────────────────────────────────
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; description?: string; propagatePolicies?: boolean; propagateClauses?: boolean; propagateFields?: boolean };
  }>(
    '/admin/rule-sets/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, propagatePolicies, propagateClauses, propagateFields } = request.body;
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (description !== undefined) data.description = description;
      if (propagatePolicies !== undefined) data.propagatePolicies = propagatePolicies;
      if (propagateClauses !== undefined) data.propagateClauses = propagateClauses;
      if (propagateFields !== undefined) data.propagateFields = propagateFields;
      const ruleSet = await prisma.ruleSet.update({ where: { id }, data });
      return reply.send(ruleSet);
    },
  );

  // ─── delete rule set ──────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/rule-sets/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
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
  }>(
    '/admin/rule-sets/:id/policies',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { name, description, value = 'no', appliesToProperty = true } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      if (!VALID_POLICY_VALUES.has(value)) {
        return reply.status(400).send({ error: `value must be one of: ${[...VALID_POLICY_VALUES].join(', ')}` });
      }
      const policy = await prisma.ruleSetPolicy.create({
        data: { ruleSetId: id, name, description, value, appliesToProperty },
      });
      return reply.status(201).send(policy);
    },
  );

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
      if (value !== undefined && !VALID_POLICY_VALUES.has(value)) {
        return reply.status(400).send({ error: `value must be one of: ${[...VALID_POLICY_VALUES].join(', ')}` });
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
      await prisma.propertyRuleSet.create({ data: { ruleSetId: id, propertyId } });
      return reply.status(201).send({ success: true });
    },
  );

  // ─── unlink property from rule set ───────────────────────────────────────
  fastify.delete<{ Params: { id: string; propertyId: string } }>(
    '/admin/rule-sets/:id/properties/:propertyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, propertyId } = request.params;
      await prisma.propertyRuleSet.delete({ where: { propertyId_ruleSetId: { propertyId, ruleSetId: id } } });
      return reply.send({ success: true });
    },
  );

  // ─── list contract templates ──────────────────────────────────────────────
  fastify.get(
    '/admin/contract-templates',
    { preHandler: verifyAdminJwt },
    async (_request, reply) => {
      const templates = await prisma.contractTemplate.findMany({
        select: { id: true, code: true, name: true, status: true, usageCount: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
      });
      return reply.send(templates);
    },
  );

  // ─── get contract template ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/admin/contract-templates/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const template = await prisma.contractTemplate.findUnique({ where: { id } });
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      return reply.send(template);
    },
  );

  // ─── create contract template ─────────────────────────────────────────────
  fastify.post<{ Body: { name: string } }>(
    '/admin/contract-templates',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      const count = await prisma.contractTemplate.count();
      const code = `CT-AA-${String(count + 1).padStart(2, '0')}`;
      const template = await prisma.contractTemplate.create({ data: { name, code } });
      return reply.status(201).send(template);
    },
  );

  // ─── update contract template ─────────────────────────────────────────────
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; body?: string; status?: string };
  }>(
    '/admin/contract-templates/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { name, body, status } = request.body;
      if (status !== undefined && !['draft', 'published'].includes(status)) {
        return reply.status(400).send({ error: 'status must be draft or published' });
      }
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (body !== undefined) data.body = body;
      if (status !== undefined) data.status = status;
      const template = await prisma.contractTemplate.update({ where: { id }, data });
      return reply.send(template);
    },
  );

  // ─── delete contract template ─────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/contract-templates/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const template = await prisma.contractTemplate.findUnique({ where: { id }, select: { usageCount: true } });
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      if (template.usageCount > 0) return reply.status(409).send({ error: 'Template is in use' });
      await prisma.contractTemplate.delete({ where: { id } });
      return reply.status(204).send();
    },
  );

  // ─── create contract ─────────────────────────────────────────────────────
  fastify.post<{
    Body: { templateId: string; tenantId: string; propertyId: string; startDate: string; endDate?: string; monthlyRent: number }
  }>(
    '/admin/contracts',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { templateId, tenantId, propertyId, startDate, endDate, monthlyRent } = request.body;

      const [template, tenant, property] = await Promise.all([
        prisma.contractTemplate.findUnique({ where: { id: templateId } }),
        prisma.tenant.findUnique({ where: { id: tenantId } }),
        prisma.property.findUnique({ where: { id: propertyId } }),
      ]);
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
      if (!property) return reply.status(404).send({ error: 'Property not found' });

      if (monthlyRent <= 0) return reply.status(400).send({ error: 'monthlyRent must be positive' });

      const year = new Date().getFullYear();

      const contract = await prisma.$transaction(async (tx) => {
        const count = await tx.contract.count();
        const code = `CT-${year}-${String(count + 1).padStart(4, '0')}`;
        const created = await tx.contract.create({
          data: {
            code,
            templateId,
            tenantId,
            propertyId,
            body: template.body,
            status: 'active',
            startDate: new Date(startDate),
            endDate: endDate ? new Date(endDate) : null,
            monthlyRent,
          },
        });
        await tx.contractTemplate.update({ where: { id: templateId }, data: { usageCount: { increment: 1 } } });
        return created;
      });

      return reply.status(201).send(contract);
    },
  );

  // ─── list contracts ───────────────────────────────────────────────────────
  fastify.get(
    '/admin/contracts',
    { preHandler: verifyAdminJwt },
    async (_request, reply) => {
      const contracts = await prisma.contract.findMany({
        select: {
          id: true,
          code: true,
          status: true,
          startDate: true,
          endDate: true,
          monthlyRent: true,
          tenant: { select: { name: true } },
          property: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(contracts);
    },
  );

  // ─── get contract ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/admin/contracts/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const contract = await prisma.contract.findUnique({
        where: { id: request.params.id },
        include: { tenant: true, property: true, template: true },
      });
      if (!contract) return reply.status(404).send({ error: 'Contract not found' });
      return reply.send(contract);
    },
  );

  // ─── update contract status ───────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/admin/contracts/:id/status',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { status } = request.body;
      const valid = ['active', 'terminated', 'renewal'];
      if (!valid.includes(status)) return reply.status(400).send({ error: 'Invalid status' });
      const contract = await prisma.contract.update({
        where: { id: request.params.id },
        data: { status },
      });
      return reply.send(contract);
    },
  );

  // ─── get contract pdf (stub) ──────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/admin/contracts/:id/pdf',
    { preHandler: verifyAdminJwt },
    async (_request, reply) => reply.status(501).send({ error: 'PDF generation not implemented' }),
  );
}
