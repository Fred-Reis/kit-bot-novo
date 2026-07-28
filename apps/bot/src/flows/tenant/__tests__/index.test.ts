import { beforeEach, describe, expect, it, mock } from 'bun:test';

const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const events: Array<{ chatId: string; role: string; content: string }> = [];
let conversationUpsertData: Record<string, unknown> | null = null;
let botPausedAfterAgent = false;

// Only the leaves buildTenantSnapshot touches are mocked here (db/client,
// db/redis) — NOT '@/flows/tenant/context' itself. Mocking a sibling module
// wholesale would collide with context.test.ts, which tests that module for
// real (bun's mock.module is process-global, not scoped to this file).
const fakeTenantRow = {
  id: 'tenant-1',
  name: 'Maria',
  contractStart: new Date('2026-01-01T00:00:00Z'),
  contractEnd: null,
  property: { id: 'p1', externalId: 'IM-0001', name: 'Kitnet no Retiro', address: 'Rua X', rent: 900 },
  owner: { id: 'owner-1', name: 'Fred', phone: '5511988887777' },
  payments: [],
};
let tenantRowForSnapshot: typeof fakeTenantRow | null = fakeTenantRow;

mock.module('@/db/client', () => ({
  prisma: {
    tenant: { findUnique: async () => tenantRowForSnapshot },
    event: {
      findMany: async () => [],
      create: async (args: { data: { chatId: string; role: string; content: string } }) => {
        events.push(args.data);
        return args.data;
      },
    },
    conversation: {
      findUnique: async () => ({ botPaused: botPausedAfterAgent }),
      upsert: async (args: { update: Record<string, unknown> }) => {
        conversationUpsertData = args.update;
        return {};
      },
    },
    $transaction: async (ops: unknown[]) => ops,
  },
}));

mock.module('@/db/redis', () => ({
  redis: {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
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

mock.module('@/agents/tenant-v2', () => ({
  runTenantAgentV2: async () => 'Resposta do agente.',
}));

mock.module('@/agents/tenant-tools', () => ({
  buildTenantTools: () => [],
}));

import type { MediaItem } from '@/buffer';
import { handleTenantMessage } from '@/flows/tenant/index';

const noMedia: MediaItem[] = [];

describe('handleTenantMessage', () => {
  beforeEach(() => {
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
    events.length = 0;
    conversationUpsertData = null;
    botPausedAfterAgent = false;
    tenantRowForSnapshot = fakeTenantRow;
  });

  it('saudação simples → resposta hardcoded personalizada, sem chamar o agente', async () => {
    await handleTenantMessage('5511999999999@s.whatsapp.net', 'oi', noMedia, 'owner-1', 'tenant-1', 'Maria');
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toBe('Olá, Maria!');
  });

  it('emergência → resposta hardcoded + notifica owner imediatamente', async () => {
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'Socorro, tem um incêndio aqui!',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts[0]?.text).toContain('🚨');
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_emergency');
    expect(activityLogs[0]?.action).toBe('tenant_emergency');
  });

  it('áudio sem texto → resposta hardcoded, sem chamar o agente', async () => {
    const audioItem = { type: 'audio', mime: 'audio/ogg', base64: 'x' } as MediaItem;
    await handleTenantMessage('5511999999999@s.whatsapp.net', null, [audioItem], 'owner-1', 'tenant-1', 'Maria');
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toContain('áudio');
  });

  it('texto livre → chama o agente e envia a resposta', async () => {
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'quando vence o aluguel?',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toBe('Resposta do agente.');
    expect(events.some((e) => e.role === 'user' && e.content === 'quando vence o aluguel?')).toBe(true);
    expect(events.some((e) => e.role === 'assistant' && e.content === 'Resposta do agente.')).toBe(true);
  });

  it('agente escalou (botPaused true) → não envia texto extra depois', async () => {
    botPausedAfterAgent = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'quero negociar o valor',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    // conv.botPaused=true significa que uma tool (ex: escalar_owner) já avisou o
    // inquilino durante o turno do agente; o orquestrador não deve mandar nada.
    expect(sentTexts).toHaveLength(0);
  });

  it('snapshot ausente → mensagem neutra ao inquilino + notifica owner (regra 8)', async () => {
    tenantRowForSnapshot = null;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'quando vence o aluguel?',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toContain('instabilidade');
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_escalation');
  });
});
