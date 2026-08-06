import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/db/client';
import { redis } from '@/db/redis';
import { logger } from '@/lib/logger';

const CACHE_TTL_SECONDS = 1800; // 30 min — design §3.1

// process.cwd() is always the `apps/bot` directory — both in local dev
// (`cd apps/bot && bun run dev` / `bun test src`) and in the Docker image
// (WORKDIR ends at /app/apps/bot). Two levels up reaches the repo root
// locally, and the Dockerfile mirrors that by copying this one file to
// /app/docs/ — see apps/bot/Dockerfile.
const MAINTENANCE_LAW_SUMMARY_PATH = join(process.cwd(), '..', '..', 'docs', 'lei-inquilinato-resumo.md');

let cachedMaintenanceLawSummary: string | null = null;

function getMaintenanceLawSummary(): string {
  if (cachedMaintenanceLawSummary !== null) return cachedMaintenanceLawSummary;
  try {
    // Only a successful read is cached — a transient failure (e.g. the file
    // not yet mounted at cold start) must not become permanent for the rest
    // of the process's life; leaving the cache at null lets the next call
    // retry instead of being stuck on '' forever.
    cachedMaintenanceLawSummary = readFileSync(MAINTENANCE_LAW_SUMMARY_PATH, 'utf-8');
  } catch (err) {
    logger.error({ err }, '[tenant.context] Falha ao ler lei-inquilinato-resumo.md — seguindo sem o resumo');
    return '';
  }
  return cachedMaintenanceLawSummary;
}

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

  // Cache is best-effort: a Redis outage or corrupted JSON must fall through
  // to Prisma, never take down the whole reply (design §7 rule 8 — snapshot
  // "corrompido" is explicitly called out, not just "ausente").
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as TenantSnapshot;
    }
  } catch (err) {
    logger.error({ err, phone }, '[tenant.context] Cache read falhou — buscando no banco');
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

  try {
    await redis.set(key, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    logger.error({ err, phone }, '[tenant.context] Cache write falhou — segue sem cache');
  }
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
  const lawSummary = getMaintenanceLawSummary();
  if (lawSummary) {
    lines.push('---', lawSummary);
  }
  return lines.join('\n');
}
