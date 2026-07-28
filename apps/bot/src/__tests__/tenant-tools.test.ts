import { beforeEach, describe, expect, it, mock } from 'bun:test';

const escalations: Array<{ chatId: string; ownerId: string; tenantId: string; tenantName: string | null; reason: string }> = [];

mock.module('@/flows/tenant/escalation', () => ({
  escalateTenantToOwner: async (
    chatId: string,
    ownerId: string,
    tenantId: string,
    tenantName: string | null,
    reason: string,
  ) => {
    escalations.push({ chatId, ownerId, tenantId, tenantName, reason });
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
    escalations.length = 0;
  });

  it('escala com o motivo informado', async () => {
    const out = (await getTool('escalar_owner').invoke({ motivo: 'pedido de negociação de aluguel' })) as string;
    expect(escalations).toHaveLength(1);
    expect(escalations[0]).toMatchObject({
      chatId: deps.chatId,
      ownerId: deps.ownerId,
      tenantId: deps.tenantId,
      tenantName: 'Maria',
      reason: 'out_of_scope',
    });
    expect(out).toContain('pausado');
  });
});

describe('lista completa', () => {
  it('expõe exatamente 1 tool na T1', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner']);
  });
});
