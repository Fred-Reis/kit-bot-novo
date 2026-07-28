import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mocks the leaves escalateTenantToOwner touches (not the sibling module
// itself) so the REAL escalation.ts runs here — mocking '@/flows/tenant/escalation'
// wholesale would collide with escalation.test.ts, which tests that module for real.
const conversationUpserts: Array<Record<string, unknown>> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];

mock.module('@/db/client', () => ({
  prisma: {
    conversation: {
      upsert: async (args: { update: Record<string, unknown> }) => {
        conversationUpserts.push(args.update);
        return {};
      },
    },
  },
}));

mock.module('@/services/evolution', () => ({
  sendText: async (chatId: string, text: string) => {
    sentTexts.push({ chatId, text });
  },
}));

mock.module('@/services/notify', () => ({
  notifyOwner: async (ownerId: string, eventType: string) => {
    notifyCalls.push({ ownerId, eventType });
  },
}));

mock.module('@/services/activity', () => ({
  logActivity: async (params: Record<string, unknown>) => {
    activityLogs.push(params);
  },
}));

import { buildTenantTools } from '@/agents/tenant-tools';

const deps = {
  chatId: '5511999999999@s.whatsapp.net',
  tenantId: 'tenant-1',
  ownerId: 'owner-1',
  tenantName: 'Maria',
};

function getTool(name: string) {
  const t = buildTenantTools(deps).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

describe('escalar_owner', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
  });

  it('escala com o motivo informado', async () => {
    const out = (await getTool('escalar_owner').invoke({ motivo: 'pedido de negociação de aluguel' })) as string;

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.chatId).toBe(deps.chatId);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');
    expect(activityLogs[0]).toMatchObject({ action: 'tenant_escalated', subjectId: deps.tenantId });
    expect(out).toContain('pausado');
  });
});

describe('lista completa', () => {
  it('expõe exatamente 1 tool na T1', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner']);
  });
});
