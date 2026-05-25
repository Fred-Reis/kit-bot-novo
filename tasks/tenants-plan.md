# Implementation Plan: Slice 3 — Tenants

> Gerado de [specs/tenants.md](../specs/tenants.md).
> Pipeline: T01 → T02 → T03 → T04. Aprovação manual antes de cada task.

---

## Visão geral

4 tasks pequenas. A maior parte da slice já estava implementada — o trabalho real é:
1. Tornar `Tenant.externalId` NOT NULL no banco
2. Emitir `tenant_created` no activity log
3. Corrigir SpecBar e header no detalhe do inquilino
4. Sincronizar ROADMAP

Dependências: T01 → T02 (schema deve estar estável antes de gerar tipos do Prisma). T03 e T04 são independentes, executados após T02.

---

## T01 — Criar migration `Tenant.externalId NOT NULL`

**Descrição:** Criar arquivo SQL de migration com backfill e ALTER TABLE. Atualizar Prisma schema para refletir NOT NULL. Rodar `prisma generate`.

**Arquivos afetados:**
- `apps/bot/prisma/migrations/20260524000001_tenants_slice_externalid_not_null/migration.sql` (CRIAR)
- `apps/bot/prisma/schema.prisma` (editar: `externalId String? @unique` → `externalId String @unique`)

**Conteúdo do migration.sql:**
```sql
-- Backfill: atribuir externalId a rows sem valor (via sequência existente)
UPDATE "Tenant"
SET "externalId" = 'IQ-' || LPAD(NEXTVAL('tenant_external_seq')::text, 3, '0')
WHERE "externalId" IS NULL;

-- Enforce NOT NULL
ALTER TABLE "Tenant" ALTER COLUMN "externalId" SET NOT NULL;
```

> Antes de criar o arquivo, verificar se existe algum Tenant sem `externalId` no banco para garantir que a sequência não gera colisão com IDs existentes. Se `tenant_external_seq` estiver abaixo do maior sufixo numérico existente, fazer `SELECT SETVAL('tenant_external_seq', N)` na pré-migration.

**Verificação:**
```bash
cd apps/bot && bunx prisma migrate deploy   # aplica o SQL no banco
cd apps/bot && bunx prisma generate         # regenera o client
cd apps/bot && bunx tsc --noEmit            # garante que tipos estão OK
```

**Critério de pronto:**
- [x] `migration.sql` criado com backfill + ALTER
- [x] `schema.prisma`: `externalId String @unique` (sem `?`)
- [x] `bunx prisma generate` roda sem erro
- [x] `bunx tsc --noEmit` verde em `apps/bot`

---

## T02 — Emitir `tenant_created` em `POST /admin/tenants`

**Descrição:** Adicionar chamada a `logActivityHelper` após o `$transaction` e `redis.del` no endpoint de criação de inquilino. Fire-and-forget.

**Arquivo afetado:**
- `apps/bot/src/routes/admin.ts` (editar: adicionar ~5 linhas após linha `redis.del(...)`)

> `logActivityHelper` já está importado na linha 8 de `admin.ts` — sem mudança de imports.

**Trecho a adicionar** (após `redis.del(...)`, antes do `return reply`):
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

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
cd apps/bot && bunx oxlint src/
```

**Critério de pronto:**
- [x] `logActivityHelper` chamado com `action: 'tenant_created'` e `subjectType: 'tenant'`
- [x] `.catch(fastify.log.warn...)` presente (fire-and-forget)
- [x] Shape de resposta do endpoint não muda: `{ success: true, id, tenant }`
- [x] `bunx tsc --noEmit` verde
- [x] `bunx oxlint` sem novos erros

---

## T03 — Corrigir detalhe do inquilino (`$tenantId.tsx`)

**Descrição:** Duas mudanças cirúrgicas no mesmo arquivo:
1. SpecBar: substituir `tenant.propertyId.slice(0, 6) + '…'` por `tenant.propertyName ?? '—'`
2. Header: substituir `<p className="font-mono text-xs text-muted-foreground">{tenant.phone}</p>` por `<p ...>{tenant.externalId ?? tenant.phone}</p>`

**Arquivo afetado:**
- `apps/web/src/routes/_dashboard/tenants/$tenantId.tsx` (editar: 2 linhas)

**Mudança 1 — SpecBar (linha ~68):**
```tsx
// ANTES:
{ label: 'Imóvel', value: tenant.propertyId.slice(0, 6) + '…' }

// DEPOIS:
{ label: 'Imóvel', value: tenant.propertyName ?? '—' }
```

**Mudança 2 — Header mono (linha ~59):**
```tsx
// ANTES:
<p className="font-mono text-xs text-muted-foreground">{tenant.phone}</p>

// DEPOIS:
<p className="font-mono text-xs text-muted-foreground">{tenant.externalId ?? tenant.phone}</p>
```

> `tenant.externalId` já está disponível via `fetchTenant` (select `*` retorna todos os campos). `tenant.propertyName` já está disponível via `mapTenantRow`. Sem mudanças em queries.

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/
cd apps/web && bunx vitest run
```

**Critério de pronto:**
- [x] SpecBar campo "Imóvel" exibe o nome do imóvel (não mais `UUID.slice(0,6)`)
- [x] Header mono exibe `externalId` (IQ-XXX) quando disponível, fallback para `phone`
- [x] `bunx tsc --noEmit` verde em `apps/web`
- [x] `vitest run` sem regressões (incluindo `tenant-status.test.ts`)
- [x] `bunx oxlint` sem novos erros

---

## T04 — Atualizar ROADMAP (marcar Slice 3 como done)

**Descrição:** Marcar `[x]` em todos os itens da Slice 3 que estavam implementados antes desta slice (maioria) e nos que foram implementados nas tasks T01–T03.

**Arquivo afetado:**
- `ROADMAP.md` (editar: trocar `[ ]` por `[x]` nos itens da Slice 3 + adicionar commit final)

**Itens a marcar `[x]`:**
- `[ ] Migration: Tenant.externalId (IQ-XXX sequence) — enforce no create` → `[x]` (T01)
- `[ ] Atualizar tipo Tenant em packages/types` → `[x]` (já estava correto — confirmar)
- `[ ] Bot: auto-gerar externalId em POST /admin/tenants` → `[x]` (já estava correto)
- `[ ] Web: fetchTenants() join Property retorna propertyName, externalId` → `[x]` (já estava correto)
- `[ ] Web: tabela com colunas IMÓVEL + STATUS pill (Em dia / Atenção)` → `[x]` (já estava correto)
- `[ ] Web: cards view atualizado` → `[x]` (já estava correto)
- `[ ] Web: detalhe — propertyName, externalId, score` → `[x]` (T03)
- `[ ] Activity log: tenant_created` → `[x]` (T02)
- `[ ] Commit` → `[x]`

**Verificação:** revisão visual do ROADMAP.

**Critério de pronto:**
- [x] Todos os `[ ]` da Slice 3 marcados `[x]` no ROADMAP
- [x] Tracking macro atualizado: `F1 — Vertical slices: 3/9 (Slice 3 ✓)` e `% MVP` recalculado

---

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Colisão de `externalId` no backfill | Alto | Verificar max sufixo existente e ajustar sequência antes do ALTER |
| `logActivityHelper` com assinatura diferente da esperada | Médio | `bunx tsc --noEmit` captura imediatamente após T02 |
| `propertyName` null no detalhe (imóvel deletado) | Baixo | `?? '—'` cobre o caso |

---

## Sequência de execução

```
T01 (schema + prisma generate)
    ↓
T02 (bot: activity log)
    ↓
T03 (web: SpecBar + header fix)
    ↓
T04 (ROADMAP sync)
```

Total: 4 tasks, todas XS/S. Slice inteira é cirúrgica — sem novas abstrações, sem novos componentes.
