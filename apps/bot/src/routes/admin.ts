import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { sendText } from '@/services/evolution';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import type { LeadContext } from '@/flows/lead/context';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── approve-kyc ──────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/approve-kyc',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
      if (lead.stage !== 'kyc_pending') {
        return reply.status(409).send({ error: `Lead is in stage '${lead.stage}', expected 'kyc_pending'` });
      }

      // Read resident count from Conversation context
      const conv = await prisma.conversation.findUnique({ where: { chatId: lead.phone } });
      const ctx = (conv?.data ?? {}) as LeadContext;
      const extraResidents = (ctx.residents?.length ?? 0);

      // If no additional residents, skip straight to residents_docs_complete
      const nextStage = extraResidents > 0 ? 'kyc_approved' : 'residents_docs_complete';

      await prisma.lead.update({ where: { id }, data: { stage: nextStage } });

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
}
