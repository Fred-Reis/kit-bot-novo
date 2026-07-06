import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import { config } from '@/config';
import adminAuthPlugin from '@/plugins/admin-auth';
import { adminRoutes } from '@/routes/admin';
import { evolutionWebhookPlugin } from '@/webhooks/evolution';

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',
  });
}

const fastify = Fastify({
  logger: { level: config.LOG_LEVEL },
});

fastify.register(cors, {
  origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB
fastify.register(adminAuthPlugin);
fastify.register(evolutionWebhookPlugin);
fastify.register(adminRoutes);

fastify.get('/health', async () => ({ status: 'ok' }));

Sentry.setupFastifyErrorHandler(fastify);

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
