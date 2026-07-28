import { prisma } from '@/db/client';
import { redis } from '@/db/redis';

const CACHE_TTL_SECONDS = 1800; // 30 min — design §3.1

export interface TenantSnapshot {
  tenantId: string;
  name: string | null;
  property: { id: string; externalId: string; name: string; address: string; rent: number };
  owner: { id: string; name: string; phone: string };
  contractStart: string;
  contractEnd: string | null;
  recentPayments: Array<{ month: string; amount: number; status: string }>;
}

function cacheKey(phone: string): string {
  return `tenant:${phone}`;
}

export async function invalidateTenantSnapshotCache(phone: string): Promise<void> {
  await redis.del(cacheKey(phone));
}

export async function buildTenantSnapshot(phone: string): Promise<TenantSnapshot | null> {
  const key = cacheKey(phone);
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as TenantSnapshot;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { phone },
    include: {
      property: { select: { id: true, externalId: true, name: true, address: true, rent: true } },
      owner: { select: { id: true, name: true, phone: true } },
      payments: {
        select: { month: true, amount: true, status: true },
        orderBy: { month: 'desc' },
        take: 3,
      },
    },
  });
  if (!tenant) return null;

  const snapshot: TenantSnapshot = {
    tenantId: tenant.id,
    name: tenant.name,
    property: {
      id: tenant.property.id,
      externalId: tenant.property.externalId,
      name: tenant.property.name,
      address: tenant.property.address,
      rent: Number(tenant.property.rent),
    },
    owner: { id: tenant.owner.id, name: tenant.owner.name, phone: tenant.owner.phone },
    contractStart: tenant.contractStart.toISOString(),
    contractEnd: tenant.contractEnd ? tenant.contractEnd.toISOString() : null,
    recentPayments: tenant.payments.map((p) => ({
      month: p.month,
      amount: Number(p.amount),
      status: p.status,
    })),
  };

  await redis.set(key, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
  return snapshot;
}

export function renderTenantContext(snapshot: TenantSnapshot): string {
  const lines = [
    `Inquilino: ${snapshot.name ?? 'não informado'}`,
    `Imóvel: ${snapshot.property.name} (${snapshot.property.externalId}) — ${snapshot.property.address}`,
    `Aluguel: R$ ${snapshot.property.rent.toLocaleString('pt-BR')}`,
    `Proprietário: ${snapshot.owner.name}`,
    `Contrato: início ${snapshot.contractStart.slice(0, 10)}${
      snapshot.contractEnd ? `, fim ${snapshot.contractEnd.slice(0, 10)}` : ', sem data de fim'
    }`,
  ];
  if (snapshot.recentPayments.length > 0) {
    lines.push(
      'Últimos pagamentos: ' +
        snapshot.recentPayments
          .map((p) => `${p.month} R$ ${p.amount.toLocaleString('pt-BR')} (${p.status})`)
          .join('; '),
    );
  }
  return lines.join('\n');
}
