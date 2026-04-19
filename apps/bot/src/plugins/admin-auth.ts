import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { createClient } from '@supabase/supabase-js';
import { config } from '@/config';

const supabaseAdmin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

export async function verifyAdminJwt(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const auth = request.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing authorization header' });
  }

  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  request.adminUserId = data.user.id;
}

async function adminAuthPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('adminUserId', null);
}

export default fp(adminAuthPlugin, { name: 'admin-auth' });

declare module 'fastify' {
  interface FastifyRequest {
    adminUserId: string | null;
  }
}
