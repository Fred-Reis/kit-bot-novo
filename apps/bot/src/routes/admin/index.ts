import type { FastifyInstance } from 'fastify';
import { botSettingsRoutes } from './bot-settings';
import { complaintsRoutes } from './complaints';
import { contractsRoutes } from './contracts';
import { coordinatorsRoutes } from './coordinators';
import { leadsRoutes } from './leads';
import { paymentsRoutes } from './payments';
import { propertiesRoutes } from './properties';
import { providersRoutes } from './providers';
import { ruleSetsRoutes } from './rule-sets';
import { templatesRoutes } from './templates';
import { tenantsRoutes } from './tenants';
import { visitsRoutes } from './visits';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  await botSettingsRoutes(fastify);
  await leadsRoutes(fastify);
  await propertiesRoutes(fastify);
  await tenantsRoutes(fastify);
  await ruleSetsRoutes(fastify);
  await coordinatorsRoutes(fastify);
  await complaintsRoutes(fastify);
  await templatesRoutes(fastify);
  await contractsRoutes(fastify);
  await paymentsRoutes(fastify);
  await visitsRoutes(fastify);
  await providersRoutes(fastify);
}
