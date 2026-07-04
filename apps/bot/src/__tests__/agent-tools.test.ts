import { beforeEach, describe, expect, it, mock } from 'bun:test';

const leadUpdates: Array<Record<string, unknown>> = [];
let fakeLead: Record<string, unknown> = {};

mock.module('@/db/client', () => ({
  prisma: {
    lead: {
      findUnique: async () => fakeLead,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        leadUpdates.push(data);
        return { ...fakeLead, ...data };
      },
    },
    leadDocument: { findMany: async () => [] },
    leadResident: {
      count: async () => 0,
      deleteMany: async () => ({}),
      createMany: async () => ({}),
    },
    $transaction: async (ops: unknown[]) => ops,
    conversation: { upsert: async () => ({}) },
  },
}));

mock.module('@/services/evolution', () => ({ sendText: async () => {}, sendMedia: async () => {} }));
mock.module('@/services/notify', () => ({ notifyOwner: async () => {} }));
mock.module('@/services/catalog', () => ({
  getPropertyByExternalId: async (id: string) =>
    id === 'IM01' ? { externalId: 'IM01', name: 'Kitnet Retiro', active: true } : null,
  describeProperty: () => 'Kitnet no Retiro, R$ 800',
  describePropertyTerms: () => 'Caução 2x, sem pets',
}));

import { buildLeadTools } from '@/agents/tools';

const deps = {
  chatId: '5511999999999@s.whatsapp.net',
  leadId: 'lead-1',
  ownerId: 'owner-1',
  leadName: 'Frederico',
  propertyExternalId: 'IM01',
};

function getTool(name: string) {
  const t = buildLeadTools(deps).find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} não encontrada`);
  return t;
}

describe('registrar_renda', () => {
  beforeEach(() => {
    leadUpdates.length = 0;
    fakeLead = { name: 'Frederico', declaredIncome: null, expectedResidents: 1 };
  });

  it('persiste valor e retorna checklist', async () => {
    const out = (await getTool('registrar_renda').invoke({ valorMensal: 12000 })) as string;
    expect(leadUpdates[0]).toEqual({ declaredIncome: 12000 });
    expect(out).toContain('Renda registrada');
  });

  it('valor inválido → erro em string, sem update', async () => {
    const out = (await getTool('registrar_renda').invoke({ valorMensal: -5 })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
  });
});

describe('agendar_visita', () => {
  beforeEach(() => {
    leadUpdates.length = 0;
    fakeLead = { name: 'Frederico', scheduledVisitAt: null };
  });

  it('data futura → persiste e confirma com data formatada', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const out = (await getTool('agendar_visita').invoke({ dataHoraIso: future })) as string;
    expect(leadUpdates[0]?.scheduledVisitAt).toBeInstanceOf(Date);
    expect(out).toContain('✅ Visita confirmada');
  });

  it('data passada → erro, sem persistir', async () => {
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2020-01-01T10:00:00-03:00',
    })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
  });
});

describe('info_imovel', () => {
  it('retorna fatos do imóvel em foco', async () => {
    const out = (await getTool('info_imovel').invoke({ externalId: null })) as string;
    expect(out).toContain('Kitnet no Retiro');
    expect(out).toContain('Caução 2x');
  });
});

describe('lista completa', () => {
  it('expõe as 7 tools', () => {
    const names = buildLeadTools(deps).map((t) => t.name).sort();
    expect(names).toEqual([
      'agendar_visita',
      'cancelar_visita',
      'escalar_humano',
      'info_imovel',
      'registrar_moradores',
      'registrar_renda',
      'status_checklist',
    ]);
  });
});
