import type { FastifyInstance } from 'fastify';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';

export async function templatesRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── list contract templates ──────────────────────────────────────────────
  fastify.get(
    '/admin/contract-templates',
    { preHandler: verifyAdminJwt },
    async (_request, reply) => {
      const templates = await prisma.contractTemplate.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true,
          _count: { select: { contracts: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      return reply.send(
        templates.map(({ _count, ...t }) => ({ ...t, usageCount: _count.contracts })),
      );
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
      const owner = await prisma.owner.findFirst({
        where: request.adminUserId ? { adminUserId: request.adminUserId } : undefined,
      });
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const template = await prisma.contractTemplate.create({
        data: { name, ownerId: owner.id },
      });
      logActivityHelper({
        ownerId: owner.id,
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'Admin',
        action: 'template_created',
        subjectType: 'template',
        subjectId: template.id,
        subject: template.name,
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send(template);
    },
  );

  // ─── update contract template ─────────────────────────────────────────────
  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; body?: string; status?: string; isDefault?: boolean };
  }>('/admin/contract-templates/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, body, status, isDefault } = request.body;
    const existing = await prisma.contractTemplate.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, ownerId: true },
    });
    if (!existing) return reply.status(404).send({ error: 'Template not found' });
    if (status !== undefined && !['draft', 'published'].includes(status)) {
      return reply.status(400).send({ error: 'status must be draft or published' });
    }
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (body !== undefined) data.body = body;
    if (status !== undefined) data.status = status;
    if (isDefault === true) data.isDefault = true;

    // Unset default on other templates before setting this one
    if (isDefault === true) {
      await prisma.contractTemplate.updateMany({
        where: { ownerId: existing.ownerId, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const template = await prisma.contractTemplate.update({ where: { id }, data });
    if (status === 'published' && existing.status !== 'published') {
      logActivityHelper({
        ownerId: existing.ownerId,
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'Admin',
        action: 'template_published',
        subjectType: 'template',
        subjectId: id,
        subject: existing.name,
      }).catch(fastify.log.warn.bind(fastify.log));
    }
    return reply.send(template);
  });

  // ─── delete contract template ─────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/contract-templates/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const template = await prisma.contractTemplate.findUnique({
        where: { id },
        select: { _count: { select: { contracts: true } } },
      });
      if (!template) return reply.status(404).send({ error: 'Template not found' });
      if (template._count.contracts > 0)
        return reply.status(409).send({ error: 'Template is in use' });
      await prisma.contractTemplate.delete({ where: { id } });
      return reply.status(204).send();
    },
  );

  // ─── import contract template from DOCX or PDF ───────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/contract-templates/:id/import',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const template = await prisma.contractTemplate.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!template) return reply.status(404).send({ error: 'Template not found' });

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file provided' });

      const isDocx =
        data.mimetype ===
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        data.filename?.endsWith('.docx');
      const isPdf = data.mimetype === 'application/pdf' || data.filename?.endsWith('.pdf');

      if (!isDocx && !isPdf) {
        return reply.status(400).send({ error: 'File must be .docx or .pdf' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      if (data.file.truncated)
        return reply.status(413).send({ error: 'File too large (limit: 10 MB)' });
      const buf = Buffer.concat(chunks);

      let body: string;
      try {
        if (isDocx) {
          const result = await mammoth.extractRawText({ buffer: buf });
          body = result.value;
        } else {
          const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
          body = text;
        }
      } catch (err) {
        fastify.log.error({ err, filename: data.filename, mimetype: data.mimetype }, 'template import extraction failed');
        return reply
          .status(422)
          .send({ error: 'Could not extract text from file. Ensure it is a valid .docx or .pdf.' });
      }

      if (!body.trim()) {
        return reply
          .status(422)
          .send({ error: 'Extracted text is empty. File may be image-based or encrypted.' });
      }

      await prisma.contractTemplate.update({ where: { id }, data: { body } });
      return reply.send({ success: true, chars: body.length });
    },
  );
}
