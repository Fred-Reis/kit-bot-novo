import { beforeEach, describe, expect, it, mock } from 'bun:test';

const conversationUpserts: Array<Record<string, unknown>> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];

mock.module('@/db/client', () => ({
  prisma: {
    conversation: {
      upsert: async (args: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }) => {
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
  notifyOwner: async (ownerId: string, eventType: string, payload: unknown) => {
    notifyCalls.push({ ownerId, eventType, payload });
  },
  buildTenantEscalationMessage: (p: { tenantName: string; tenantPhone: string; reason: string }) =>
    `mock-message:${p.tenantName}:${p.reason}`,
}));

mock.module('@/services/activity', () => ({
  logActivity: async (params: Record<string, unknown>) => {
    activityLogs.push(params);
  },
}));

import { escalateTenantToOwner } from '@/flows/tenant/escalation';

describe('escalateTenantToOwner', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    sentTexts.length = 0;
    activityLogs.length = 0;
    notifyCalls.length = 0;
  });

  it('pausa a conversa, avisa o inquilino, notifica o owner e loga a atividade', async () => {
    await escalateTenantToOwner('5511999999999@s.whatsapp.net', 'owner-1', 'tenant-1', 'Maria', 'out_of_scope');

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.chatId).toBe('5511999999999@s.whatsapp.net');

    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');

    expect(activityLogs).toHaveLength(1);
    expect(activityLogs[0]?.action).toBe('tenant_escalated');
    expect(activityLogs[0]?.subjectId).toBe('tenant-1');
  });

  it('mensagem ao inquilino sem nome cadastrado usa o telefone', async () => {
    await escalateTenantToOwner('5511999999999@s.whatsapp.net', 'owner-1', 'tenant-1', null, 'human_request');
    expect(notifyCalls[0]?.payload).toMatchObject({ tenantName: '5511999999999@s.whatsapp.net' });
  });
});
