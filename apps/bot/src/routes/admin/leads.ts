import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { normalizeLookupText } from '@/services/catalog';
import {
  finalizeContractSigning,
  LeadStageConflictError,
  TenantPhoneConflictError,
} from '@/services/contract-signing';
import {
  addCivilMonths,
  buildLeadAutoMap,
  formatDatePtBR,
  getSaoPauloDateParts,
  uniquePlaceholders,
} from '@/services/contract-variables';
import { extractCpfFromDocs, extractRgFromDocs } from '@/services/cpf';
import { DOC_TYPE_LABEL } from '@/services/doc-classifier';
import { sendMedia, sendText } from '@/services/evolution';
import { nextExternalId } from '@/services/external-id';
import { generateAndUploadPdf } from '@/services/pdf';
import { supabase } from './shared';

const clampPaymentDay = (v: unknown): number => {
  const num = Number(v ?? 10);
  if (!Number.isInteger(num)) return 10;
  return Math.min(28, Math.max(1, num));
};

const LEAD_DOCUMENT_TYPES = new Set(Object.keys(DOC_TYPE_LABEL));

export async function leadsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── update lead ──────────────────────────────────────────────────────────
  const VALID_LEAD_SOURCES = new Set([
    'whatsapp',
    'olx',
    'zap',
    'site',
    'instagram',
    'indicacao',
    'outro',
    'desconhecido',
    'other',
  ]);

  fastify.patch<{
    Params: { id: string };
    Body: { name?: string; source?: string; propertyId?: string };
  }>('/admin/leads/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, source, propertyId } = request.body;

    if (source !== undefined && !VALID_LEAD_SOURCES.has(source)) {
      return reply
        .status(400)
        .send({ error: `Invalid source. Must be one of: ${[...VALID_LEAD_SOURCES].join(', ')}` });
    }

    const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return reply.status(404).send({ error: 'Lead not found' });

    if (propertyId !== undefined) {
      const prop = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true },
      });
      if (!prop) return reply.status(404).send({ error: 'Property not found' });
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (source !== undefined) data.source = source;
    if (propertyId !== undefined) data.propertyId = propertyId;

    const lead = await prisma.lead.update({ where: { id }, data });

    if (source !== undefined) {
      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'lead_source_corrected',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
        metadata: { source },
      }).catch(fastify.log.warn.bind(fastify.log));
    }

    return reply.send(lead);
  });

  // ─── pause / resume bot ───────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { paused: boolean } }>(
    '/admin/leads/:id/pause-bot',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { paused } = request.body;

      if (typeof paused !== 'boolean') {
        return reply.status(400).send({ error: 'paused must be a boolean' });
      }

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { phone: true, name: true, ownerId: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      await prisma.conversation.upsert({
        where: { chatId: lead.phone },
        update: { botPaused: paused },
        create: { chatId: lead.phone, data: {}, botPaused: paused, ownerId: lead.ownerId },
      });

      const action = paused ? 'bot_paused' : 'bot_resumed';
      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action,
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ paused });
    },
  );

  // ─── archive / unarchive lead ─────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { archived: boolean } }>(
    '/admin/leads/:id/archive',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { archived } = request.body;

      if (typeof archived !== 'boolean') {
        return reply.status(400).send({ error: 'archived must be a boolean' });
      }

      const { count } = await prisma.lead.updateMany({
        where: { id, archivedAt: archived ? null : { not: null } },
        data: { archivedAt: archived ? new Date() : null },
      });

      if (count === 0) {
        const exists = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return reply.status(404).send({ error: 'Lead not found' });
        return reply
          .status(409)
          .send({ error: archived ? 'Lead already archived' : 'Lead not archived' });
      }

      const updated = await prisma.lead.findUnique({ where: { id } });
      if (!updated) return reply.status(404).send({ error: 'Lead not found' });

      const action = archived ? 'lead_archived' : 'lead_unarchived';
      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: updated.ownerId,
        action,
        subject: updated.name ?? updated.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send(updated);
    },
  );

  // ─── manual stage override ─────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { stage: string } }>(
    '/admin/leads/:id/stage',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { stage } = request.body;

      const MANUAL_STAGES = new Set(['interest', 'visiting', 'collection', 'review_submitted']);
      if (!MANUAL_STAGES.has(stage)) {
        return reply.status(400).send({ error: `Stage '${stage}' cannot be set manually` });
      }

      const { count } = await prisma.lead.updateMany({
        where: { id, stage: { not: stage } },
        data: { stage: stage as never },
      });

      if (count === 0) {
        const exists = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return reply.status(404).send({ error: 'Lead not found' });
        return reply.status(409).send({ error: 'Lead already in that stage' });
      }

      const updated = await prisma.lead.findUnique({ where: { id } });
      if (!updated) return reply.status(404).send({ error: 'Lead not found' });

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: updated.ownerId,
        action: 'lead_stage_changed',
        subject: updated.name ?? updated.phone,
        subjectId: id,
        subjectType: 'lead',
        metadata: { stage },
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send(updated);
    },
  );

  // ─── contract-variables preview ──────────────────────────────────────────
  fastify.get<{
    Params: { id: string };
    Querystring: { paymentDayOfMonth?: string };
  }>(
    '/admin/leads/:id/contract-variables',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const paymentDayOfMonth = clampPaymentDay(request.query.paymentDayOfMonth);

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: {
          phone: true,
          name: true,
          ownerId: true,
          propertyId: true,
          documents: { select: { ocrText: true } },
        },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
      if (!lead.propertyId)
        return reply.status(409).send({ error: 'Lead has no associated property' });

      const [property, template] = await Promise.all([
        prisma.property.findUnique({
          where: { id: lead.propertyId },
          include: { owner: true },
        }),
        prisma.contractTemplate.findFirst({
          where: { status: 'published', ownerId: lead.ownerId },
          orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        }),
      ]);

      if (!template) return reply.send({ unresolved: [], hasTemplate: false });
      if (!property) return reply.send({ unresolved: [], hasTemplate: true });

      const cpf = extractCpfFromDocs(lead.documents);
      const rg = extractRgFromDocs(lead.documents);
      const autoMap = buildLeadAutoMap(lead, property, paymentDayOfMonth, cpf, rg);
      const unresolved = uniquePlaceholders(template.body).filter(
        (p) => !(normalizeLookupText(p.slice(2, -2)) in autoMap),
      );

      return reply.send({ unresolved, hasTemplate: true, templateName: template.name });
    },
  );

  // ─── approve-kyc ──────────────────────────────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { paymentDayOfMonth: number; manualVariables?: Record<string, string | null> };
  }>('/admin/leads/:id/approve-kyc', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { paymentDayOfMonth, manualVariables = {} } = request.body;

    if (!Number.isInteger(paymentDayOfMonth) || paymentDayOfMonth < 1 || paymentDayOfMonth > 28) {
      return reply
        .status(400)
        .send({ error: 'paymentDayOfMonth must be an integer between 1 and 28' });
    }

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: {
        phone: true,
        name: true,
        stage: true,
        ownerId: true,
        propertyId: true,
        documents: { select: { ocrText: true } },
      },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });
    if (lead.stage !== 'kyc_pending') {
      return reply
        .status(409)
        .send({ error: `Lead is in stage '${lead.stage}', expected 'kyc_pending'` });
    }
    if (!lead.propertyId) {
      return reply.status(409).send({ error: 'Lead has no associated property' });
    }

    const [property, template] = await Promise.all([
      prisma.property.findUnique({ where: { id: lead.propertyId }, include: { owner: true } }),
      prisma.contractTemplate.findFirst({
        where: { status: 'published', ownerId: lead.ownerId },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      }),
    ]);
    if (!property) return reply.status(404).send({ error: 'Property not found' });
    if (!template) {
      return reply.status(409).send({
        error: 'No published contract template found. Publish a template before approving KYC.',
      });
    }

    // Atomically claim the stage — prevents duplicate contracts on retries or concurrent requests
    const { count } = await prisma.lead.updateMany({
      where: { id, stage: 'kyc_pending' },
      data: { stage: 'contract_pending' },
    });
    if (count === 0) {
      return reply.status(409).send({ error: `Lead is already past 'kyc_pending' stage` });
    }

    const cpf = extractCpfFromDocs(lead.documents);
    const rg = extractRgFromDocs(lead.documents);
    const autoMap = buildLeadAutoMap(lead, property, paymentDayOfMonth, cpf, rg);

    let body = template.body;
    for (const placeholder of uniquePlaceholders(template.body)) {
      const key = normalizeLookupText(placeholder.slice(2, -2));
      if (key in autoMap) body = body.replaceAll(placeholder, autoMap[key]);
    }
    for (const [placeholder, value] of Object.entries(manualVariables)) {
      body = body.replaceAll(placeholder, value === null ? '' : value);
    }
    body = body.replace(/\{\{[^}]+\}\}/g, 'N/A');

    const contractCode = await nextExternalId('contract');
    const contractMonths = property.contractMonths ?? 12;
    const startDate = new Date();
    const endDate = addCivilMonths(getSaoPauloDateParts(startDate), contractMonths);

    const contract = await prisma.contract.create({
      data: {
        code: contractCode,
        ownerId: lead.ownerId,
        templateId: template.id,
        leadId: id,
        propertyId: lead.propertyId,
        body,
        status: 'draft',
        monthlyRent: property.rent,
        startDate,
        endDate,
      },
    });

    let pdfPath: string | null = null;
    let pdfBase64: string | null = null;
    try {
      pdfPath = await generateAndUploadPdf(contract.id, body, contractCode);
      await prisma.contract.update({ where: { id: contract.id }, data: { pdfUrl: pdfPath } });

      // Download bytes to send as base64 — avoids Evolution API's waUploadToServer bug
      // that occurs when it tries to fetch an external URL.
      const { data: blob, error: dlErr } = await supabase.storage
        .from('contracts')
        .download(pdfPath);
      if (!dlErr && blob) {
        const buf = Buffer.from(await blob.arrayBuffer());
        pdfBase64 = buf.toString('base64');
      } else {
        fastify.log.error(
          { err: dlErr, contractId: contract.id, pdfPath },
          'PDF download from storage failed — contract saved, no file sent',
        );
      }
    } catch (pdfErr) {
      fastify.log.error(
        { err: pdfErr, contractId: contract.id },
        'PDF generation failed — contract saved, no file sent',
      );
    }

    if (pdfBase64) {
      sendMedia(
        lead.phone,
        'document',
        pdfBase64,
        'Segue seu contrato para revisão. Qualquer dúvida, é só chamar!',
        `${contractCode}.pdf`,
      )
        .then(() =>
          sendText(
            lead.phone,
            'Para confirmar sua locação, assine o contrato e envie de volta aqui no WhatsApp com a mensagem: *Contrato assinado*.',
          ),
        )
        .catch((err) => fastify.log.warn({ err }, 'Failed to send contract PDF to lead'));
    } else {
      sendText(
        lead.phone,
        '✅ KYC aprovado! Seu contrato está sendo preparado e você receberá em breve. Qualquer dúvida, é só chamar.',
      ).catch((err) => fastify.log.warn({ err }, 'Failed to notify lead after KYC approval'));
    }

    logActivityHelper({
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: lead.ownerId,
      action: 'kyc_approved',
      subject: lead.name ?? lead.phone,
      subjectId: id,
      subjectType: 'lead',
    }).catch(fastify.log.warn.bind(fastify.log));

    logActivityHelper({
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: lead.ownerId,
      action: 'contract_created',
      subject: contractCode,
      subjectId: contract.id,
      subjectType: 'contract',
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.send({ success: true, contractId: contract.id, stage: 'contract_pending' });
  });

  // ─── reclassify lead document ─────────────────────────────────────────────
  // OCR classification isn't perfect — lets the owner correct a mislabeled
  // document from the panel (lead-flow-v2 spec §2.4/2.5).
  fastify.patch<{ Params: { id: string; docId: string }; Body: { type: string } }>(
    '/admin/leads/:id/documents/:docId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, docId } = request.params;
      const { type } = request.body ?? {};

      if (!LEAD_DOCUMENT_TYPES.has(type)) {
        return reply.status(400).send({
          error: `Invalid document type. Expected one of: ${[...LEAD_DOCUMENT_TYPES].join(', ')}`,
        });
      }

      const doc = await prisma.leadDocument.findUnique({ where: { id: docId } });
      if (!doc || doc.leadId !== id) {
        return reply.status(404).send({ error: 'Document not found for this lead' });
      }

      if (doc.type === type) {
        return reply.send(doc);
      }

      const conflict = await prisma.leadDocument.findUnique({
        where: { leadId_type: { leadId: id, type } },
      });
      if (conflict) {
        return reply.status(409).send({
          error: `Lead already has a document classified as '${type}'`,
        });
      }

      let updated;
      try {
        updated = await prisma.leadDocument.update({
          where: { id: docId },
          data: { type, classifiedBy: 'manual' },
        });
      } catch (err) {
        // Concurrent request reclassified another doc to the same type between
        // the check above and this update — @@unique([leadId, type]) catches it.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.status(409).send({
            error: `Lead already has a document classified as '${type}'`,
          });
        }
        throw err;
      }

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: doc.ownerId,
        action: 'document_reclassified',
        subject: `${doc.type} → ${type}`,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send(updated);
    },
  );

  // ─── generate-contract ────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { paymentDayOfMonth: number } }>(
    '/admin/leads/:id/generate-contract',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { paymentDayOfMonth } = request.body;

      if (!Number.isInteger(paymentDayOfMonth) || paymentDayOfMonth < 1 || paymentDayOfMonth > 28) {
        return reply
          .status(400)
          .send({ error: 'paymentDayOfMonth must be an integer between 1 and 28' });
      }

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { phone: true, name: true, stage: true, ownerId: true },
      });
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
      ).catch((err) =>
        fastify.log.warn({ err }, 'Failed to notify lead after contract generation'),
      );

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'contract_created',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ success: true, stage: 'contract_pending' });
    },
  );

  // ─── mark-contract-signed ────────────────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { signedPdfUrl?: string } }>(
    '/admin/leads/:id/mark-signed',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { signedPdfUrl: bodySignedPdfUrl } = request.body ?? {};

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { name: true, phone: true, ownerId: true, stage: true, propertyId: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
      if (lead.stage !== 'contract_pending') {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'contract_pending'`,
        });
      }
      if (!lead.propertyId) {
        return reply.status(409).send({ error: 'Lead has no associated property' });
      }

      const contract = await prisma.contract.findFirst({
        where: { leadId: id, status: 'draft' },
        orderBy: { createdAt: 'desc' },
      });
      if (!contract) {
        return reply.status(404).send({ error: 'No draft contract found for this lead' });
      }

      const today = new Date();
      const finalBody = contract.body.replace(
        /A ser preenchida na assinatura/g,
        formatDatePtBR(today),
      );
      let finalPdfPath: string | undefined;
      let finalPdfSignedUrl: string | null = null;

      try {
        finalPdfPath = await generateAndUploadPdf(contract.id, finalBody, contract.code);
        const { data, error } = await supabase.storage
          .from('contracts')
          .createSignedUrl(finalPdfPath, 3600);
        if (!error) finalPdfSignedUrl = data.signedUrl;
        else
          fastify.log.warn(
            { err: error, finalPdfPath },
            'createSignedUrl failed for signed contract',
          );
      } catch (pdfErr) {
        fastify.log.warn({ err: pdfErr }, 'Failed to regenerate signed contract PDF');
      }

      // The actually-signed PDF (uploaded via /upload-signed-contract, or passed
      // directly in the body) takes priority over the freshly regenerated draft —
      // the whole point of "mark signed" is to hand back what the tenant signed,
      // not the template with the date filled in.
      // || (not ??) — an explicit empty string in the body must not win over
      // an already-uploaded signed PDF path.
      const signedPdfPath = bodySignedPdfUrl || contract.signedPdfUrl || undefined;
      let actualSignedUrl: string | null = null;
      if (signedPdfPath) {
        const { data, error } = await supabase.storage
          .from('contracts')
          .createSignedUrl(signedPdfPath, 3600);
        if (!error) actualSignedUrl = data.signedUrl;
        else fastify.log.warn({ err: error, signedPdfPath }, 'createSignedUrl failed for uploaded signed contract');
      }

      let tenantId: string;
      let tenantExternalId: string;
      try {
        ({ tenantId, tenantExternalId } = await finalizeContractSigning({
          leadId: id,
          contractId: contract.id,
          actorLabel: request.adminUserId ?? 'admin',
          signedPdfUrl: signedPdfPath ?? null,
          finalContractBody: finalBody,
          finalPdfPath,
        }));
      } catch (err) {
        if (err instanceof LeadStageConflictError) {
          return reply.status(409).send({ error: `Lead is already past 'contract_pending' stage` });
        }
        if (err instanceof TenantPhoneConflictError) {
          return reply.status(409).send({ error: err.message });
        }
        fastify.log.error({ err }, 'finalizeContractSigning failed');
        return reply.status(500).send({ error: 'Failed to finalize contract signing' });
      }

      if (actualSignedUrl) {
        sendMedia(
          lead.phone,
          'document',
          actualSignedUrl,
          '✅ Contrato assinado! Aqui está sua cópia.',
        ).catch((err) => fastify.log.warn({ err }, 'Failed to send signed contract to lead'));
      } else if (finalPdfSignedUrl) {
        sendMedia(
          lead.phone,
          'document',
          finalPdfSignedUrl,
          '✅ Contrato assinado! Aqui está sua cópia com a data de início preenchida.',
        ).catch((err) => fastify.log.warn({ err }, 'Failed to send signed contract to lead'));
      } else {
        sendText(lead.phone, '✅ Contrato assinado! Em breve você receberá sua cópia.').catch(
          (err) => fastify.log.warn({ err }, 'Failed to notify lead after contract signing'),
        );
      }

      return reply.send({ success: true, tenantId, tenantExternalId, stage: 'contract_signed' });
    },
  );

  // ─── upload-signed-contract ───────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/upload-signed-contract',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const contract = await prisma.contract.findFirst({
        where: { leadId: id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true },
      });
      if (!contract) return reply.status(404).send({ error: 'No contract found for this lead' });

      const data = await request.file();
      if (!data) return reply.status(400).send({ error: 'No file provided' });
      if (data.mimetype !== 'application/pdf') {
        return reply.status(400).send({ error: 'File must be a PDF' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) chunks.push(chunk);
      if (data.file.truncated)
        return reply.status(413).send({ error: 'File too large (limit: 10 MB)' });
      const buf = Buffer.concat(chunks);

      const path = `signed/${contract.id}/${contract.code}-assinado.pdf`;
      const { error: uploadErr } = await supabase.storage.from('contracts').upload(path, buf, {
        contentType: 'application/pdf',
        upsert: true,
      });
      if (uploadErr) {
        return reply.status(500).send({ error: `Upload failed: ${uploadErr.message}` });
      }

      await prisma.contract.update({ where: { id: contract.id }, data: { signedPdfUrl: path } });

      return reply.send({ success: true, signedPdfUrl: path });
    },
  );

  // ─── confirm-payment ──────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/confirm-payment',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { phone: true, name: true, stage: true, ownerId: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const { count } = await prisma.lead.updateMany({
        where: { id, stage: 'contract_signed' },
        data: { stage: 'converted', archivedAt: new Date() },
      });

      if (count === 0) {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'contract_signed'`,
        });
      }

      logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'payment_confirmed',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ success: true, stage: 'converted' });
    },
  );
}
