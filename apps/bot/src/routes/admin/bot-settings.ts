import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { isValidCnpjFormat, isValidCpfFormat } from '@/services/cpf';

export async function botSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── bot global toggle ────────────────────────────────────────────────────
  fastify.patch<{ Body: { enabled: boolean } }>(
    '/admin/workspace/bot-enabled',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { enabled } = request.body;
      if (typeof enabled !== 'boolean') {
        return reply.status(400).send({ error: 'enabled must be a boolean' });
      }
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(404).send({ error: 'Owner not found' });

      await prisma.owner.update({ where: { id: owner.id }, data: { botEnabled: enabled } });

      await redis.del(`bot:enabled:${owner.id}`);

      logActivityHelper({
        ownerId: owner.id,
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'Admin',
        action: enabled ? 'bot_globally_resumed' : 'bot_globally_paused',
        subjectType: 'workspace',
        subjectId: owner.id,
        subject: 'Bot WhatsApp',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ enabled });
    },
  );

  // ─── notification settings ────────────────────────────────────────────────
  const E164_RE = /^\+[1-9]\d{6,14}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  fastify.patch<{ Body: { notificationPhone?: string | null; notificationEmail?: string | null } }>(
    '/admin/workspace/notifications',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { notificationPhone, notificationEmail } = request.body;

      if (
        notificationPhone != null &&
        notificationPhone !== '' &&
        !E164_RE.test(notificationPhone)
      ) {
        return reply
          .status(400)
          .send({ error: 'notificationPhone must be in E.164 format (e.g. +5511999999999)' });
      }
      if (
        notificationEmail != null &&
        notificationEmail !== '' &&
        !EMAIL_RE.test(notificationEmail)
      ) {
        return reply.status(400).send({ error: 'notificationEmail must be a valid email address' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(404).send({ error: 'Owner not found' });

      const data: { notificationPhone?: string | null; notificationEmail?: string | null } = {};
      if (notificationPhone !== undefined) data.notificationPhone = notificationPhone || null;
      if (notificationEmail !== undefined) data.notificationEmail = notificationEmail || null;

      await prisma.owner.update({ where: { id: owner.id }, data });
      return reply.send({
        notificationPhone:
          notificationPhone !== undefined ? data.notificationPhone : owner.notificationPhone,
        notificationEmail:
          notificationEmail !== undefined ? data.notificationEmail : owner.notificationEmail,
      });
    },
  );

  // ─── owner profile (contract auto-fill) ──────────────────────────────────
  fastify.patch<{
    Body: { name?: string; cpf?: string | null; cnpj?: string | null; address?: string | null };
  }>(
    '/admin/workspace/profile',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, cpf, cnpj, address } = request.body;

      if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
        return reply.status(400).send({ error: 'name must not be empty' });
      }
      if (cpf != null && cpf !== '' && (typeof cpf !== 'string' || !isValidCpfFormat(cpf))) {
        return reply.status(400).send({ error: 'cpf must be 11 digits or 000.000.000-00' });
      }
      if (cnpj != null && cnpj !== '' && (typeof cnpj !== 'string' || !isValidCnpjFormat(cnpj))) {
        return reply.status(400).send({ error: 'cnpj must be 14 digits or 00.000.000/0000-00' });
      }
      if (address != null && typeof address !== 'string') {
        return reply.status(400).send({ error: 'address must be a string' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(404).send({ error: 'Owner not found' });

      const data: { name?: string; cpf?: string | null; cnpj?: string | null; address?: string | null } = {};
      if (name !== undefined) data.name = name.trim();
      if (cpf !== undefined) data.cpf = cpf || null;
      if (cnpj !== undefined) data.cnpj = cnpj || null;
      if (address !== undefined) data.address = (address ?? '').trim() || null;

      await prisma.owner.update({ where: { id: owner.id }, data });
      return reply.send({
        name: data.name ?? owner.name,
        cpf: cpf !== undefined ? data.cpf : owner.cpf,
        cnpj: cnpj !== undefined ? data.cnpj : owner.cnpj,
        address: address !== undefined ? data.address : owner.address,
      });
    },
  );
}
