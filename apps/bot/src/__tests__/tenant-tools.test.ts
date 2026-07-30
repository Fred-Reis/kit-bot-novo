import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mocks the leaves escalateTenantToOwner touches (not the sibling module
// itself) so the REAL escalation.ts runs here — mocking '@/flows/tenant/escalation'
// wholesale would collide with escalation.test.ts, which tests that module for real.
const conversationUpserts: Array<Record<string, unknown>> = [];
const events: Array<{ chatId: string; role: string; content: string }> = [];
const sentTexts: Array<{ chatId: string; text: string }> = [];
const notifyCalls: Array<{ ownerId: string; eventType: string; payload: unknown }> = [];
const activityLogs: Array<Record<string, unknown>> = [];
const complaintCreates: Array<{ ownerId: string; tenantId: string; summary: string; content: string }> = [];
const maintenanceCreates: Array<Record<string, unknown>> = [];
const serviceProviders: Array<Record<string, unknown>> = [];

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
    complaint: {
      create: async (args: {
        data: { ownerId: string; tenantId: string; summary: string; content: string };
      }) => {
        complaintCreates.push(args.data);
        return { id: 'complaint-1', ...args.data, status: 'open', createdAt: new Date().toISOString() };
      },
    },
    maintenanceRequest: {
      create: async (args: { data: Record<string, unknown> }) => {
        maintenanceCreates.push(args.data);
        return {
          id: 'maintenance-1',
          ...args.data,
          status: 'open',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    },
    serviceProvider: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        return (
          serviceProviders.find(
            (p) => p.ownerId === args.where.ownerId && p.type === args.where.type && p.active === true,
          ) ?? null
        );
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
  propertyId: 'property-1',
  pendingMediaUrls: [] as string[],
};

const depsWithMedia = { ...deps, pendingMediaUrls: ['leads/5511999999999/123.jpg'] };

function getTool(name: string) {
  const t = buildTenantTools(deps).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

function getToolWithMedia(name: string) {
  const t = buildTenantTools(depsWithMedia).find((x) => x.name === name);
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

describe('registrar_reclamacao', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    events.length = 0;
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
    complaintCreates.length = 0;
  });

  it('cria a reclamação, notifica o owner e loga a atividade', async () => {
    const out = (await getTool('registrar_reclamacao').invoke({
      resumo: 'Barulho excessivo do vizinho',
      conteudo: 'O inquilino relata barulho todas as noites desde a semana passada.',
    })) as string;

    expect(complaintCreates).toHaveLength(1);
    expect(complaintCreates[0]).toEqual({
      ownerId: deps.ownerId,
      tenantId: deps.tenantId,
      summary: 'Barulho excessivo do vizinho',
      content: 'O inquilino relata barulho todas as noites desde a semana passada.',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_complaint');
    expect(notifyCalls[0]?.payload).toMatchObject({ summary: 'Barulho excessivo do vizinho' });
    expect(activityLogs[0]).toMatchObject({ action: 'complaint_registered', subjectId: 'complaint-1' });
    expect(out).toContain('registrada');
  });
});

describe('abrir_chamado', () => {
  beforeEach(() => {
    maintenanceCreates.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
  });

  it('cria o chamado com mediaUrls pendentes e não notifica quando é tenant + severidade baixa', async () => {
    const out = (await getToolWithMedia('abrir_chamado').invoke({
      tipo: 'eletrica',
      severidade: 'baixa',
      resumo: 'Lâmpada queimada na sala',
      responsabilidade: 'tenant',
    })) as string;

    expect(maintenanceCreates).toHaveLength(1);
    expect(maintenanceCreates[0]).toMatchObject({
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      propertyId: 'property-1',
      type: 'eletrica',
      severity: 'baixa',
      responsibility: 'tenant',
      summary: 'Lâmpada queimada na sala',
      mediaUrls: ['leads/5511999999999/123.jpg'],
    });
    expect(notifyCalls).toHaveLength(0);
    expect(activityLogs[0]).toMatchObject({ action: 'maintenance_request_created', subjectId: 'maintenance-1' });
    expect(out).toContain('registrado');
  });

  it('notifica o owner quando responsabilidade é owner', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'hidraulica',
      severidade: 'media',
      resumo: 'Vazamento sob a pia',
      responsabilidade: 'owner',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_maintenance_request');
    expect(notifyCalls[0]?.payload).toMatchObject({ responsibility: 'owner' });
  });

  it('notifica o owner quando responsabilidade é unclear', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'civil',
      severidade: 'media',
      resumo: 'Rachadura na parede, causa incerta',
      responsabilidade: 'unclear',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_maintenance_request');
  });

  it('notifica o owner quando severidade é urgente, mesmo com responsabilidade tenant', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'hidraulica',
      severidade: 'urgente',
      resumo: 'Cano estourou, água alagando o quarto',
      responsabilidade: 'tenant',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_maintenance_request');
  });

  it('sem mediaUrls pendentes, cria o chamado com array vazio', async () => {
    await getTool('abrir_chamado').invoke({
      tipo: 'limpeza_conservacao',
      severidade: 'baixa',
      resumo: "Caixa d'água precisa de limpeza",
      responsabilidade: 'owner',
    });
    expect(maintenanceCreates[0]?.mediaUrls).toEqual([]);
  });
});

describe('indicar_profissional', () => {
  beforeEach(() => {
    serviceProviders.length = 0;
  });

  it('retorna nome e telefone do profissional ativo', async () => {
    serviceProviders.push({
      id: 'sp-1',
      ownerId: 'owner-1',
      name: 'João Elétrica',
      phone: '11955554444',
      type: 'eletrica',
      active: true,
    });
    const out = (await getTool('indicar_profissional').invoke({ tipo: 'eletrica' })) as string;
    expect(out).toContain('João Elétrica');
    expect(out).toContain('11955554444');
  });

  it('sem profissional cadastrado, responde honestamente', async () => {
    const out = (await getTool('indicar_profissional').invoke({ tipo: 'hidraulica' })) as string;
    expect(out.toLowerCase()).toContain('não há profissional');
  });
});

describe('lista completa', () => {
  it('expõe as 4 tools da T1-T3', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner', 'registrar_reclamacao', 'abrir_chamado', 'indicar_profissional']);
  });
});
