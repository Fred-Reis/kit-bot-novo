import Fastify from 'fastify';
import { config } from '@/config';
import { evolutionWebhookPlugin } from '@/webhooks/evolution';
import adminAuthPlugin from '@/plugins/admin-auth';
import { adminRoutes } from '@/routes/admin';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
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
