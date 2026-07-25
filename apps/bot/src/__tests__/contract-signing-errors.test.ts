import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Prisma } from '@prisma/client';

let leadUpdateManyCount = 1;
let tenantCreateError: unknown = null;

mock.module('@/db/client', () => ({
  prisma: {
    lead: {
      findUniqueOrThrow: async () => ({
        phone: '5527997300401@s.whatsapp.net',
        name: 'Victor Martins',
        ownerId: 'owner-1',
        propertyId: 'property-1',
        property: { contractMonths: 6 },
        documents: [],
      }),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        lead: {
          updateMany: async () => ({ count: leadUpdateManyCount }),
        },
        tenant: {
          create: async () => {
            if (tenantCreateError) throw tenantCreateError;
            return { id: 'tenant-1' };
          },
        },
        tenantDocument: { createMany: async () => ({}) },
        contract: { update: async () => ({}) },
        property: { update: async () => ({}) },
      };
      return fn(tx);
    },
  },
}));

mock.module('@/db/redis', () => ({ redis: { del: async () => 1 } }));
mock.module('@/services/activity', () => ({ logActivity: async () => {} }));
mock.module('@/services/notify', () => ({ notifyOwner: async () => {} }));
mock.module('@/services/external-id', () => ({ nextExternalId: async () => 'IQ-999' }));

import {
  finalizeContractSigning,
  LeadStageConflictError,
  TenantPhoneConflictError,
} from '@/services/contract-signing';

describe('finalizeContractSigning error mapping', () => {
  beforeEach(() => {
    leadUpdateManyCount = 1;
    tenantCreateError = null;
  });

  it('lança LeadStageConflictError quando o lead já saiu de contract_pending', async () => {
    leadUpdateManyCount = 0;

    await expect(
      finalizeContractSigning({ leadId: 'lead-1', contractId: 'contract-1', actorLabel: 'admin' }),
    ).rejects.toBeInstanceOf(LeadStageConflictError);
  });

  it('lança TenantPhoneConflictError quando Tenant.phone já existe (P2002)', async () => {
    tenantCreateError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.7.0',
    });

    await expect(
      finalizeContractSigning({ leadId: 'lead-1', contractId: 'contract-1', actorLabel: 'admin' }),
    ).rejects.toBeInstanceOf(TenantPhoneConflictError);
  });

  it('propaga outros erros do Prisma sem mascarar', async () => {
    tenantCreateError = new Error('connection reset');

    await expect(
      finalizeContractSigning({ leadId: 'lead-1', contractId: 'contract-1', actorLabel: 'admin' }),
    ).rejects.toThrow('connection reset');
  });
});
