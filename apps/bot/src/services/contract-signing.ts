import { createClient } from '@supabase/supabase-js';
import { config } from '@/config';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { logActivity } from '@/services/activity';
import { extractCpfFromDocs } from '@/services/cpf';
import { nextExternalId } from '@/services/external-id';
import { notifyOwner } from '@/services/notify';

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

export interface FinalizeSigningParams {
  leadId: string;
  contractId: string;
  actorLabel: string;
  /** Storage path of the signed PDF in the 'contracts' bucket, if available */
  signedPdfUrl?: string | null;
  finalContractBody?: string;
  finalPdfPath?: string;
}

export interface FinalizeSigningResult {
  tenantId: string;
  tenantExternalId: string;
}

/**
 * Core signing finalization: creates Tenant, updates Contract to active,
 * marks Property as rented, clears Redis cache, logs activity, notifies owner.
 * Called by both the admin mark-signed endpoint and the bot's inbound-PDF handler.
 */
export async function finalizeContractSigning(
  params: FinalizeSigningParams,
): Promise<FinalizeSigningResult> {
  const { leadId, contractId, actorLabel, signedPdfUrl, finalContractBody, finalPdfPath } = params;

  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { phone: true, name: true, ownerId: true, propertyId: true, documents: { select: { ocrText: true } } },
  });

  if (!lead.propertyId) throw new Error('Lead has no associated property');
  const propertyId = lead.propertyId;

  const cpf = extractCpfFromDocs(lead.documents);
  const tenantExternalId = await nextExternalId('tenant');
  const today = new Date();

  const tenant = await prisma.$transaction(async (tx) => {
    const newTenant = await tx.tenant.create({
      data: {
        phone: lead.phone,
        name: lead.name ?? undefined,
        cpf: cpf ?? undefined,
        propertyId,
        contractStart: today,
        externalId: tenantExternalId,
        ownerId: lead.ownerId,
      },
    });
    await Promise.all([
      tx.contract.update({
        where: { id: contractId },
        data: {
          tenantId: newTenant.id,
          startDate: today,
          status: 'active',
          ...(finalContractBody != null ? { body: finalContractBody } : {}),
          ...(finalPdfPath != null ? { pdfUrl: finalPdfPath } : {}),
          ...(signedPdfUrl != null ? { signedPdfUrl } : {}),
        },
      }),
      tx.property.update({ where: { id: propertyId }, data: { status: 'rented', active: false } }),
    ]);
    return newTenant;
  });

  await redis.del(`property:${lead.propertyId}`);

  const leadLabel = lead.name ?? lead.phone;

  logActivity({
    actorType: 'user',
    actorLabel,
    ownerId: lead.ownerId,
    action: 'contract_signed',
    subject: leadLabel,
    subjectId: leadId,
    subjectType: 'lead',
  }).catch(console.warn);

  logActivity({
    actorType: 'user',
    actorLabel,
    ownerId: lead.ownerId,
    action: 'tenant_created',
    subject: tenantExternalId,
    subjectId: tenant.id,
    subjectType: 'tenant',
  }).catch(console.warn);

  notifyOwner(lead.ownerId, 'contract_signed', {
    leadName: leadLabel,
    tenantExternalId,
  }).catch(console.warn);

  return { tenantId: tenant.id, tenantExternalId };
}

/**
 * Upload a signed contract PDF (base64) to Supabase Storage.
 * Returns the storage path.
 */
export async function uploadSignedContractPdf(
  contractId: string,
  base64: string,
  filename: string,
): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
  const path = `signed/${contractId}/${filename}`;
  const { error } = await supabase.storage.from('contracts').upload(path, buf, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(`Signed contract upload failed: ${error.message}`);
  return path;
}
