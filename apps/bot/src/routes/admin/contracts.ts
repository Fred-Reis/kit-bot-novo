import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { formatBRL } from '@/lib/format';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { normalizeLookupText } from '@/services/catalog';
import { formatDatePtBR } from '@/services/contract-variables';
import { nextExternalId } from '@/services/external-id';
import { generateAndUploadPdf } from '@/services/pdf';
import { supabase } from './shared';

export async function contractsRoutes(fastify: FastifyInstance): Promise<void> {
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

    if (monthlyRent == null || typeof monthlyRent !== 'number' || isNaN(monthlyRent) || monthlyRent <= 0) {
      return reply.status(400).send({ error: 'monthlyRent must be a positive number' });
    }

    const [template, tenant, property] = await Promise.all([
      prisma.contractTemplate.findUnique({ where: { id: templateId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.property.findUnique({ where: { id: propertyId }, include: { owner: true } }),
    ]);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (!property) return reply.status(404).send({ error: 'Property not found' });
    if (isNaN(new Date(startDate).getTime()))
      return reply.status(400).send({ error: 'Invalid startDate' });
    if (endDate && isNaN(new Date(endDate).getTime()))
      return reply.status(400).send({ error: 'Invalid endDate' });
    if (endDate && new Date(endDate) <= new Date(startDate))
      return reply.status(400).send({ error: 'endDate must be after startDate' });

    const { owner } = property;
    if (!owner) return reply.status(404).send({ error: 'Owner not found' });

    const formatDate = (d: string | Date) => formatDatePtBR(new Date(d));

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

    if (monthlyRent == null || typeof monthlyRent !== 'number' || isNaN(monthlyRent) || monthlyRent <= 0) {
      return reply.status(400).send({ error: 'monthlyRent must be a positive number' });
    }

    const [template, tenant, property] = await Promise.all([
      prisma.contractTemplate.findUnique({ where: { id: templateId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } }),
      prisma.property.findUnique({ where: { id: propertyId } }),
    ]);
    if (!template) return reply.status(404).send({ error: 'Template not found' });
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    if (!property) return reply.status(404).send({ error: 'Property not found' });
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

  // ─── get signed contract pdf ──────────────────────────────────────────────
  // The 'contracts' bucket has no read policy for the anon/authenticated
  // client — only this backend (service role) can sign URLs into it. Mirrors
  // the /pdf route above, but for the tenant's actually-signed copy.
  fastify.get<{ Params: { id: string } }>(
    '/admin/contracts/:id/signed-pdf',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const contract = await prisma.contract.findUnique({
        where: { id },
        select: { signedPdfUrl: true },
      });
      if (!contract) return reply.status(404).send({ error: 'Contract not found' });
      if (!contract.signedPdfUrl) return reply.status(404).send({ error: 'No signed PDF for this contract' });

      const { data: signed, error: signError } = await supabase.storage
        .from('contracts')
        .createSignedUrl(contract.signedPdfUrl, 300);
      if (signError || !signed) return reply.status(500).send({ error: 'Could not sign PDF URL' });
      return reply.send({ url: signed.signedUrl });
    },
  );
}
