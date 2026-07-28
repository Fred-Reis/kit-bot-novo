import { beforeEach, describe, expect, it, mock } from 'bun:test';

const tenantCalls: unknown[] = [];
const leadCalls: unknown[] = [];
let fakeOwner: { id: string; botEnabled: boolean } | null = { id: 'owner-1', botEnabled: true };
let fakeTenant: { id: string; name: string | null; ownerId: string } | null = null;
let fakeConversation: { botPaused: boolean } | null = null;

mock.module('@/db/client', () => ({
  prisma: {
    owner: { findFirst: async () => fakeOwner },
    lead: { findUnique: async () => null, create: async () => ({ id: 'lead-1', name: null }) },
    tenant: { findUnique: async () => fakeTenant },
    conversation: { findUnique: async () => fakeConversation },
  },
}));

mock.module('@/db/redis', () => ({
  redis: { get: async () => '1', set: async () => 'OK' },
}));

mock.module('@/flows/lead/index', () => ({
  handleLeadMessage: async (...args: unknown[]) => {
    leadCalls.push(args);
  },
}));

mock.module('@/flows/tenant/index', () => ({
  handleTenantMessage: async (...args: unknown[]) => {
    tenantCalls.push(args);
  },
}));

mock.module('@/services/activity', () => ({ logActivity: async () => {} }));

import { routeMessage } from '@/flows/router';

describe('routeMessage — botPaused', () => {
  beforeEach(() => {
    tenantCalls.length = 0;
    leadCalls.length = 0;
    fakeOwner = { id: 'owner-1', botEnabled: true };
    fakeTenant = { id: 'tenant-1', name: 'Maria', ownerId: 'owner-1' };
    fakeConversation = null;
  });

  it('tenant com botPaused=true → NÃO chama handleTenantMessage (bug fixado)', async () => {
    fakeConversation = { botPaused: true };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(tenantCalls).toHaveLength(0);
  });

  it('tenant com botPaused=false → chama handleTenantMessage com 6 argumentos corretos', async () => {
    fakeConversation = { botPaused: false };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(tenantCalls).toHaveLength(1);
    expect(tenantCalls[0]).toEqual([
      '5511999999999@s.whatsapp.net',
      'oi',
      [],
      'owner-1',
      'tenant-1',
      'Maria',
    ]);
  });

  it('tenant sem Conversation ainda (null) → trata como não pausado, chama handleTenantMessage', async () => {
    fakeConversation = null;
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(tenantCalls).toHaveLength(1);
  });

  it('lead com botPaused=true → continua suprimido (regressão)', async () => {
    fakeTenant = null;
    fakeConversation = { botPaused: true };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], null);
    expect(leadCalls).toHaveLength(0);
  });
});
