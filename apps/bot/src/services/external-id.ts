import { prisma } from '../db/client';

type Entity = 'property' | 'tenant' | 'lead' | 'contract';

const seqConfig: Record<Entity, { seq: string; format: (n: number) => string }> = {
  property: {
    seq: 'property_external_seq',
    format: (n) => `IM-${String(n).padStart(4, '0')}`,
  },
  tenant: {
    seq: 'tenant_external_seq',
    format: (n) => `IQ-${String(n).padStart(3, '0')}`,
  },
  lead: {
    seq: 'lead_external_seq',
    format: (n) => `LD-${String(n).padStart(4, '0')}`,
  },
  contract: {
    seq: 'contract_external_seq',
    format: (n) => `CT-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`,
  },
};

export async function nextExternalId(entity: Entity): Promise<string> {
  const { seq, format } = seqConfig[entity];
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${seq}')`,
  );
  return format(Number(rows[0].nextval));
}
