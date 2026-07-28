import { beforeEach, describe, expect, it, mock } from 'bun:test';

const sentTexts: Array<{ chatId: string; text: string }> = [];
const leadCalls: unknown[] = [];
let fakeOwner: { id: string; botEnabled: boolean } | null = { id: 'owner-1', botEnabled: true };
let fakeConversation: { botPaused: boolean } | null = null;

// The tenant path is exercised through the REAL handleTenantMessage (leaf
// mocks only: db/client, db/redis, evolution, notify, activity, tenant-v2,
// tenant-tools) — never mock '@/flows/tenant/index' wholesale here, since
// flows/tenant/__tests__/index.test.ts imports that module for real and
// bun's mock.module is process-global, not file-scoped (see the T1 plan's
// Global Constraints — this collision bit the implementation three times).
// Only '@/flows/lead/index' is safe to fake wholesale: no other test file
// imports it for real.
//
// One row satisfies both prisma.tenant.findUnique call shapes: router.ts's
// own bare lookup (only reads .id/.name/.ownerId) and context.ts's `include`
// query (reads .property/.owner/.payments too) — Prisma's `include` doesn't
// change what a mock returns, only what a real query selects.
const fakeTenantRow = {
  id: 'tenant-1',
  name: 'Maria',
  ownerId: 'owner-1',
  contractStart: new Date('2026-01-01T00:00:00Z'),
  contractEnd: null,
  property: { id: 'p1', externalId: 'IM-0001', name: 'Kitnet no Retiro', address: 'Rua X', rent: 900 },
  owner: { id: 'owner-1', name: 'Fred', phone: '5511988887777' },
  payments: [],
};
let tenantExists = false;

mock.module('@/db/client', () => ({
  prisma: {
    owner: { findFirst: async () => fakeOwner },
    lead: { findUnique: async () => null, create: async () => ({ id: 'lead-1', name: null }) },
    tenant: { findUnique: async () => (tenantExists ? fakeTenantRow : null) },
    conversation: {
      findUnique: async () => fakeConversation,
      upsert: async () => ({}),
    },
    event: { findMany: async () => [], create: async (args: { data: unknown }) => args.data },
    $transaction: async (ops: unknown[]) => ops,
  },
}));

mock.module('@/db/redis', () => ({
  redis: {
    // 'bot:enabled:{ownerId}' → router's global-pause cache (kept enabled);
    // 'tenant:{phone}' → snapshot cache, always miss so it rebuilds fresh.
    get: async (key: string) => (key.startsWith('bot:enabled:') ? '1' : null),
    set: async () => 'OK',
    del: async () => 1,
  },
}));

mock.module('@/services/evolution', () => ({
  sendText: async (chatId: string, text: string) => {
    sentTexts.push({ chatId, text });
  },
}));

mock.module('@/services/notify', () => ({ notifyOwner: async () => {} }));
mock.module('@/services/activity', () => ({ logActivity: async () => {} }));

// '@/agents/tenant-v2' / '@/agents/tenant-tools' are deliberately NOT mocked
// here: every message below is 'oi', which the deterministic greeting
// override in flows/tenant/index.ts answers before the agent is ever
// reached — and mocking either would collide with tenant-v2-runner.test.ts /
// tenant-tools.test.ts, which import them for real.

mock.module('@/flows/lead/index', () => ({
  handleLeadMessage: async (...args: unknown[]) => {
    leadCalls.push(args);
  },
}));

import { routeMessage } from '@/flows/router';

describe('routeMessage — botPaused', () => {
  beforeEach(() => {
    sentTexts.length = 0;
    leadCalls.length = 0;
    fakeOwner = { id: 'owner-1', botEnabled: true };
    tenantExists = true;
    fakeConversation = null;
  });

  it('tenant com botPaused=true → NÃO despacha pro handler do inquilino (bug fixado)', async () => {
    fakeConversation = { botPaused: true };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(sentTexts).toHaveLength(0);
  });

  it('tenant com botPaused=false → despacha com os argumentos corretos (greeting real responde)', async () => {
    fakeConversation = { botPaused: false };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toBe('Olá, Maria!');
  });

  it('tenant sem Conversation ainda (null) → trata como não pausado, despacha pro handler', async () => {
    fakeConversation = null;
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], 'Maria');
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toBe('Olá, Maria!');
  });

  it('lead com botPaused=true → continua suprimido (regressão)', async () => {
    tenantExists = false;
    fakeConversation = { botPaused: true };
    await routeMessage('5511999999999@s.whatsapp.net', 'oi', [], null);
    expect(leadCalls).toHaveLength(0);
  });
});
