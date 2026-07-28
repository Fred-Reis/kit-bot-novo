import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mocks the leaves escalateTenantToOwner touches (not the sibling module
// itself) so the REAL escalation.ts runs here — mocking '@/flows/tenant/escalation'
// wholesale would collide with escalation.test.ts, which tests that module for real.
const conversationUpserts: Array<Record<string, unknown>> = [];
const events: Array<{ chatId: string; role: string; content: string }> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];
const activityLogs: Array<Record<string, unknown>> = [];

mock.module('@/db/client', () => ({
  prisma: {
    conversation: {
      upsert: async (args: { update: Record<string, unknown> }) => {
        conversationUpserts.push(args.update);
        return {};
      },
    },
    event: {
      create: async (args: { data: { chatId: string; role: string; content: string } }) => {
        events.push(args.data);
        return args.data;
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
  notifyOwner: async (ownerId: string, eventType: string, payload: unknown) => {
    notifyCalls.push({ ownerId, eventType, payload });
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
    events.length = 0;
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
  });

  it('escala com o motivo informado', async () => {
    const out = (await getTool('escalar_owner').invoke({ motivo: 'pedido de negociação de aluguel' })) as string;

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.chatId).toBe(deps.chatId);
    // The message the tool sent must be persisted even though it crosses an
    // LLM tool-call boundary the orchestrator can't see into.
    expect(events).toHaveLength(1);
    expect(events[0]?.content).toBe(sentTexts[0]?.text);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');
    // motivo do LLM chega até o owner (enriquece o label genérico, sem
    // expandir o enum de TenantEscalationReason).
    expect(notifyCalls[0]?.payload).toMatchObject({
      reason: expect.stringContaining('pedido de negociação de aluguel'),
    });
    expect(activityLogs[0]).toMatchObject({ action: 'tenant_escalated', subjectId: deps.tenantId });
    expect(activityLogs[0]?.metadata).toMatchObject({ detail: 'pedido de negociação de aluguel' });
    expect(out).toContain('pausado');
  });
});

describe('lista completa', () => {
  it('expõe exatamente 1 tool na T1', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner']);
  });
});
