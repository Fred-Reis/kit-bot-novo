import { beforeEach, describe, expect, it, mock } from 'bun:test';

const redisStore = new Map<string, string>();
let findUniqueCallCount = 0;
let redisGetShouldThrow = false;
let redisSetShouldThrow = false;

// Prisma's Decimal coerces correctly through plain Number(value) (see
// services/catalog.ts's `Number(p.rent)` pattern) — the mock uses plain
// numbers here since proving Decimal's own coercion isn't this test's job.
const fakeTenantRow = {
  id: 'tenant-1',
  name: 'Maria Silva',
  contractStart: new Date('2026-01-01T00:00:00Z'),
  contractEnd: null,
  property: {
    id: 'prop-1',
    externalId: 'IM-0001',
    name: 'Kitnet no Retiro',
    address: 'Rua Laranjeiras, 111',
    rent: 900,
  },
  owner: { id: 'owner-1', name: 'Fred', phone: '5511988887777' },
  payments: [
    { month: '2026-07', amount: 900, status: 'paid' },
    { month: '2026-06', amount: 900, status: 'paid' },
  ],
};

mock.module('@/db/client', () => ({
  prisma: {
    tenant: {
      findUnique: async () => {
        findUniqueCallCount++;
        return fakeTenantRow;
      },
    },
  },
}));

mock.module('@/db/redis', () => ({
  redis: {
    get: async (key: string) => {
      if (redisGetShouldThrow) throw new Error('Redis down');
      return redisStore.get(key) ?? null;
    },
    set: async (key: string, value: string) => {
      if (redisSetShouldThrow) throw new Error('Redis down');
      redisStore.set(key, value);
      return 'OK';
    },
    del: async (key: string) => {
      redisStore.delete(key);
      return 1;
    },
  },
}));

import { buildTenantSnapshot, invalidateTenantSnapshotCache, renderTenantContext } from '@/flows/tenant/context';

describe('buildTenantSnapshot', () => {
  beforeEach(() => {
    redisStore.clear();
    findUniqueCallCount = 0;
    redisGetShouldThrow = false;
    redisSetShouldThrow = false;
  });

  it('monta o snapshot a partir do banco na primeira chamada', async () => {
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(snapshot?.tenantId).toBe('tenant-1');
    expect(snapshot?.property.rent).toBe(900);
    expect(snapshot?.recentPayments).toHaveLength(2);
    expect(findUniqueCallCount).toBe(1);
  });

  it('segunda chamada usa o cache — não bate no banco de novo', async () => {
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(findUniqueCallCount).toBe(1);
  });

  it('invalidateTenantSnapshotCache limpa o cache — próxima chamada bate no banco', async () => {
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    await invalidateTenantSnapshotCache('5511999999999@s.whatsapp.net');
    await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(findUniqueCallCount).toBe(2);
  });

  it('redis.get falha → cache é best-effort, busca no banco mesmo assim', async () => {
    redisGetShouldThrow = true;
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(snapshot?.tenantId).toBe('tenant-1');
    expect(findUniqueCallCount).toBe(1);
  });

  it('JSON corrompido no cache → trata como miss, busca no banco', async () => {
    redisStore.set('tenant:5511999999999@s.whatsapp.net', '{not valid json');
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(snapshot?.tenantId).toBe('tenant-1');
    expect(findUniqueCallCount).toBe(1);
  });

  it('redis.set falha ao gravar → ainda retorna o snapshot recém-montado', async () => {
    redisSetShouldThrow = true;
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    expect(snapshot?.tenantId).toBe('tenant-1');
  });
});

describe('renderTenantContext', () => {
  it('inclui fatos essenciais do imóvel e contrato', async () => {
    const snapshot = await buildTenantSnapshot('5511999999999@s.whatsapp.net');
    if (!snapshot) throw new Error('snapshot nulo');
    const text = renderTenantContext(snapshot);
    expect(text).toContain('Maria Silva');
    expect(text).toContain('Kitnet no Retiro');
    expect(text).toContain('900');
  });
});
