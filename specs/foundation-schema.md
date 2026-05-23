# Spec: Foundation Schema (Slice 0a)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 0 (F0.5 ownerId + F0.6 sequences + parte de F0.2 ActivityLog refator + parte de F0.4 Owner notification fields).
> Decisões: [BRAINSTORM.md](../BRAINSTORM.md) §4 B8, B9, B12, B14.
> Workflow: [workflow.md](../workflow.md).

---

## 1. Objetivo

Preparar schema do banco para suportar todas as próximas slices: multi-tenancy futuro, identificadores legíveis, audit log enriquecido e canais de notificação do owner.

Slice puramente de banco — zero mudanças visíveis em UI ou bot logic. Habilita slices 0b, 1, 2, etc.

---

## 2. Escopo

### Dentro
- Migration: adicionar `ownerId uuid NOT NULL` em 11 tabelas
- Migration: criar 4 PostgreSQL sequences (property, tenant, lead, contract)
- Migration: refatorar `ActivityLog` schema (`actorType`, `actorId`, `actorLabel`, `ownerId`, `metadata jsonb`, índices)
- Migration: adicionar `Owner.notificationPhone` e `Owner.notificationEmail` (nullable)
- Atualizar `apps/bot/prisma/schema.prisma`
- Atualizar tipos em `packages/types`
- Backfill de dados existentes (rows com `ownerId` populado, sequences alinhadas com max atual)
- Substituir geração manual de `externalId` em `apps/bot/src/routes/admin.ts` por `nextval()`

### Fora (deixa pra próximas slices)
- Helper `logActivity()` (Slice 0b)
- Helper `notifyOwner()` (Slice 0b)
- Resend integration (Slice 0b)
- RLS policies (Slice 0b — docs only)
- `Conversation.botPaused` (Slice 1 — feature de pausa bot)
- UI changes (qualquer slice de feature)
- Endpoints novos (próximas slices)

---

## 3. Estado atual (descoberto na análise)

### Já existe no schema
- `Property.ownerId` ✓ (FK pra Owner)
- `Property.externalId` ✓ (unique, gerado por `count+1` — race-prone)
- `Property.area Float?` ✓
- `Lead.name`, `Lead.source`, `Lead.propertyId` ✓
- `Payment.description`, `Payment.type` ✓
- `Tenant.externalId String?` ✓ (nullable, gerado por `count+1`)
- `ActivityLog` table ✓ (mas schema simples: `actor String?`, sem ownerId nem metadata)

### Falta
- `ownerId` em: Tenant, Lead, Payment, Contract, RuleSet, ContractTemplate, PropertyMedia, LeadDocument, ActivityLog, Conversation, Event
- Sequences PostgreSQL: nenhuma criada (geração atual é race-prone)
- `ActivityLog`: enrichment (actorType, actorId, actorLabel, ownerId, metadata)
- `Owner.notificationPhone`, `Owner.notificationEmail`

---

## 4. Schema changes (Prisma)

### 4.1 — Owner: adicionar campos de notificação

```prisma
model Owner {
  id                String     @id @default(uuid())
  name              String
  phone             String     @unique
  email             String?    @unique
  notificationPhone String?    // fallback: phone
  notificationEmail String?    // fallback: email
  properties        Property[]
  // ... outras relações adicionadas pelas FKs ownerId abaixo
  createdAt         DateTime   @default(now())
}
```

### 4.2 — ownerId em 11 tabelas

Padrão repetido em cada tabela:
```prisma
ownerId String
owner   Owner  @relation(fields: [ownerId], references: [id], onDelete: Restrict)

@@index([ownerId])
```

Tabelas: `Tenant`, `Lead`, `Payment`, `Contract`, `RuleSet`, `ContractTemplate`, `PropertyMedia`, `LeadDocument`, `ActivityLog`, `Conversation`, `Event`.

Owner ganha o lado inverso das relações.

### 4.3 — ActivityLog refator

```prisma
model ActivityLog {
  id          String   @id @default(uuid())
  ownerId     String
  owner       Owner    @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  actorType   String   // 'system' | 'bot' | 'user'
  actorId     String?  // FK lógica (não enforced) — Owner.id quando actorType='user'
  actorLabel  String   // 'Sistema' | 'Bot' | nome do user
  action      String   // snake_case: 'lead_created', 'kyc_approved', etc
  subjectType String   // 'lead' | 'tenant' | 'property' | 'contract' | 'payment' | 'template' | 'rule_set' | 'owner'
  subjectId   String   // uuid do subject
  subject     String?  // label legível ('Daniela Reis', 'IM-0421')
  metadata    Json     @default("{}")
  createdAt   DateTime @default(now())

  @@index([ownerId, createdAt(sort: Desc)])
  @@index([subjectType, subjectId])
}
```

**Breaking change:** schema antigo tinha `actor String?` (texto livre). Migration faz backfill — rows existentes ganham `actorType='system'`, `actorLabel=actor ?? 'Sistema'`, `ownerId = (SELECT id FROM "Owner" LIMIT 1)`.

### 4.4 — PostgreSQL sequences

Migration SQL puro (Prisma não modela sequences nativo):

```sql
-- Properties
CREATE SEQUENCE IF NOT EXISTS property_external_seq START 1;
-- Backfill: alinhar sequence com max atual
SELECT setval('property_external_seq', COALESCE(
  (SELECT MAX(CAST(SUBSTRING("externalId" FROM 'IM-(\d+)') AS INTEGER)) FROM "Property"),
  0
));

-- Tenants
CREATE SEQUENCE IF NOT EXISTS tenant_external_seq START 1;
SELECT setval('tenant_external_seq', COALESCE(
  (SELECT MAX(CAST(SUBSTRING("externalId" FROM 'IQ-(\d+)') AS INTEGER)) FROM "Tenant" WHERE "externalId" IS NOT NULL),
  0
));

-- Leads (não tem externalId ainda — sequence começa em 1)
CREATE SEQUENCE IF NOT EXISTS lead_external_seq START 1;

-- Contracts (já existe code = CT-YYYY-XXXX; sequence só pro sufixo XXXX por ano)
-- Decisão: sequence única, reseta a cada ano via lógica do bot, OU sequence por ano
-- MVP: sequence única simples; lógica `CT-{year}-{seq}` no bot
CREATE SEQUENCE IF NOT EXISTS contract_external_seq START 1;
SELECT setval('contract_external_seq', COALESCE(
  (SELECT MAX(CAST(SUBSTRING("code" FROM 'CT-\d{4}-(\d+)') AS INTEGER)) FROM "Contract"),
  0
));
```

### 4.5 — Lead: adicionar externalId

```prisma
model Lead {
  // ... campos existentes
  externalId String? @unique  // LD-XXXX, populado via sequence
  // ...
}
```

Nullable inicialmente (rows existentes recebem via backfill no script).

---

## 5. Migration plan

Devido a constraints do Prisma (uma migration por mudança coerente) e necessidade de backfill em ordem específica, dividimos em 4 migrations sequenciais:

### Migration M1: `owner_notification_fields`
- ALTER Owner ADD notificationPhone, notificationEmail (ambos nullable)
- Risk: nenhum. Campos nullable, sem default.

### Migration M2: `ownerid_columns`
- ALTER em 11 tabelas: ADD COLUMN ownerId uuid NULL inicialmente
- Backfill via SQL: UPDATE `<table>` SET ownerId = (SELECT id FROM "Owner" LIMIT 1)
- ALTER em 11 tabelas: ALTER COLUMN ownerId SET NOT NULL
- ADD FK constraint para Owner em cada
- ADD INDEX em cada
- Risk: se houver 0 owners, falha. Mitigação: garantir Owner existe antes (assert no script).

### Migration M3: `activitylog_refactor`
- ALTER ActivityLog: RENAME actor → actorLabel (preserva dados)
- ADD COLUMN actorType TEXT DEFAULT 'system'
- ADD COLUMN actorId TEXT NULL
- ALTER actorType DROP DEFAULT, SET NOT NULL
- ALTER actorLabel SET NOT NULL (preencher NULL com 'Sistema' antes)
- ALTER subjectType SET NOT NULL (preencher NULL com 'unknown' antes — checar se há rows)
- ALTER subjectId SET NOT NULL (preencher NULL com '' antes — checar se há rows)
- ADD COLUMN metadata JSONB DEFAULT '{}' NOT NULL
- ADD INDEXES
- Risk: rows antigos sem subjectId/subjectType viram inconsistentes. Mitigação: deletar rows pré-existentes do ActivityLog se forem ruído de dev (verificar com user).

### Migration M4: `sequences_and_lead_externalid`
- ALTER Lead ADD COLUMN externalId TEXT UNIQUE NULL
- CREATE SEQUENCE × 4 (property, tenant, lead, contract)
- setval em cada baseado no MAX atual
- Backfill Lead.externalId via UPDATE com ROW_NUMBER OVER (ORDER BY createdAt)
- Backfill Tenant.externalId onde NULL
- Risk: race condition se outras escritas acontecerem durante a migration. Mitigação: rodar com tráfego pausado (manual).

---

## 6. Tipos compartilhados (`packages/types`)

### Atualizar
- `Owner` (adicionar notificationPhone, notificationEmail)
- `ActivityLog` (rewrite completo)
- `Lead` (adicionar externalId)
- Todos os modelos afetados ganham `ownerId: string`

### Criar
- `ActivityLogActorType` enum-like: `'system' | 'bot' | 'user'`
- `ActivityLogSubjectType` enum-like: `'lead' | 'tenant' | 'property' | 'contract' | 'payment' | 'template' | 'rule_set' | 'owner'`

---

## 7. Bot changes

### `apps/bot/src/routes/admin.ts`
- Substituir `count + 1` por `nextval()` no create de Property e Tenant
- Adicionar geração de `externalId` no create de Lead (LD-XXXX)
- Adicionar geração de `code` (CT-YYYY-XXXX) no create de Contract
- Em **todos os inserts** do bot, popular `ownerId` (vem do `owner.id` que já está no escopo)

### `apps/bot/src/db/client.ts`
- Sem mudanças. Prisma client regenerado automaticamente.

### Utility novo: `apps/bot/src/services/external-id.ts`
```ts
export async function nextExternalId(entity: 'property' | 'tenant' | 'lead' | 'contract'): Promise<string> {
  const seqMap = {
    property: { seq: 'property_external_seq', format: (n: number) => `IM-${String(n).padStart(4, '0')}` },
    tenant: { seq: 'tenant_external_seq', format: (n: number) => `IQ-${String(n).padStart(3, '0')}` },
    lead: { seq: 'lead_external_seq', format: (n: number) => `LD-${String(n).padStart(4, '0')}` },
    contract: { seq: 'contract_external_seq', format: (n: number) => `CT-${new Date().getFullYear()}-${String(n).padStart(4, '0')}` },
  };
  const { seq, format } = seqMap[entity];
  const result = await prisma.$queryRawUnsafe<{ nextval: bigint }[]>(`SELECT nextval('${seq}')`);
  return format(Number(result[0].nextval));
}
```

---

## 8. Web changes

Mínimas — apenas reflexão dos tipos atualizados:
- `apps/web/src/lib/queries.ts` — queries que selecionam `*` automaticamente pegam novos campos. Queries com select explícito (ex: `fetchContracts`) precisam revalidar.
- Verificar que TanStack Query não quebra com novas colunas.
- Nenhuma mudança de UI nessa slice.

---

## 9. Activity log keys

Não escrevemos logs nessa slice (helper vem na 0b). Apenas estabelecemos convenção:

### Convenção `action`
Verbo no passado + objeto, snake_case:
- `lead_created`, `lead_stage_changed`, `lead_source_corrected`
- `kyc_approved`, `kyc_rejected`
- `contract_created`, `contract_signed`, `contract_cancelled`
- `payment_recorded`, `payment_confirmed`, `payment_marked_overdue`
- `property_created`, `property_published`, `property_archived`
- `tenant_created`, `tenant_status_changed`
- `template_created`, `template_published`, `template_unpublished`
- `rule_set_created`, `rule_set_linked`, `rule_set_unlinked`
- `bot_paused`, `bot_resumed`
- `owner_updated`

### Convenção `subjectType`
Singular, snake_case: `lead | tenant | property | contract | payment | template | rule_set | owner`.

### Convenção `actorType`
- `'system'` — automação (cron, trigger, retry)
- `'bot'` — webhook do bot WhatsApp
- `'user'` — Owner logado no admin (futuro multi-user: outros members)

---

## 10. Notificações

Nenhuma nessa slice. Slice 0b implementa `notifyOwner()`.

---

## 11. Critérios de aceite

- [ ] `prisma migrate dev` aplica todas as 4 migrations sem erro
- [ ] `prisma migrate deploy` em ambiente staging não corrompe dados
- [ ] Todas as 12 tabelas (Property + 11 outras) têm `ownerId NOT NULL` + index
- [ ] `Owner` tem `notificationPhone` e `notificationEmail` (nullable)
- [ ] `ActivityLog` tem schema novo (`actorType`, `actorId`, `actorLabel`, `metadata`, indexes)
- [ ] 4 sequences existem: `property_external_seq`, `tenant_external_seq`, `lead_external_seq`, `contract_external_seq`
- [ ] Sequences inicializadas com `setval()` correto (não geram duplicados)
- [ ] `Lead.externalId` populado em todos os rows existentes (`LD-XXXX`)
- [ ] `Tenant.externalId` populado em todos os rows existentes
- [ ] `apps/bot/src/services/external-id.ts` criado e exportado
- [ ] `apps/bot/src/routes/admin.ts` usa `nextExternalId()` em vez de `count+1`
- [ ] Bot popula `ownerId` em todos os inserts
- [ ] `packages/types` reflete novo schema
- [ ] `bunx tsc --noEmit` verde em ambos apps
- [ ] `bunx oxlint` verde em ambos apps
- [ ] Bot inicia sem erros (`bun run dev`)
- [ ] Web inicia sem erros (`bun run dev`)
- [ ] Smoke: criar 1 property + 1 lead + 1 tenant via API — verificar externalId gerado corretamente

---

## 12. Riscos / edge cases

### R1 — Migration falha no meio
Migrations 2–4 fazem múltiplos ALTER. Se falhar no meio, banco fica inconsistente.
**Mitigação:** Cada migration é uma transação Prisma (DDL transacional no Postgres). Falha → rollback automático.

### R2 — Owner único pré-condição
`ownerId` NOT NULL exige que pelo menos 1 Owner exista antes do backfill. Se banco tiver 0 owners, M2 falha.
**Mitigação:** Migration M2 começa com `INSERT INTO "Owner" (id, name, phone) VALUES (gen_random_uuid(), 'Default', 'unknown') ON CONFLICT DO NOTHING` se contagem = 0. Ou script SQL prévio garante 1 Owner.

### R3 — ActivityLog dados antigos sem subjectId/subjectType
Schema antigo permite NULL nesses. Schema novo exige NOT NULL.
**Mitigação:** Migration M3 preenche NULLs com `'unknown'`/`'00000000-0000-0000-0000-000000000000'` antes do ALTER NOT NULL. Alternativa (preferida pra projeto novo): DELETE rows pré-existentes da ActivityLog (são ruído de dev — confirmar com user).

### R4 — Sequence drift se houver writes durante migration
Backfill calcula MAX e seta sequence. Se write ocorre entre cálculo e set, sequence pode colidir.
**Mitigação:** rodar migration com tráfego pausado (manual, MVP). Em produção real, usar `LOCK TABLE` + transação.

### R5 — Prisma + sequences (não nativo)
Prisma não modela `CREATE SEQUENCE` em `schema.prisma`. Usa migration raw SQL.
**Mitigação:** Migrations escritas como `.sql` puro via `prisma migrate dev --create-only` + edit manual. Acesso via `$queryRawUnsafe`.

### R6 — Race condition residual em external-id.ts
`nextval()` é atômico no Postgres, mas se o app crash entre `nextval()` e INSERT, número é "perdido" (gap). Aceito como trade-off — gaps não quebram nada, só "desperdiçam" números.

### R7 — Backward compatibility de queries com `select *`
Queries supabase-js que usam `select('*')` recebem novos campos automaticamente. Code que tipa estritamente em `packages/types` precisa de update concomitante.
**Mitigação:** atualizar types **na mesma slice**. CI bloqueia merge se types ficam dessincronizados.

### R8 — Index em ownerId pode demorar em DB grande
Banco hoje é pequeno (<1k rows). Index é instantâneo.
**Mitigação:** N/A no MVP. Se ficar grande, usar `CREATE INDEX CONCURRENTLY` em produção.

---

## 13. Dependências / pré-condições

- Banco Supabase acessível com `DIRECT_URL` setado (Prisma migrate)
- Pelo menos 1 Owner no banco (ou migration cria default)
- Sem tráfego de escrita durante a migration (recomendado)

---

## 14. Out of scope (explícito)

- Ativar RLS (Slice 0b documenta policies, Fase 2 ativa)
- Criar helpers `logActivity()`, `notifyOwner()` (Slice 0b)
- Integrar Resend (Slice 0b)
- `Conversation.botPaused` (Slice 1)
- Qualquer UI change (slices de feature)
- Validação de CPF, OCR retry, Whisper áudio (fora do MVP)
