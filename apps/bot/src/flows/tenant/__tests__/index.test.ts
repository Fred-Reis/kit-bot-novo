import { beforeEach, describe, expect, it, mock } from 'bun:test';

const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const events: Array<{ chatId: string; role: string; content: string }> = [];
const maintenanceRequests: Array<{ id: string; status: string; createdAt: string }> = [];
const maintenanceUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
const agentCalls: Array<{ question: string }> = [];
let toolDepsCaptured: { propertyId: string; pendingMediaUrls: string[] } | null = null;
let botPausedAfterAgent = false;
let maintenanceUpdateManyShouldThrow = false;
let maintenanceUpdateManyResolvedCount = -1; // -1 = "match how many candidates found"
let eventCreateShouldThrow = false;

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
let tenantFindUniqueShouldThrow = false;
let tenantFindUniqueShouldHang = false;
let sendTextShouldThrow = false;

mock.module('@/db/client', () => ({
  prisma: {
    tenant: {
      findUnique: async () => {
        if (tenantFindUniqueShouldThrow) throw new Error('DB down');
        if (tenantFindUniqueShouldHang) return new Promise(() => {}); // never resolves
        return tenantRowForSnapshot;
      },
    },
    event: {
      findMany: async () => [],
      create: async (args: { data: { chatId: string; role: string; content: string } }) => {
        if (eventCreateShouldThrow) throw new Error('DB down');
        events.push(args.data);
        return args.data;
      },
    },
    conversation: {
      findUnique: async () => ({ botPaused: botPausedAfterAgent }),
      upsert: async () => {
        return {};
      },
    },
    maintenanceRequest: {
      findFirst: async (args: { where: { status: { in: string[] } } }) => {
        const candidates = maintenanceRequests.filter((m) => args.where.status.in.includes(m.status));
        candidates.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return candidates[0] ?? null;
      },
      updateMany: async (args: {
        where: { id: string; status: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        if (maintenanceUpdateManyShouldThrow) throw new Error('DB down');
        maintenanceUpdates.push({ id: args.where.id, data: args.data });
        if (maintenanceUpdateManyResolvedCount !== -1) return { count: maintenanceUpdateManyResolvedCount };
        const stillEligible = maintenanceRequests.find(
          (m) => m.id === args.where.id && args.where.status.in.includes(m.status),
        );
        return { count: stillEligible ? 1 : 0 };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
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
    if (sendTextShouldThrow) throw new Error('Evolution API down');
    sentTexts.push({ chatId, text });
  },
}));

mock.module('@/services/notify', () => ({
  notifyOwner: async (ownerId: string, eventType: string, payload: unknown) => {
    notifyCalls.push({ ownerId, eventType, payload });
  },
}));

let createLeadDocumentUrlShouldThrow = false;

mock.module('@/services/storage', () => ({
  createLeadDocumentUrl: async (storagePath: string) => {
    if (createLeadDocumentUrlShouldThrow) throw new Error('Storage down');
    return `https://signed.example/${storagePath}`;
  },
}));

mock.module('@/services/activity', () => ({
  logActivity: async (params: Record<string, unknown>) => {
    activityLogs.push(params);
  },
}));

mock.module('@/agents/tenant-v2', () => ({
  runTenantAgentV2: async (question: string) => {
    agentCalls.push({ question });
    return 'Resposta do agente.';
  },
}));

mock.module('@/agents/tenant-tools', () => ({
  buildTenantTools: (deps: { propertyId: string; pendingMediaUrls: string[] }) => {
    toolDepsCaptured = { propertyId: deps.propertyId, pendingMediaUrls: deps.pendingMediaUrls };
    return [];
  },
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
    botPausedAfterAgent = false;
    tenantRowForSnapshot = fakeTenantRow;
    tenantFindUniqueShouldThrow = false;
    tenantFindUniqueShouldHang = false;
    sendTextShouldThrow = false;
    maintenanceRequests.length = 0;
    maintenanceUpdates.length = 0;
    agentCalls.length = 0;
    toolDepsCaptured = null;
    maintenanceUpdateManyShouldThrow = false;
    maintenanceUpdateManyResolvedCount = -1;
    createLeadDocumentUrlShouldThrow = false;
    eventCreateShouldThrow = false;
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

  it('emergência: sendText e a busca de snapshot falham → notifyOwner ainda dispara', async () => {
    sendTextShouldThrow = true;
    tenantFindUniqueShouldThrow = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'Socorro, tem um incêndio aqui!',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts).toHaveLength(0);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_emergency');
    expect(activityLogs[0]?.action).toBe('tenant_emergency');
  });

  it('emergência: busca de snapshot trava (nunca resolve) → notifyOwner ainda dispara, dentro do teto de tempo', async () => {
    tenantFindUniqueShouldHang = true;
    const start = Date.now();

    // Local timeout on the test itself: if a regression reintroduces the
    // blocking bug (e.g. someone awaits the race before the batch again),
    // this fails fast with a clear message instead of hanging until bun's
    // generic per-test timeout eventually kicks in.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const flow = handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'Socorro, tem um incêndio aqui!',
      noMedia,
      'owner-1',
      'tenant-1',
      'Maria',
    );
    await Promise.race([
      flow,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('fluxo do tenant excedeu o teto de tempo do teste')), 2900);
      }),
    ]).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });

    const elapsedMs = Date.now() - start;
    // sendText/persistTurn/logActivity don't wait on the hung snapshot lookup
    // at all; only notifyOwner is capped by the race (EMERGENCY_SNAPSHOT_TIMEOUT_MS
    // in flows/tenant/index.ts), bounding the whole call instead of hanging forever.
    expect(sentTexts).toHaveLength(1);
    expect(notifyCalls).toHaveLength(1);
    expect(notifyCalls[0]?.eventType).toBe('tenant_emergency');
    expect(elapsedMs).toBeLessThan(3000);
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

  it('frustração + foto com chamado open existente → anexa a foto E escala pro owner (nenhum efeito cancela o outro)', async () => {
    maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'Isso aqui é um lixo, ninguém resolve nada',
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/9.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(maintenanceUpdates[0]).toMatchObject({
      id: 'mr-1',
      data: { mediaUrls: { push: ['leads/5511999999999/9.jpg'] } },
    });
    expect(notifyCalls.find((c) => c.eventType === 'tenant_escalation')).toBeDefined();
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

  it('foto sem texto + chamado open existente → anexa direto, zero LLM', async () => {
    maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/1.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(maintenanceUpdates[0]).toMatchObject({
      id: 'mr-1',
      data: { mediaUrls: { push: ['leads/5511999999999/1.jpg'] } },
    });
    expect(sentTexts[0]?.text).toContain('anexei');
    expect(agentCalls).toHaveLength(0);
  });

  it('anexo bem-sucedido + sendText falha depois → não cai em forwardMediaToOwner (sem mensagem falsa de encaminhamento)', async () => {
    maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    sendTextShouldThrow = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/1.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    // The attach itself must have gone through — a failure to *reply* after
    // a successful write must not be treated as "attach failed".
    expect(maintenanceUpdates).toHaveLength(1);
    expect(notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded')).toBeUndefined();
    expect(sentTexts).toHaveLength(0);
  });

  it('anexo bem-sucedido + persistTurn falha → sendText ainda roda (efeitos isolados, sem cair no forward)', async () => {
    maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    eventCreateShouldThrow = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/1.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(maintenanceUpdates).toHaveLength(1);
    // persistTurn failing must not stop sendText from still running.
    expect(sentTexts[0]?.text).toContain('anexei');
    expect(notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded')).toBeUndefined();
  });

  it('foto sem texto + chamado fica resolvido entre a busca e o anexo (corrida) → encaminha ao owner', async () => {
    maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    maintenanceUpdateManyResolvedCount = 0; // simula 0 linhas afetadas: já não estava mais open/acknowledged
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/1.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts[0]?.text).toContain('encaminhei');
    expect(notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded')).toBeDefined();
  });

  it('foto sem texto + updateMany falha (infra) → ainda avisa o inquilino, não fica em silêncio', async () => {
    maintenanceRequests.push({ id: 'mr-1', status: 'open', createdAt: '2026-07-01T00:00:00Z' });
    maintenanceUpdateManyShouldThrow = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/1.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(sentTexts).toHaveLength(1);
    expect(notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded')).toBeDefined();
  });

  it('foto sem texto + sem chamado aberto → encaminha ao owner com link assinado da mídia, zero LLM', async () => {
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/2.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    const forwardCall = notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded');
    expect(forwardCall).toBeDefined();
    expect(forwardCall?.payload).toMatchObject({
      mediaUrls: ['https://signed.example/leads/5511999999999/2.jpg'],
    });
    expect(agentCalls).toHaveLength(0);
  });

  it('foto sem texto + falha ao assinar URL da mídia → ainda encaminha (sem quebrar), lista vazia', async () => {
    createLeadDocumentUrlShouldThrow = true;
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      null,
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/2.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    const forwardCall = notifyCalls.find((c) => c.eventType === 'tenant_media_forwarded');
    expect(forwardCall?.payload).toMatchObject({ mediaUrls: [] });
    expect(sentTexts).toHaveLength(1);
  });

  it('foto COM texto → segue pro agente, mediaUrls disponíveis via deps', async () => {
    await handleTenantMessage(
      '5511999999999@s.whatsapp.net',
      'Tá vazando embaixo da pia',
      [{ type: 'image', mime: 'image/jpeg', url: 'leads/5511999999999/3.jpg' }],
      'owner-1',
      'tenant-1',
      'Maria',
    );
    expect(agentCalls).toHaveLength(1);
    expect(toolDepsCaptured?.pendingMediaUrls).toEqual(['leads/5511999999999/3.jpg']);
  });
});
