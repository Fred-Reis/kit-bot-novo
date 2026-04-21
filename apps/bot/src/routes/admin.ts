import type { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { sendText } from '@/services/evolution';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { config } from '@/config';
import type { LeadContext } from '@/flows/lead/context';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── approve-kyc ──────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/approve-kyc',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { phone: true, stage: true },
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

      const lead = await prisma.lead.findUnique({ where: { id }, select: { phone: true, stage: true } });
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

      return reply.send({ success: true, stage: 'contract_pending' });
    },
  );

  // ─── confirm-payment ──────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/confirm-payment',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({ where: { id }, select: { stage: true } });
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

      return reply.send({ success: true, stage: 'converted' });
    },
  );

  // ─── create property ──────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      name: string; externalId: string; address: string; neighborhood: string;
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
      const { name, externalId, address, neighborhood, rent, deposit, depositInstallmentsMax, rooms, bathrooms, ...rest } = request.body;

      if (!name || !externalId || !address || !neighborhood || rent == null || deposit == null || depositInstallmentsMax == null || rooms == null || bathrooms == null) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const property = await prisma.property.create({
        data: { name, externalId, address, neighborhood, rent, deposit, depositInstallmentsMax, rooms, bathrooms, ownerId: rest.ownerId ?? owner.id, ...rest },
      });

      return reply.status(201).send({ success: true, id: property.id, property });
    },
  );

  // ─── update property ──────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/properties/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const property = await prisma.property.update({ where: { id }, data: request.body });
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

      const [tenant] = await prisma.$transaction([
        prisma.tenant.create({
          data: { phone, propertyId, contractStart: new Date(contractStart), ...rest },
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
}
