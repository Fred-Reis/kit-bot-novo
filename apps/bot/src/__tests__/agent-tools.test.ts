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
let im01Status = 'available';

mock.module('@/services/catalog', () => ({
  getPropertyByExternalId: async (id: string) =>
    id === 'IM01' ? { externalId: 'IM01', name: 'Kitnet Retiro', active: true, status: im01Status } : null,
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

  it('data futura, dia útil e dentro do horário → persiste e confirma com data formatada', async () => {
    // 2030-01-07 é uma segunda-feira (America/Sao_Paulo).
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2030-01-07T14:00:00-03:00',
    })) as string;
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

  it('fim de semana → erro explicando que só há visita de segunda a sexta', async () => {
    // 2030-01-12 é um sábado.
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2030-01-12T10:00:00-03:00',
    })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
    expect(out).toContain('segunda a sexta');
  });

  it('antes das 8h num dia útil → erro explicando o horário disponível', async () => {
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2030-01-07T07:00:00-03:00',
    })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
    expect(out).toContain('8h');
    expect(out).toContain('17h');
  });

  it('às 17h ou depois num dia útil → erro explicando o horário disponível', async () => {
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2030-01-07T17:00:00-03:00',
    })) as string;
    expect(leadUpdates.length).toBe(0);
    expect(out).toContain('Erro');
  });

  it('às 16h59 num dia útil → dentro do horário, permite agendar', async () => {
    const out = (await getTool('agendar_visita').invoke({
      dataHoraIso: '2030-01-07T16:59:00-03:00',
    })) as string;
    expect(out).toContain('✅ Visita confirmada');
  });
});

describe('info_imovel', () => {
  beforeEach(() => {
    im01Status = 'available';
  });

  it('retorna fatos do imóvel em foco', async () => {
    const out = (await getTool('info_imovel').invoke({ externalId: null })) as string;
    expect(out).toContain('Kitnet no Retiro');
    expect(out).toContain('Caução 2x');
  });

  it('imóvel alugado (status != available) → recusa, nunca descreve como se estivesse disponível', async () => {
    im01Status = 'rented';
    const out = (await getTool('info_imovel').invoke({ externalId: null })) as string;
    expect(out).toContain('Erro');
    expect(out).not.toContain('Kitnet no Retiro');
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
