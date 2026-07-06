import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import type { FastifyInstance } from 'fastify';
import mammoth from 'mammoth';
// Import from lib to bypass module.parent debug runner — crashes in Bun runtime
import pdfParse from 'pdf-parse/lib/pdf-parse';
import { config } from '@/config';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { normalizeLookupText } from '@/services/catalog';
import { finalizeContractSigning } from '@/services/contract-signing';
import { extractCpfFromDocs, extractRgFromDocs } from '@/services/cpf';
import { sendMedia, sendText } from '@/services/evolution';
import { nextExternalId } from '@/services/external-id';
import { generateAndUploadPdf } from '@/services/pdf';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

const MONTH_REGEX = /^\d{4}-\d{2}$/;
const TEMPLATE_VAR_RE = /\{\{([^}]+)\}\}/g;
const formatDatePtBR = (d: Date): string =>
  d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

function uniquePlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(TEMPLATE_VAR_RE)].map((m) => m[0]))];
}

const clampPaymentDay = (v: unknown): number => Math.min(28, Math.max(1, Number(v ?? 10)));

function buildLeadAutoMap(
  lead: { name: string | null; phone: string },
  property: {
    name: string;
    address: string;
    complement: string | null;
    neighborhood: string;
    rent: unknown;
    deposit: unknown;
    contractMonths: number | null;
    owner?: { name: string } | null;
  },
  paymentDayOfMonth: number,
  cpf: string | null,
  rg: string | null = null,
): Record<string, string> {
  const fmt = (n: unknown) =>
    Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const today = new Date();
  const months = property.contractMonths ?? 12;
  const endDate = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
  const fullAddress = [property.address, property.complement].filter(Boolean).join(', ');
  const ownerName = property.owner?.name ?? '';
  const rentFmt = fmt(property.rent);
  const depositFmt = fmt(property.deposit);

  return {
    // locatário
    locatario: lead.name ?? lead.phone,
    nome_locatario: lead.name ?? lead.phone,
    ...(cpf !== null ? { cpf_locatario: cpf } : {}),
    ...(rg !== null ? { rg_locatario: rg } : {}),
    telefone_locatario: lead.phone,
    // locador
    locador: ownerName,
    nome_locador: ownerName,
    // imóvel
    imovel: property.name,
    nome_imovel: property.name,
    endereco: fullAddress,
    endereco_imovel: fullAddress,
    complemento_imovel: property.complement ?? '',
    bairro: property.neighborhood,
    bairro_imovel: property.neighborhood,
    // valores
    aluguel: rentFmt,
    valor_aluguel: rentFmt,
    deposito: depositFmt,
    caucao: depositFmt,
    valor_caucao: depositFmt,
    // prazo e datas
    prazo_meses: String(months),
    prazo: String(months),
    data_hoje: formatDatePtBR(today),
    data_inicio: formatDatePtBR(today),
    data_termino: formatDatePtBR(endDate),
    data_assinatura: 'A ser preenchida na assinatura',
    vencimento: String(paymentDayOfMonth),
    dia_vencimento: String(paymentDayOfMonth),
  };
}

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const VALID_POLICY_VALUES = new Set(['yes', 'no', 'conditional']);

const PROPERTY_PATCH_FIELDS = new Set([
  'name',
  'externalId',
  'address',
  'complement',
  'neighborhood',
  'rent',
  'deposit',
  'depositInstallmentsMax',
  'contractMonths',
  'rooms',
  'bathrooms',
  'area',
  'maxAdults',
  'acceptsPets',
  'acceptsChildren',
  'includesWater',
  'includesIptu',
  'individualElectricity',
  'independentEntrance',
  'description',
  'rulesText',
  'visitSchedule',
  'listingUrl',
  'active',
]);

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
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
        actorType: 'owner',
        actorLabel: request.adminUserId ?? 'Admin',
        action: enabled ? 'bot_globally_resumed' : 'bot_globally_paused',
        subjectType: 'workspace',
        subjectId: owner.id,
        subject: 'Bot WhatsApp',
      }).catch(() => {});

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
          where: { status: 'published' },
          orderBy: { updatedAt: 'desc' },
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
        where: { status: 'published' },
        orderBy: { updatedAt: 'desc' },
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
    const endDate = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + contractMonths,
      startDate.getDate(),
    );

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
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: lead.ownerId,
      action: 'kyc_approved',
      subject: lead.name ?? lead.phone,
      subjectId: id,
      subjectType: 'lead',
    }).catch(fastify.log.warn.bind(fastify.log));

    logActivityHelper({
      actorType: 'user',
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: lead.ownerId,
      action: 'contract_created',
      subject: contractCode,
      subjectId: contract.id,
      subjectType: 'contract',
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.send({ success: true, contractId: contract.id, stage: 'contract_pending' });
  });

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
      const { signedPdfUrl } = request.body ?? {};

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

      // Atomically claim the stage — prevents duplicate tenants on retries or concurrent requests
      const { count } = await prisma.lead.updateMany({
        where: { id, stage: 'contract_pending' },
        data: { stage: 'converted' },
      });
      if (count === 0) {
        return reply.status(409).send({ error: `Lead is already past 'contract_pending' stage` });
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
      } catch (pdfErr) {
        fastify.log.warn({ err: pdfErr }, 'Failed to regenerate signed contract PDF');
      }

      const { tenantId, tenantExternalId } = await finalizeContractSigning({
        leadId: id,
        contractId: contract.id,
        actorLabel: request.adminUserId ?? 'admin',
        signedPdfUrl: signedPdfUrl ?? null,
        finalContractBody: finalBody,
        finalPdfPath,
      });

      if (finalPdfSignedUrl) {
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

      return reply.send({ success: true, tenantId, tenantExternalId, stage: 'converted' });
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
        data: { stage: 'converted' },
      });

      if (count === 0) {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'contract_signed'`,
        });
      }

      logActivityHelper({
        actorType: 'user',
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

  // ─── create property ──────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      name: string;
      externalId?: string;
      address: string;
      neighborhood: string;
      rent: number;
      deposit: number;
      depositInstallmentsMax: number;
      rooms: number;
      bathrooms: number;
      title?: string;
      complement?: string;
      area?: number;
      parkingSpots?: number;
      amenities?: string[];
      type?: string;
      purpose?: string;
      status?: string;
      description?: string;
      rulesText?: string;
      visitSchedule?: string;
      listingUrl?: string;
      acceptsPets?: boolean;
      acceptsChildren?: boolean;
      maxAdults?: number;
      includesWater?: boolean;
      includesIptu?: boolean;
      individualElectricity?: boolean;
      contractMonths?: number;
      ownerId?: string;
    };
  }>('/admin/properties', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const {
      name,
      externalId: rawExternalId,
      address,
      neighborhood,
      rent,
      deposit,
      depositInstallmentsMax,
      rooms,
      bathrooms,
      ...rest
    } = request.body;

    if (
      !name ||
      !address ||
      !neighborhood ||
      rent == null ||
      deposit == null ||
      depositInstallmentsMax == null ||
      rooms == null ||
      bathrooms == null
    ) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(400).send({ error: 'No owner found' });

    let externalId = rawExternalId;
    if (!externalId) {
      externalId = await nextExternalId('property');
    }

    const property = await prisma.property.create({
      data: {
        name,
        externalId,
        address,
        neighborhood,
        rent,
        deposit,
        depositInstallmentsMax,
        rooms,
        bathrooms,
        ownerId: rest.ownerId ?? owner.id,
        ...rest,
      },
    });

    await logActivityHelper({
      ownerId: property.ownerId,
      actorType: 'user',
      actorLabel: request.adminUserId ?? 'Admin',
      action: 'property_created',
      subjectType: 'property',
      subjectId: property.id,
      subject: property.name,
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send({ success: true, id: property.id, property });
  });

  // ─── update property ──────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/properties/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await prisma.property.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Property not found' });

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

      const existing = await prisma.property.findUnique({
        where: { id },
        select: { id: true, name: true, ownerId: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Property not found' });

      await prisma.property.update({ where: { id }, data: { status: 'archived', active: false } });
      await redis.del(`property:${id}`);

      await logActivityHelper({
        ownerId: existing.ownerId,
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'Admin',
        action: 'property_archived',
        subjectType: 'property',
        subjectId: id,
        subject: existing.name,
      }).catch(fastify.log.warn.bind(fastify.log));

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

    const externalId = await nextExternalId('tenant');

    const [tenant] = await prisma.$transaction([
      prisma.tenant.create({
        data: {
          phone,
          propertyId,
          contractStart: new Date(contractStart),
          externalId,
          ownerId: owner.id,
          ...rest,
        },
      }),
      prisma.property.update({
        where: { id: propertyId },
        data: { status: 'rented', active: false },
      }),
    ]);

    await redis.del(`property:${propertyId}`);

    await logActivityHelper({
      ownerId: owner.id,
      actorType: 'user',
      actorLabel: request.adminUserId ?? 'Admin',
      action: 'tenant_created',
      subjectType: 'tenant',
      subjectId: tenant.id,
      subject: tenant.name ?? tenant.phone,
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send({ success: true, id: tenant.id, tenant });
  });

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

      const ext =
        fileName
          .split('.')
          .pop()
          ?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
      const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

      const { data, error } = await supabase.storage.from('properties').createSignedUploadUrl(path);

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
  }>('/admin/properties/:id/media', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { path, type, label } = request.body;

    if (!path.startsWith(`${id}/`)) {
      return reply.status(400).send({ error: 'Invalid path for this property' });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('properties').getPublicUrl(path);

    const property = await prisma.property.findUnique({ where: { id }, select: { ownerId: true } });
    if (!property) return reply.status(404).send({ error: 'Property not found' });

    const media = await prisma.propertyMedia.create({
      data: {
        propertyId: id,
        ownerId: property.ownerId,
        url: publicUrl,
        type,
        label: label ?? null,
      },
    });

    await redis.del(`property:${id}`);

    return reply.status(201).send({ success: true, media });
  });

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
      await prisma.propertyRuleSet.create({ data: { ruleSetId: id, propertyId } });
      await logActivityHelper({
        actorType: 'user',
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
      await prisma.propertyRuleSet.delete({
        where: { propertyId_ruleSetId: { propertyId, ruleSetId: id } },
      });
      return reply.send({ success: true });
    },
  );

  // ─── list contract templates ──────────────────────────────────────────────
  fastify.get(
    '/admin/contract-templates',
    { preHandler: verifyAdminJwt },
    async (_request, reply) => {
      const templates = await prisma.contractTemplate.findMany({
        select: {
          id: true,
          code: true,
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
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const count = await prisma.contractTemplate.count();
      const code = `CT-AA-${String(count + 1).padStart(2, '0')}`;
      const template = await prisma.contractTemplate.create({
        data: { name, code, ownerId: owner.id },
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
    Body: { name?: string; body?: string; status?: string };
  }>('/admin/contract-templates/:id', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const { name, body, status } = request.body;
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
          const result = await pdfParse(buf);
          body = result.text;
        }
      } catch {
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

  // ─── preview contract variables ───────────────────────────────────────────
  fastify.post<{
    Body: {
      templateId: string;
      tenantId: string;
      propertyId: string;
      startDate: string;
      endDate?: string;
      monthlyRent: number;
    };
  }>('/admin/contracts/preview', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { templateId, tenantId, propertyId, startDate, endDate, monthlyRent } = request.body;

    const [template, tenant, property] = await Promise.all([
      prisma.contractTemplate.findUnique({ where: { id: templateId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.property.findUnique({ where: { id: propertyId }, include: { owner: true } }),
    ]);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (!property) return reply.status(404).send({ error: 'Property not found' });
    if (monthlyRent <= 0) return reply.status(400).send({ error: 'monthlyRent must be positive' });
    if (isNaN(new Date(startDate).getTime()))
      return reply.status(400).send({ error: 'Invalid startDate' });
    if (endDate && isNaN(new Date(endDate).getTime()))
      return reply.status(400).send({ error: 'Invalid endDate' });
    if (endDate && new Date(endDate) <= new Date(startDate))
      return reply.status(400).send({ error: 'endDate must be after startDate' });

    const { owner } = property;
    if (!owner) return reply.status(404).send({ error: 'Owner not found' });

    const formatBRL = (n: number | { toString(): string }) =>
      Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const formatDate = (d: string | Date) =>
      new Date(d).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

    const prazo = (() => {
      if (!endDate) return 'Indeterminado';
      const s = new Date(startDate);
      const e = new Date(endDate);
      const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
      return `${months} ${months === 1 ? 'mês' : 'meses'}`;
    })();

    const autoMap: Record<string, string> = {
      locador: owner.name,
      locatario: tenant.name ?? tenant.phone,
      cpf_locatario: tenant.cpf ?? '',
      email_locatario: tenant.email ?? '',
      telefone_locatario: tenant.phone,
      imovel: property.name,
      endereco: [property.address, property.complement].filter(Boolean).join(', '),
      bairro: property.neighborhood,
      aluguel: formatBRL(monthlyRent),
      deposito: formatBRL(Number(property.deposit)),
      inicio: formatDate(startDate),
      fim: endDate ? formatDate(endDate) : 'Indeterminado',
      prazo,
      data_hoje: formatDate(new Date()),
    };

    const varRegex = /\{\{([^}]+)\}\}/g;
    const allVars = [...new Set([...template.body.matchAll(varRegex)].map((m) => m[0]))];

    const resolved: Record<string, string> = {};
    const unresolved: string[] = [];

    for (const placeholder of allVars) {
      const inner = placeholder.slice(2, -2);
      const key = normalizeLookupText(inner);
      if (key in autoMap) {
        resolved[placeholder] = autoMap[key];
      } else {
        unresolved.push(placeholder);
      }
    }

    const suggestions = [
      { field: 'owner.name', label: 'Nome do proprietário', value: owner.name },
      { field: 'tenant.name', label: 'Nome do inquilino', value: tenant.name ?? '' },
      { field: 'tenant.cpf', label: 'CPF do inquilino', value: tenant.cpf ?? '' },
      { field: 'tenant.phone', label: 'Telefone do inquilino', value: tenant.phone },
      { field: 'tenant.email', label: 'E-mail do inquilino', value: tenant.email ?? '' },
      { field: 'property.name', label: 'Nome do imóvel', value: property.name },
      { field: 'property.address', label: 'Endereço', value: property.address },
      { field: 'property.neighborhood', label: 'Bairro', value: property.neighborhood },
      { field: 'property.deposit', label: 'Depósito', value: formatBRL(Number(property.deposit)) },
      { field: 'contract.monthlyRent', label: 'Aluguel mensal', value: formatBRL(monthlyRent) },
      { field: 'contract.startDate', label: 'Data de início', value: formatDate(startDate) },
      {
        field: 'contract.endDate',
        label: 'Data de fim',
        value: endDate ? formatDate(endDate) : 'Indeterminado',
      },
    ];

    return reply.send({ resolved, unresolved, suggestions });
  });

  // ─── create contract ─────────────────────────────────────────────────────
  fastify.post<{
    Body: {
      templateId: string;
      tenantId: string;
      propertyId: string;
      startDate: string;
      endDate?: string;
      monthlyRent: number;
      variables?: Record<string, string>;
    };
  }>('/admin/contracts', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { templateId, tenantId, propertyId, startDate, endDate, monthlyRent, variables } =
      request.body;

    const [template, tenant, property] = await Promise.all([
      prisma.contractTemplate.findUnique({ where: { id: templateId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.property.findUnique({ where: { id: propertyId } }),
    ]);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (!property) return reply.status(404).send({ error: 'Property not found' });
    if (monthlyRent <= 0) return reply.status(400).send({ error: 'monthlyRent must be positive' });
    if (isNaN(new Date(startDate).getTime()))
      return reply.status(400).send({ error: 'Invalid startDate' });
    if (endDate && isNaN(new Date(endDate).getTime()))
      return reply.status(400).send({ error: 'Invalid endDate' });
    if (endDate && new Date(endDate) <= new Date(startDate))
      return reply.status(400).send({ error: 'endDate must be after startDate' });

    let renderedBody = template.body;
    for (const [placeholder, value] of Object.entries(variables ?? {})) {
      renderedBody = renderedBody.replaceAll(placeholder, value);
    }

    const code = await nextExternalId('contract');

    const contract = await prisma.contract.create({
      data: {
        code,
        ownerId: property.ownerId,
        templateId,
        tenantId,
        propertyId,
        body: renderedBody,
        status: 'active',
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        monthlyRent,
      },
    });

    logActivityHelper({
      actorType: 'user',
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: property.ownerId,
      action: 'contract_created',
      subject: contract.code,
      subjectId: contract.id,
      subjectType: 'contract',
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send(contract);
  });

  // ─── list contracts ───────────────────────────────────────────────────────
  fastify.get('/admin/contracts', { preHandler: verifyAdminJwt }, async (_request, reply) => {
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
  });

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
      const { id } = request.params;
      const { status } = request.body;
      const existing = await prisma.contract.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Contract not found' });
      const valid = ['active', 'terminated', 'renewal'];
      if (!valid.includes(status)) return reply.status(400).send({ error: 'Invalid status' });
      const contract = await prisma.contract.update({
        where: { id },
        data: { status },
      });
      return reply.send(contract);
    },
  );

  // ─── get contract pdf ─────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/admin/contracts/:id/pdf',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const contract = await prisma.contract.findUnique({
        where: { id },
        select: { id: true, code: true, body: true, pdfUrl: true },
      });
      if (!contract) return reply.status(404).send({ error: 'Contract not found' });

      let path: string;
      if (contract.pdfUrl) {
        path = contract.pdfUrl;
      } else {
        path = await generateAndUploadPdf(contract.id, contract.body, contract.code);
        await prisma.contract.update({ where: { id }, data: { pdfUrl: path } });
      }

      const { data: signed, error: signError } = await supabase.storage
        .from('contracts')
        .createSignedUrl(path, 300);
      if (signError || !signed) return reply.status(500).send({ error: 'Could not sign PDF URL' });
      return reply.send({ url: signed.signedUrl });
    },
  );

  // ─── list payments ────────────────────────────────────────────────────────
  fastify.get<{
    Querystring: { type?: string; period?: string; limit?: string };
  }>('/admin/payments', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { type, period, limit: limitStr } = request.query;
    const parsed = parseInt(limitStr ?? '', 10);
    const limit = !isNaN(parsed) ? Math.min(parsed, 200) : 50;

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

    if (type === 'income' && inquilinoId) {
      const tenant = await prisma.tenant.findUnique({ where: { id: inquilinoId } });
      if (!tenant) return reply.status(400).send({ error: 'Tenant not found' });
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
      actorLabel: request.adminUserId ?? 'admin',
      ownerId: owner.id,
      action: 'payment_recorded',
      subject: description ?? (type === 'income' ? 'Receita' : 'Despesa'),
      subjectId: payment.id,
      subjectType: 'payment',
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send({ ...payment, amount: Number(payment.amount) });
  });

  // ─── Visits ───────────────────────────────────────────────────────────────────

  fastify.post<{
    Body: { leadId: string; propertyId: string; scheduledVisitAt: string; note?: string };
  }>('/admin/visits', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { leadId, propertyId, scheduledVisitAt, note } = request.body;

    if (!leadId || !propertyId || !scheduledVisitAt) {
      return reply
        .status(400)
        .send({ error: 'leadId, propertyId and scheduledVisitAt are required' });
    }

    const visitDate = new Date(scheduledVisitAt);
    if (isNaN(visitDate.getTime())) {
      return reply.status(400).send({ error: 'Invalid scheduledVisitAt date' });
    }

    const owner = await prisma.owner.findFirst();
    if (!owner) return reply.status(400).send({ error: 'No owner found' });

    const [lead, property] = await Promise.all([
      prisma.lead.findUnique({ where: { id: leadId } }),
      prisma.property.findUnique({ where: { id: propertyId } }),
    ]);
    if (!lead || lead.ownerId !== owner.id) {
      return reply.status(404).send({ error: 'Lead not found' });
    }
    if (lead.archivedAt) {
      return reply.status(409).send({ error: 'Cannot schedule visit for archived lead' });
    }
    const STAGES_PAST_VISITING = new Set([
      'collection',
      'kyc_pending',
      'kyc_approved',
      'residents_docs_complete',
      'contract_pending',
      'contract_signed',
      'converted',
    ]);
    if (STAGES_PAST_VISITING.has(lead.stage)) {
      return reply
        .status(409)
        .send({ error: 'Cannot schedule visit: lead is already past the visiting stage' });
    }
    if (!property || property.ownerId !== owner.id) {
      return reply.status(404).send({ error: 'Property not found' });
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { scheduledVisitAt: visitDate, stage: 'visiting', propertyId },
    });

    logActivityHelper({
      actorType: 'user',
      actorLabel: request.adminUserId ?? 'Admin',
      ownerId: owner.id,
      action: 'visit_scheduled',
      subject: lead.name ?? lead.phone,
      subjectId: leadId,
      subjectType: 'lead',
      metadata: { scheduledVisitAt, note: note ?? null },
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.status(201).send({ leadId, scheduledVisitAt: updated.scheduledVisitAt });
  });

  fastify.patch<{ Params: { id: string } }>(
    '/admin/leads/:id/complete-visit',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead || lead.ownerId !== owner.id) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.archivedAt) {
        return reply.status(409).send({ error: 'Cannot complete visit for archived lead' });
      }

      if (!lead.scheduledVisitAt) {
        return reply.status(409).send({ error: 'No visit scheduled for this lead' });
      }

      if (lead.visitedAt) {
        return reply.status(409).send({ error: 'Visit already completed' });
      }

      const updated = await prisma.lead.update({
        where: { id },
        data: { visitedAt: new Date(), stage: 'post_visit_decision' },
      });

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'Admin',
        ownerId: owner.id,
        action: 'visit_completed',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ leadId: id, visitedAt: updated.visitedAt, stage: updated.stage });
    },
  );

  // ─── update visit status ─────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { status: string } }>(
    '/admin/leads/:id/visit-status',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;

      if (!['upcoming', 'completed', 'cancelled'].includes(status)) {
        return reply.status(400).send({ error: 'status must be upcoming | completed | cancelled' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead || lead.ownerId !== owner.id) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      let data: Prisma.LeadUpdateInput;
      let action: 'visit_completed' | 'visit_cancelled' | 'visit_scheduled';

      if (status === 'completed') {
        data = { visitedAt: new Date(), archivedAt: null, stage: 'post_visit_decision' };
        action = 'visit_completed';
      } else if (status === 'cancelled') {
        data = { archivedAt: new Date(), visitedAt: null };
        action = 'visit_cancelled';
      } else {
        data = { visitedAt: null, archivedAt: null, stage: 'visiting' };
        action = 'visit_scheduled';
      }

      await prisma.lead.update({ where: { id }, data });

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'Admin',
        ownerId: owner.id,
        action,
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
        metadata: { status },
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ leadId: id, status });
    },
  );

  // ─── reschedule visit ─────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { scheduledVisitAt: string } }>(
    '/admin/leads/:id/scheduled-visit',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { scheduledVisitAt } = request.body;

      if (!scheduledVisitAt) {
        return reply.status(400).send({ error: 'scheduledVisitAt is required' });
      }

      const visitDate = new Date(scheduledVisitAt);
      if (isNaN(visitDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid scheduledVisitAt date' });
      }

      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });

      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead || lead.ownerId !== owner.id) {
        return reply.status(404).send({ error: 'Lead not found' });
      }

      if (lead.archivedAt) {
        return reply.status(409).send({ error: 'Cannot reschedule visit for archived lead' });
      }

      const updated = await prisma.lead.update({
        where: { id },
        data: { scheduledVisitAt: visitDate },
      });

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'Admin',
        ownerId: owner.id,
        action: 'visit_scheduled',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
        metadata: { scheduledVisitAt },
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ leadId: id, scheduledVisitAt: updated.scheduledVisitAt });
    },
  );
}
