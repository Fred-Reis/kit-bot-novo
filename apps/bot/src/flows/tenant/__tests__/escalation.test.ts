import { beforeEach, describe, expect, it, mock } from 'bun:test';

const conversationUpserts: Array<Record<string, unknown>> = [];
const events: Array<{ chatId: string; role: string; content: string }> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];
let sendTextShouldThrow = false;

mock.module('@/db/client', () => ({
  prisma: {
    conversation: {
      upsert: async (args: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }) => {
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
    if (sendTextShouldThrow) throw new Error('Evolution API down');
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

import { escalateTenantToOwner } from '@/flows/tenant/escalation';

describe('escalateTenantToOwner', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    events.length = 0;
    sentTexts.length = 0;
    activityLogs.length = 0;
    notifyCalls.length = 0;
    sendTextShouldThrow = false;
  });

  it('pausa a conversa, avisa o inquilino, persiste o Event, notifica o owner e loga a atividade', async () => {
    await escalateTenantToOwner('5511999999999@s.whatsapp.net', 'owner-1', 'tenant-1', 'Maria', 'out_of_scope');

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.chatId).toBe('5511999999999@s.whatsapp.net');

    expect(events).toHaveLength(1);
    expect(events[0]?.role).toBe('assistant');
    expect(events[0]?.content).toBe(sentTexts[0]?.text);

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

  it('detail opcional enriquece o motivo enviado ao owner sem expandir o enum', async () => {
    await escalateTenantToOwner(
      '5511999999999@s.whatsapp.net',
      'owner-1',
      'tenant-1',
      'Maria',
      'out_of_scope',
      'pedido de negociação de aluguel',
    );
    expect(notifyCalls[0]?.payload).toMatchObject({
      reason: expect.stringContaining('pedido de negociação de aluguel'),
    });
    expect(activityLogs[0]?.metadata).toMatchObject({ detail: 'pedido de negociação de aluguel' });
  });

  it('sendText falha → Event, notifyOwner e logActivity ainda rodam (nunca deixa o inquilino preso em silêncio)', async () => {
    sendTextShouldThrow = true;
    await escalateTenantToOwner('5511999999999@s.whatsapp.net', 'owner-1', 'tenant-1', 'Maria', 'frustration');

    expect(conversationUpserts[0]).toEqual({ botPaused: true });
    expect(sentTexts).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');
    expect(activityLogs).toHaveLength(1);
    expect(activityLogs[0]?.action).toBe('tenant_escalated');
  });
});
