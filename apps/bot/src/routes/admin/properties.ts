import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { invalidateAvailablePropertiesCache, invalidatePropertyCache } from '@/services/catalog';
import { nextExternalId } from '@/services/external-id';
import { supabase } from './shared';

const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

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

const PROPERTY_CREATE_FIELDS = new Set([
  ...PROPERTY_PATCH_FIELDS,
  'title',
  'parkingSpots',
  'amenities',
  'type',
  'purpose',
  'status',
]);

export async function propertiesRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── invalidate-property-cache ────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>(
    '/admin/properties/:id/invalidate-cache',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      await invalidatePropertyCache(id);
      await invalidateAvailablePropertiesCache();
      fastify.log.info({ propertyId: id }, 'Property cache invalidated');

      return reply.send({ success: true });
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

    const sanitizedRest = Object.fromEntries(
      Object.entries(rest).filter(([k]) => PROPERTY_CREATE_FIELDS.has(k)),
    );

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
        ownerId: owner.id,
        ...sanitizedRest,
      },
    });

    await logActivityHelper({
      ownerId: property.ownerId,
      actorType: 'user',
      actorId: request.adminUserId ?? undefined,
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
      await invalidatePropertyCache(id);
      await invalidateAvailablePropertiesCache();

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
      await invalidatePropertyCache(id);
      await invalidateAvailablePropertiesCache();

      await logActivityHelper({
        ownerId: existing.ownerId,
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
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

      let storagePath: string | undefined;
      try {
        const urlPath = new URL(media.url).pathname;
        storagePath = urlPath.split('/storage/v1/object/public/properties/')[1];
        if (!storagePath) {
          fastify.log.warn({ url: media.url, mediaId }, 'Could not derive storage path from media URL — deleting record without storage cleanup');
        }
      } catch (urlErr) {
        fastify.log.warn({ err: urlErr, url: media.url, mediaId }, 'Invalid media URL — deleting record without storage cleanup');
      }

      if (storagePath) {
        const { error: removeErr } = await supabase.storage.from('properties').remove([storagePath]);
        if (removeErr) {
          fastify.log.error({ err: removeErr, storagePath, mediaId }, 'Failed to remove media from storage');
          return reply.status(502).send({ error: 'Failed to remove media from storage; try again' });
        }
      }

      await prisma.propertyMedia.delete({ where: { id: mediaId } });
      await invalidatePropertyCache(id);
      await invalidateAvailablePropertiesCache();

      return reply.send({ success: true });
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

    if (!type || !['photo', 'video'].includes(type)) {
      return reply.status(400).send({ error: 'type must be photo or video' });
    }
    if (!path || typeof path !== 'string') {
      return reply.status(400).send({ error: 'path is required' });
    }

    const normalizedPath = path.replace(/\\/g, '/').replace(/\/\.\.\//g, '/').replace(/\/{2,}/g, '/');
    if (!normalizedPath.startsWith(`${id}/`) || normalizedPath.includes('..')) {
      return reply.status(400).send({ error: 'Invalid path for this property' });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('properties').getPublicUrl(normalizedPath);

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

    await invalidatePropertyCache(id);
    await invalidateAvailablePropertiesCache();

    return reply.status(201).send({ success: true, media });
  });
}
