import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from '@/config';
import { evolutionWebhookPlugin } from '@/webhooks/evolution';
import adminAuthPlugin from '@/plugins/admin-auth';
import { adminRoutes } from '@/routes/admin';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

fastify.register(cors, {
  origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
fastify.register(adminAuthPlugin);
fastify.register(evolutionWebhookPlugin);
fastify.register(adminRoutes);

fastify.get('/health', async () => ({ status: 'ok' }));

const start = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    fastify.log.info(`Kit-bot running on port ${config.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

void start();
