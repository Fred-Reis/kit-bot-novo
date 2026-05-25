# Spec: Slice 3 — Tenants (lista + detalhe completos)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 3.
> Depende de: Slice 0a (schema + sequences), Slice 0b (helpers), Slice 1, Slice 2.
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Finalizar a página de inquilinos ponta-a-ponta: schema correto (`externalId NOT NULL`), detalhe do inquilino exibindo `externalId` e `propertyName` corretamente, e `tenant_created` emitido no log de atividade ao criar um inquilino.

**Usuário alvo:** proprietário logado no admin (apps/web).

**Sucesso:** owner vê o IQ-XXX do inquilino na tela de detalhe, o imóvel aparece pelo nome (não pelo UUID), e toda criação de inquilino fica registrada no activity log.

---

## 2. Escopo

### Dentro

**Schema & migration**
- `Tenant.externalId` de `String? @unique` para `String @unique @db.Text` (NOT NULL)
- Migration com backfill antes do ALTER: atribui `IQ-XXX` a qualquer row sem `externalId`
- Atualizar Prisma schema para refletir NOT NULL

**Bot (`apps/bot/src/routes/admin.ts`)**
- `POST /admin/tenants`: adicionar `logActivityHelper` após commit da transação
  - `action: 'tenant_created'`, `actorType: 'user'`, `subjectType: 'tenant'`
  - Fire-and-forget (`.catch(fastify.log.warn.bind(fastify.log))`)

**Web (`apps/web/src/routes/_dashboard/tenants/$tenantId.tsx`)**
- SpecBar: trocar `tenant.propertyId.slice(0, 6) + '…'` por `tenant.propertyName ?? '—'`
- Header do detalhe: adicionar `externalId` em `font-mono text-xs text-muted-foreground` abaixo do telefone (fallback: ocultar se null — transição segura pré-NOT NULL)

**ROADMAP**
- Marcar todos os itens da Slice 3 implementados como `[x]`

### Fora

- `fetchTenants()` — sem mudança (já correto: join Property(name), retorna propertyName, externalId)
- `fetchTenant()` — sem mudança (já correto: join Property(name), mapTenantRow)
- `index.tsx` — sem mudança (tabela + cards já corretos)
- `new.tsx` — sem mudança (wizard já funcional)
- `packages/types` — sem mudança (`Tenant` interface já completa com `externalId`, `propertyName`, `status`)
- `tenant-utils.ts` — sem mudança (`tenantStatus()` já correto para 2 estados: ok / attention)
- Status "Inadimplente" (3º estado) — fora do MVP
- Notificações (WhatsApp, email, in-app) — nenhum gatilho nesta slice
- Ações no detalhe do inquilino (ex: encerrar contrato) — fora desta slice
- RLS — fora desta slice (Fase 2)
- Filtros reais na lista — stub atual é suficiente

---

## 3. Schema changes

### Migration: `tenants_slice_externalid_not_null`

```sql
-- Passo 1: backfill rows sem externalId usando a sequência existente
UPDATE "Tenant"
SET "externalId" = 'IQ-' || LPAD(NEXTVAL('tenant_external_seq')::text, 3, '0')
WHERE "externalId" IS NULL;

-- Passo 2: tornar NOT NULL
ALTER TABLE "Tenant" ALTER COLUMN "externalId" SET NOT NULL;
```

**Sequência `tenant_external_seq`** já existe (criada na Foundation F0.6, migration 20260522000004). O backfill consome valores dessa sequência — sem colisão com inserts futuros.

**Sem risco de chave duplicada:** rows sem `externalId` existentes nunca receberam valor da sequência (o bot sempre insere via `nextExternalId('tenant')`). O backfill só afeta rows órfãos (se existirem).

Prisma schema (`apps/bot/prisma/schema.prisma`):

```prisma
model Tenant {
  id            String     @id @default(uuid())
  ownerId       String
  owner         Owner      @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  externalId    String     @unique  // ← era String? — agora NOT NULL
  phone         String     @unique
  propertyId    String
  property      Property   @relation(fields: [propertyId], references: [id])
  name          String?
  cpf           String?
  email         String?
  score         Int?
  dueDay        Int?
  onTimeRate    Float?
  contractStart DateTime
  contractEnd   DateTime?
  payments      Payment[]
  contracts     Contract[]
  createdAt     DateTime   @default(now())

  @@index([ownerId])
}
```

---

## 4. Tipos compartilhados (`packages/types`)

**Nenhuma mudança necessária.**

`Tenant` interface em `packages/types/src/tenant.ts` já tem:
- `externalId: string | null` — mantido como `string | null` no tipo TS (web usa `?? null` como fallback seguro durante transição)
- `propertyName: string | null`
- `status: 'ok' | 'attention' | null`

> Nota: o banco passa a ser NOT NULL, mas o tipo TS permanece `string | null` para compatibilidade com possíveis rows legados sem externalId retornados pela query (supabase-js retorna o tipo inferido do banco, mas o tipo local é suficientemente seguro).

---

## 5. Bot changes

### 5.1 — `routes/admin.ts`: adicionar `tenant_created` ao `POST /admin/tenants`

Após o `$transaction` e o `redis.del`:

```ts
await logActivityHelper({
  ownerId: owner.id,
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'Admin',
  action: 'tenant_created',
  subjectType: 'tenant',
  subjectId: tenant.id,
  subject: tenant.name ?? tenant.phone,
}).catch(fastify.log.warn.bind(fastify.log));
```

> `logActivityHelper` já está importado em `admin.ts` como alias de `services/activity.ts` (padrão estabelecido nas Slices 1 e 2). Verificar que o import existe antes de adicionar — se não existir, adicionar:
> ```ts
> import { logActivity as logActivityHelper } from '@/services/activity';
> ```

**O endpoint mantém o mesmo shape de resposta:** `{ success: true, id: tenant.id, tenant }`.

---

## 6. Web changes

### 6.1 — `routes/_dashboard/tenants/$tenantId.tsx`: corrigir SpecBar

**Antes (bug):**
```tsx
{ label: 'Imóvel', value: tenant.propertyId.slice(0, 6) + '…' }
```

**Depois:**
```tsx
{ label: 'Imóvel', value: tenant.propertyName ?? '—' }
```

`tenant.propertyName` já está disponível via `mapTenantRow` em `fetchTenant` — sem mudança em query.

### 6.2 — `routes/_dashboard/tenants/$tenantId.tsx`: adicionar externalId no header

No bloco de header (após o Avatar + displayName):

```tsx
<div className="min-w-0 flex-1">
  <h1 className="text-lg font-semibold text-foreground">{displayName}</h1>
  <p className="font-mono text-xs text-muted-foreground">{tenant.phone}</p>
  {tenant.externalId && (
    <p className="font-mono text-xs text-muted-foreground">{tenant.externalId}</p>
  )}
</div>
```

> Condicional `{tenant.externalId && ...}` é segurança de transição — após a migration NOT NULL todos os rows terão externalId, mas o tipo TS permanece `string | null`.

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `tenant_created` | `user` | `tenant` | Bot: `POST /admin/tenants` — após criar o tenant e atualizar a propriedade |

> Convenção conforme BRAINSTORM §5 C3: snake_case, sem acento.

---

## 8. Notificações

Nenhuma. Esta slice não dispara notificações WhatsApp, email ou in-app.

---

## 9. Critérios de aceite

### Schema
- [ ] Migration aplicada: `Tenant.externalId NOT NULL` (backfill + ALTER)
- [ ] Rows existentes sem `externalId` recebem `IQ-XXX` via sequência
- [ ] Prisma schema atualizado: `externalId String @unique` (sem `?`)
- [ ] `prisma generate` OK, bot compila

### Bot — `tenant_created`
- [ ] `POST /admin/tenants` emite `logActivityHelper` com `action: 'tenant_created'`, `subjectType: 'tenant'`
- [ ] Log é fire-and-forget — falha no log não quebra o endpoint
- [ ] Resposta do endpoint mantém shape `{ success: true, id, tenant }`
- [ ] `bunx tsc --noEmit` verde em `apps/bot`

### Web — detalhe do inquilino
- [ ] SpecBar mostra `propertyName` no campo "Imóvel" (não mais `propertyId.slice()`)
- [ ] Header do detalhe exibe `externalId` (IQ-XXX) abaixo do telefone — quando não null
- [ ] Inquilino sem `externalId` (legado pré-migration) não quebra o detalhe (condicional `&&`)
- [ ] `bunx tsc --noEmit` verde em `apps/web`

### Lint / testes
- [ ] `bun run lint` — 0 novos errors
- [ ] `bun test` (bot) — todos passam (sem regressões)
- [ ] `vitest run` (web) — todos passam (sem regressões, incluindo `tenant-status.test.ts`)

### ROADMAP
- [ ] Todos os itens da Slice 3 marcados `[x]` no ROADMAP

---

## 10. Riscos / edge cases

### R1 — Rows com `externalId` NULL antes da migration
Se existirem inquilinos criados manualmente (fora do bot, sem `externalId`), a sequência pode gerar IDs que colidam com os já existentes.
**Mitigação:** o backfill usa `NEXTVAL` que é atômico e não colide. Rows com `externalId` preenchido são ignorados pelo `WHERE "externalId" IS NULL`.

### R2 — `tenant_external_seq` com valor inicial baixo após backfill
Se a sequência gerar `IQ-001` e já existir um `externalId = 'IQ-001'`, o UPDATE falhará por violação de UNIQUE.
**Mitigação:** inspecionar o max valor existente antes de rodar a migration. Se necessário, fazer `SELECT SETVAL('tenant_external_seq', MAX_EXISTENTE + 1)` como pré-migration. O plano de implementação deve checar isso.

### R3 — `logActivityHelper` não importado em `admin.ts`
Slices 1 e 2 já usam o alias. Se por algum motivo o import foi removido ou não existe, o bot falhará na compilação.
**Mitigação:** `bunx tsc --noEmit` após adicionar o log captura imediatamente.

### R4 — `fetchTenant` retorna `propertyName` mas `Tenant` type diz `string | null`
Se a query retornar propriedade sem nome (ex: property deletada), `mapTenantRow` retorna `null`.
**Mitigação:** `tenant.propertyName ?? '—'` no SpecBar cobre o caso.

### R5 — externalId aparece duplicado no header (telefone + externalId)
Se o nome do inquilino é null, `displayName = tenant.phone`. O header mostra `phone` como h1 e `phone` novamente como mono. Com externalId, fica: displayName (phone) + phone (mono) + IQ-XXX.
**Mitigação:** mostrar o externalId apenas — o phone já aparece no bloco de contato da sidebar. Alternativa: usar `externalId` no lugar do phone mono quando disponível.
Decisão: usar `externalId` no lugar do `phone` mono quando externalId está disponível:
```tsx
<p className="font-mono text-xs text-muted-foreground">
  {tenant.externalId ?? tenant.phone}
</p>
```
Isso é consistente com o padrão do kanban de leads e tabela de inquilinos.

---

## 11. Dependências / pré-condições

- Foundation F0.6 aplicada: `tenant_external_seq` existe no banco
- Foundation F0.2 / Slices 1+2 aplicadas: `logActivity` helper em `services/activity.ts` existe
- `admin.ts` tem `logActivityHelper` importado (alias de `services/activity`)
- Bot e web rodam sem erros antes desta slice

---

## 12. Out of scope (explícito)

- Status "Inadimplente" (3º estado em `tenantStatus`) — mantém 2 estados (Em dia / Atenção)
- Ações no detalhe (encerrar contrato, registrar pagamento) — próximas slices
- `fetchTenant` / `fetchTenants` — sem mudança de queries
- `packages/types/src/tenant.ts` — sem mudança
- `index.tsx` e `new.tsx` — sem mudança
- Notificações (WhatsApp, email, in-app)
- RLS
- Filtros reais na lista de inquilinos
