# Plan: Foundation Schema (Slice 0a)

> Spec: [specs/foundation-schema.md](../specs/foundation-schema.md)
> Objetivo: preparar schema para multi-tenancy futuro, externalIds atômicos, ActivityLog enriquecido e campos de notificação do Owner.
> Decisão R3/Option B: DELETE rows existentes do ActivityLog (ruído de dev).

---

## Ordem de execução

```
T01 → T02 → T03 → T04   (criar migrations, schema.prisma)
                    ↓
                   T05   (aplicar migrations no DB)
                    ↓
                   T06   (atualizar packages/types)
                    ↓
              T07 → T08  (bot: novo serviço + atualizar admin.ts)
                    ↓
                   T09   (typecheck + lint)
```

---

## T01 — Owner: campos de notificação (Migration M1)

**Descrição:** Adicionar `notificationPhone` e `notificationEmail` ao model `Owner` em schema.prisma. Criar migration M1 via `--create-only`. Nenhuma edição manual de SQL necessária (campos nullable, zero risco de backfill).

**Arquivos afetados:**
- `apps/bot/prisma/schema.prisma`
- `apps/bot/prisma/migrations/<timestamp>_owner_notification_fields/migration.sql` (gerado)

**Mudança em schema.prisma:**
```prisma
model Owner {
  id                String     @id @default(uuid())
  name              String
  phone             String     @unique
  email             String?    @unique
  notificationPhone String?
  notificationEmail String?
  properties        Property[]
  createdAt         DateTime   @default(now())
}
```

**Comando de criação:**
```bash
cd apps/bot && bunx prisma migrate dev --create-only --name owner_notification_fields
```

**Verificação:**
- [ ] Arquivo migration.sql gerado com `ALTER TABLE "Owner" ADD COLUMN "notificationPhone" TEXT` e `"notificationEmail" TEXT`
- [ ] Schema.prisma compila: `bunx prisma validate`

**Critério de pronto:** migration SQL criada e validada. NÃO aplicar ainda.

---

## T02 — ownerId em 11 tabelas (Migration M2)

**Descrição:** Adicionar `ownerId String` + relation `Owner` + `@@index([ownerId])` em 11 modelos. Criar migration M2 via `--create-only`. **Editar o SQL gerado** para fazer backfill seguro:
1. ADD COLUMN nullable
2. UPDATE backfill via `SELECT id FROM "Owner" LIMIT 1`
3. ALTER COLUMN SET NOT NULL
4. Adicionar FK constraint e index

**Arquivos afetados:**
- `apps/bot/prisma/schema.prisma`
- `apps/bot/prisma/migrations/<timestamp>_ownerid_columns/migration.sql` (gerado + editado)

**Tabelas com ownerId a adicionar:**
`Tenant`, `Lead`, `Payment`, `Contract`, `RuleSet`, `ContractTemplate`, `PropertyMedia`, `LeadDocument`, `ActivityLog`, `Conversation`, `Event`

**Padrão por model:**
```prisma
ownerId String
owner   Owner  @relation(fields: [ownerId], references: [id], onDelete: Restrict)

@@index([ownerId])
```

**Owner ganha as relações inversas** (ex: `tenants Tenant[]`, `leads Lead[]`, etc.).

**Padrão de SQL para cada tabela** (repetir × 11):
```sql
-- Exemplo para Tenant
ALTER TABLE "Tenant" ADD COLUMN "ownerId" TEXT;
UPDATE "Tenant" SET "ownerId" = (SELECT "id" FROM "Owner" LIMIT 1);
ALTER TABLE "Tenant" ALTER COLUMN "ownerId" SET NOT NULL;
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Tenant_ownerId_idx" ON "Tenant"("ownerId");
```

**Guard no início do SQL:**
```sql
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "Owner") = 0 THEN
    RAISE EXCEPTION 'Migration M2 requer pelo menos 1 Owner no banco.';
  END IF;
END $$;
```

**Comando de criação:**
```bash
cd apps/bot && bunx prisma migrate dev --create-only --name ownerid_columns
```

**Verificação:**
- [ ] SQL gerado tem ADD COLUMN para todas as 11 tabelas
- [ ] SQL editado com backfill + NOT NULL + FK + index para cada tabela
- [ ] Guard de Owner existe no início

**Critério de pronto:** migration SQL criada e editada. NÃO aplicar ainda.

---

## T03 — ActivityLog refactor (Migration M3)

**Descrição:** Refatorar `ActivityLog` no schema.prisma para o novo schema enriquecido. Criar migration M3 via `--create-only`. **Editar o SQL gerado** para:
1. DELETE todas as rows existentes (Option B — ruído de dev)
2. RENAME `actor` → `actorLabel`
3. Alterar colunas nullable → NOT NULL onde necessário
4. Adicionar novas colunas (`actorType`, `actorId`, `metadata`)
5. Adicionar índices compostos

> **Nota:** `ownerId` já adicionado em M2. M3 apenas adiciona o índice composto `[ownerId, createdAt]` e os demais campos.

**Arquivos afetados:**
- `apps/bot/prisma/schema.prisma`
- `apps/bot/prisma/migrations/<timestamp>_activitylog_refactor/migration.sql` (gerado + editado)

**Novo model ActivityLog em schema.prisma:**
```prisma
model ActivityLog {
  id          String   @id @default(uuid())
  ownerId     String
  owner       Owner    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  actorType   String   // 'system' | 'bot' | 'user'
  actorId     String?
  actorLabel  String
  action      String
  subjectType String
  subjectId   String
  subject     String?
  metadata    Json     @default("{}")
  createdAt   DateTime @default(now())

  @@index([ownerId, createdAt(sort: Desc)])
  @@index([subjectType, subjectId])
}
```

**SQL editado:**
```sql
-- Option B: deletar ruído de dev
DELETE FROM "ActivityLog";

-- Rename actor → actorLabel
ALTER TABLE "ActivityLog" RENAME COLUMN "actor" TO "actorLabel";

-- actorLabel: nullable → NOT NULL
UPDATE "ActivityLog" SET "actorLabel" = 'Sistema' WHERE "actorLabel" IS NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "actorLabel" SET NOT NULL;

-- Adicionar actorType NOT NULL
ALTER TABLE "ActivityLog" ADD COLUMN "actorType" TEXT NOT NULL DEFAULT 'system';
ALTER TABLE "ActivityLog" ALTER COLUMN "actorType" DROP DEFAULT;

-- Adicionar actorId nullable
ALTER TABLE "ActivityLog" ADD COLUMN "actorId" TEXT;

-- subjectType/subjectId: nullable → NOT NULL
UPDATE "ActivityLog" SET "subjectType" = 'unknown' WHERE "subjectType" IS NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "subjectType" SET NOT NULL;
UPDATE "ActivityLog" SET "subjectId" = '' WHERE "subjectId" IS NULL;
ALTER TABLE "ActivityLog" ALTER COLUMN "subjectId" SET NOT NULL;

-- Adicionar metadata
ALTER TABLE "ActivityLog" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- Índices
CREATE INDEX "ActivityLog_ownerId_createdAt_idx" ON "ActivityLog"("ownerId", "createdAt" DESC);
CREATE INDEX "ActivityLog_subjectType_subjectId_idx" ON "ActivityLog"("subjectType", "subjectId");
```

**Comando de criação:**
```bash
cd apps/bot && bunx prisma migrate dev --create-only --name activitylog_refactor
```

**Verificação:**
- [ ] SQL começa com `DELETE FROM "ActivityLog"`
- [ ] RENAME + todas as alterações de coluna presentes
- [ ] Índices compostos no final

**Critério de pronto:** migration SQL criada e editada. NÃO aplicar ainda.

---

## T04 — Sequences e Lead.externalId (Migration M4)

**Descrição:** Adicionar `Lead.externalId` ao schema.prisma. Criar migration M4 via `--create-only`. **Editar o SQL gerado** para criar 4 PostgreSQL sequences, inicializar via `setval()` com base nos MAX atuais, e fazer backfill de `Lead.externalId` e de `Tenant.externalId` NULL.

**Arquivos afetados:**
- `apps/bot/prisma/schema.prisma`
- `apps/bot/prisma/migrations/<timestamp>_sequences_and_lead_externalid/migration.sql` (gerado + editado)

**Mudança em schema.prisma:**
```prisma
model Lead {
  // campos existentes
  externalId String? @unique  // LD-XXXX
  // ...
}
```

**SQL editado (adicionar ANTES do Prisma-generated ALTER):**
```sql
-- 1. Adicionar coluna externalId em Lead (nullable)
ALTER TABLE "Lead" ADD COLUMN "externalId" TEXT UNIQUE;

-- 2. Criar sequences
CREATE SEQUENCE IF NOT EXISTS property_external_seq START 1;
CREATE SEQUENCE IF NOT EXISTS tenant_external_seq START 1;
CREATE SEQUENCE IF NOT EXISTS lead_external_seq START 1;
CREATE SEQUENCE IF NOT EXISTS contract_external_seq START 1;

-- 3. Alinhar sequences com MAX atual
SELECT setval('property_external_seq', COALESCE(
  (SELECT MAX(CAST(SUBSTRING("externalId" FROM 'IM-(\d+)') AS INTEGER)) FROM "Property"),
  0
));

SELECT setval('tenant_external_seq', COALESCE(
  (SELECT MAX(CAST(SUBSTRING("externalId" FROM 'IQ-(\d+)') AS INTEGER))
   FROM "Tenant" WHERE "externalId" IS NOT NULL),
  0
));

-- lead_external_seq começa em 0 (Lead não tem externalId ainda)
-- contract_external_seq alinha com max code
SELECT setval('contract_external_seq', COALESCE(
  (SELECT MAX(CAST(SUBSTRING("code" FROM 'CT-\d{4}-(\d+)') AS INTEGER))
   FROM "Contract"),
  0
));

-- 4. Backfill Lead.externalId (ROW_NUMBER por createdAt)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt") AS rn FROM "Lead"
)
UPDATE "Lead"
SET "externalId" = 'LD-' || LPAD(ranked.rn::text, 4, '0')
FROM ranked
WHERE "Lead".id = ranked.id;

-- Avançar sequence para depois do backfill
SELECT setval('lead_external_seq', (SELECT COUNT(*) FROM "Lead"));

-- 5. Backfill Tenant.externalId onde NULL
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt") AS rn
  FROM "Tenant"
  WHERE "externalId" IS NULL
)
UPDATE "Tenant"
SET "externalId" = 'IQ-' || LPAD(ranked.rn::text, 3, '0')
FROM ranked
WHERE "Tenant".id = ranked.id;
```

**Comando de criação:**
```bash
cd apps/bot && bunx prisma migrate dev --create-only --name sequences_and_lead_externalid
```

**Verificação:**
- [ ] `Lead.externalId String? @unique` no schema.prisma
- [ ] SQL tem CREATE SEQUENCE × 4 + setval × 4 + backfill Lead + backfill Tenant

**Critério de pronto:** migration SQL criada e editada. NÃO aplicar ainda.

---

## T05 — Aplicar todas as migrations

**Descrição:** Aplicar M1–M4 sequencialmente contra o banco Supabase. Verificar estado pós-migration.

**Pré-condição:** Pelo menos 1 Owner existe no banco. Tráfego de escrita pausado (dev).

**Comando:**
```bash
cd apps/bot && bunx prisma migrate dev
```

**Verificações pós-apply:**
```bash
# Verificar sequences existem
cd apps/bot && bunx prisma db execute --stdin <<'SQL'
SELECT sequencename FROM pg_sequences
WHERE sequencename IN (
  'property_external_seq','tenant_external_seq',
  'lead_external_seq','contract_external_seq'
);
SQL

# Verificar ownerId em Lead (amostra)
cd apps/bot && bunx prisma db execute --stdin <<'SQL'
SELECT "ownerId" IS NOT NULL as has_owner_id, COUNT(*) FROM "Lead" GROUP BY 1;
SQL

# Verificar ActivityLog schema novo
cd apps/bot && bunx prisma db execute --stdin <<'SQL'
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ActivityLog'
ORDER BY ordinal_position;
SQL
```

**Verificação:**
- [ ] `prisma migrate dev` termina sem erro
- [ ] 4 sequences existem no banco
- [ ] `Lead.ownerId NOT NULL` verificado
- [ ] `ActivityLog` tem colunas `actorType`, `actorLabel`, `metadata`

**Critério de pronto:** DB atualizado, zero erros de migration.

---

## T06 — Atualizar `packages/types`

**Descrição:** Atualizar todos os tipos TypeScript para refletir o novo schema. Adicionar `ownerId: string` em todos os modelos afetados. Reescrever `ActivityLog`. Adicionar tipos de `ActivityLogActorType` e `ActivityLogSubjectType`.

**Arquivos afetados:**
- `packages/types/src/index.ts` (adicionar exports)
- `packages/types/src/lead.ts` (adicionar `externalId?`, `ownerId`)
- `packages/types/src/tenant.ts` (adicionar `ownerId`)
- `packages/types/src/contract.ts` (adicionar `ownerId`)
- `packages/types/src/contract-template.ts` (adicionar `ownerId`)
- `packages/types/src/rule-set.ts` (adicionar `ownerId`)
- `packages/types/src/property.ts` (verificar — `ownerId` já existe)
- `packages/types/src/activity-log.ts` (CRIAR — não existe ainda)
- `packages/types/src/owner.ts` (CRIAR — não existe ainda)

**Tipos a criar em `activity-log.ts`:**
```ts
export type ActivityLogActorType = 'system' | 'bot' | 'user'

export type ActivityLogSubjectType =
  | 'lead' | 'tenant' | 'property' | 'contract'
  | 'payment' | 'template' | 'rule_set' | 'owner'

export type ActivityLog = {
  id: string
  ownerId: string
  actorType: ActivityLogActorType
  actorId: string | null
  actorLabel: string
  action: string
  subjectType: ActivityLogSubjectType
  subjectId: string
  subject: string | null
  metadata: Record<string, unknown>
  createdAt: string
}
```

**Tipos a criar em `owner.ts`:**
```ts
export type Owner = {
  id: string
  name: string
  phone: string
  email: string | null
  notificationPhone: string | null
  notificationEmail: string | null
  createdAt: string
}
```

**Verificação:**
```bash
cd packages/types && bunx tsc --noEmit
cd apps/web && bunx tsc --noEmit
cd apps/bot && bunx tsc --noEmit
```

**Critério de pronto:** TypeCheck verde nos 3 pacotes. Todos os tipos refletem schema novo.

---

## T07 — Criar `apps/bot/src/services/external-id.ts`

**Descrição:** Novo serviço para geração de externalIds usando `nextval()` via Prisma `$queryRawUnsafe`. Elimina a race condition do `count + 1` atual.

**Arquivos afetados:**
- `apps/bot/src/services/external-id.ts` (CRIAR)

**Implementação:**
```ts
import { prisma } from '../db/client'

type Entity = 'property' | 'tenant' | 'lead' | 'contract'

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
}

export async function nextExternalId(entity: Entity): Promise<string> {
  const { seq, format } = seqConfig[entity]
  const rows = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(
    `SELECT nextval('${seq}')`,
  )
  return format(Number(rows[0].nextval))
}
```

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/services/external-id.ts
```

**Critério de pronto:** arquivo criado, TypeCheck verde, sem lint warnings.

---

## T08 — Atualizar `apps/bot/src/routes/admin.ts`

**Descrição:** Substituir todos os usos de `count + 1` por `nextExternalId()`. Adicionar geração de `externalId` para Lead (que não tinha). Verificar que `ownerId` está presente em todos os inserts relevantes.

**Arquivo afetado:**
- `apps/bot/src/routes/admin.ts`

**Mudanças:**

1. Importar `nextExternalId`:
```ts
import { nextExternalId } from '../services/external-id'
```

2. Property create (linha ~213): substituir
```ts
// antes
const count = await prisma.property.count()
externalId = `IM-${String(count + 1).padStart(4, '0')}`

// depois
externalId = await nextExternalId('property')
```

3. Tenant create (linha ~299): substituir
```ts
// antes
const count = await prisma.tenant.count()
const externalId = `IQ-${String(count + 1).padStart(3, '0')}`

// depois
const externalId = await nextExternalId('tenant')
```

4. Contract create (linha ~611): substituir
```ts
// antes
const count = await tx.contract.count()
const code = `CT-${year}-${String(count + 1).padStart(4, '0')}`

// depois
const code = await nextExternalId('contract')
```

5. Lead create — adicionar externalId onde Lead é criado pelo bot (procurar `prisma.lead.create`):
```ts
externalId: await nextExternalId('lead'),
```

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/routes/admin.ts
```

**Critério de pronto:** zero usos de `count + 1` para externalId. TypeCheck + lint verde.

---

## T09 — TypeCheck + lint final (ambos os apps)

**Descrição:** Verificação final de consistência antes de marcar a slice como pronta.

```bash
# Bot
cd apps/bot
bunx tsc --noEmit
bunx oxlint src/

# Web
cd apps/web
bunx tsc --noEmit
bunx oxlint src/
```

**Verificação:**
- [ ] `tsc --noEmit` verde em apps/bot
- [ ] `tsc --noEmit` verde em apps/web
- [ ] `oxlint` sem warnings novos em ambos
- [ ] `bun run dev` sobe sem erro no bot
- [ ] `bun run dev` sobe sem erro no web

**Critério de pronto:** zero erros, zero warnings novos. Slice 0a completa.

---

## Resumo de arquivos afetados

| Arquivo | Tasks |
|---|---|
| `apps/bot/prisma/schema.prisma` | T01, T02, T03, T04 |
| `apps/bot/prisma/migrations/*_owner_notification_fields/migration.sql` | T01 |
| `apps/bot/prisma/migrations/*_ownerid_columns/migration.sql` | T02 |
| `apps/bot/prisma/migrations/*_activitylog_refactor/migration.sql` | T03 |
| `apps/bot/prisma/migrations/*_sequences_and_lead_externalid/migration.sql` | T04 |
| `apps/bot/src/services/external-id.ts` | T07 (novo) |
| `apps/bot/src/routes/admin.ts` | T08 |
| `packages/types/src/activity-log.ts` | T06 (novo) |
| `packages/types/src/owner.ts` | T06 (novo) |
| `packages/types/src/lead.ts` | T06 |
| `packages/types/src/tenant.ts` | T06 |
| `packages/types/src/contract.ts` | T06 |
| `packages/types/src/contract-template.ts` | T06 |
| `packages/types/src/rule-set.ts` | T06 |
| `packages/types/src/index.ts` | T06 |

---

## Riscos ativos nesta fase

| Risk | Impacto | Mitigação |
|---|---|---|
| R2: 0 owners no banco | M2 falha | Guard SQL no início de M2 |
| R4: writes durante migration | Sequence drift | Rodar com bot parado |
| R5: Prisma não modela sequences | SQL manual | `--create-only` + edit manual |
