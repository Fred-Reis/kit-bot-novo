# Plan: Foundation Helpers (Slice 0b)

> Spec: [specs/foundation-helpers.md](../specs/foundation-helpers.md)
> Objetivo: criar helpers logActivity() + notifyOwner() + tipos Owner/ActivityLogAction + docs.

---

## Ordem de execução

```
T01 (packages/types)
  ├──→ T02 (bot: activity.ts)
  ├──→ T03 (bot: notify.ts)
  └──→ T04 (web: activity.ts)

T05 (docs/activity-actions.md) — independente, sem bloqueio

T01 + T02 + T03 + T04 + T05 → T06 (typecheck + lint final)
```

---

## T01 — Atualizar `packages/types`

**Descrição:** Adicionar `ActivityLogAction` union type em `activity-log.ts`, alterar `ActivityLog.action` de `string` para `ActivityLogAction`, criar `owner.ts` com tipo `Owner`, exportar em `index.ts`.

**Arquivos afetados:**

- `packages/types/src/activity-log.ts` — adicionar `ActivityLogAction`, atualizar `ActivityLog.action`
- `packages/types/src/owner.ts` — CRIAR
- `packages/types/src/index.ts` — adicionar `export * from './owner'`

**Mudanças:**

Em `activity-log.ts`, adicionar antes do `ActivityLog` interface:

```ts
export type ActivityLogAction =
  | 'lead_created' | 'lead_stage_changed' | 'lead_source_corrected'
  | 'bot_paused' | 'bot_resumed'
  | 'kyc_approved' | 'kyc_rejected'
  | 'contract_created' | 'contract_signed' | 'contract_cancelled'
  | 'payment_recorded' | 'payment_confirmed' | 'payment_marked_overdue'
  | 'property_created' | 'property_published' | 'property_archived'
  | 'tenant_created' | 'tenant_status_changed'
  | 'template_created' | 'template_published' | 'template_unpublished'
  | 'rule_set_created' | 'rule_set_linked' | 'rule_set_unlinked'
  | 'owner_updated'
```

Alterar em `ActivityLog` interface: `action: string` → `action: ActivityLogAction`.

Novo `owner.ts`:

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
cd apps/bot && bunx tsc --noEmit
cd apps/web && bunx tsc --noEmit
```

**Critério de pronto:** `ActivityLogAction` exportado, `ActivityLog.action` usa o tipo, `Owner` exportado, tsc verde nos 3 pacotes.

---

## T02 — Criar `apps/bot/src/services/activity.ts`

**Descrição:** Helper `logActivity()` para o bot. Recebe objeto explícito com todos os campos, cria registro no `ActivityLog` via Prisma. Propaga erros (não silencia).

**Arquivos afetados:**

- `apps/bot/src/services/activity.ts` — CRIAR

**Implementação conforme spec §5.1.**

**Verificação:**

```bash
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/services/activity.ts
```

**Critério de pronto:** arquivo criado, exporta `logActivity`, tsc + oxlint verde.

---

## T03 — Criar `apps/bot/src/services/notify.ts`

**Descrição:** Helper `notifyOwner()` para o bot. Tipado por evento (`kyc_pending | contract_signed | payment_overdue`). Busca owner no banco, envia WhatsApp via `sendText()`. Fire-and-forget — captura erro, loga, não relança.

**Arquivos afetados:**

- `apps/bot/src/services/notify.ts` — CRIAR

**Implementação conforme spec §5.2.**

**Verificação:**

```bash
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/services/notify.ts
```

**Critério de pronto:** arquivo criado, exporta `notifyOwner`, TS recusa event type inválido em tempo de compilação, tsc + oxlint verde.

---

## T04 — Criar `apps/web/src/lib/activity.ts`

**Descrição:** Variante client-side de `logActivity()`. Recebe `supabase` como primeiro argumento, insere no `ActivityLog` via supabase-js. Usa nomes camelCase (igual ao bot — Prisma cria colunas com aspas preservando case no Postgres).

**Arquivos afetados:**

- `apps/web/src/lib/activity.ts` — CRIAR

**Implementação conforme spec §6.**

**Verificação:**

```bash
cd apps/web && bunx tsc --noEmit
bunx oxlint src/lib/activity.ts
```

**Critério de pronto:** arquivo criado, exporta `logActivity(supabase, params)`, tsc + oxlint verde.

---

## T05 — Criar `docs/activity-actions.md`

**Descrição:** Documentação de referência de todas as chaves `action`, convenção de uso, valores de `actorType`/`actorLabel`, e nota sobre uso correto de `await` nos callers.

**Arquivos afetados:**

- `docs/activity-actions.md` — CRIAR

**Conteúdo mínimo:**

- Seção: Convenção de nomenclatura
- Seção: Valores de `actorType` e `actorLabel`
- Tabela: todas as chaves `action` por slice (ver spec §7)
- Seção: Como usar — exemplos de chamada correta (bot + web)
- Nota: sempre `await logActivity(...)` ou `.catch(console.error)` explícito

**Verificação:** arquivo existe e está legível.

**Critério de pronto:** arquivo criado com todas as seções acima.

---

## T06 — Typecheck + lint final (todos os pacotes)

**Descrição:** Verificação final de consistência antes de marcar a slice como pronta.

**Verificação:**

```bash
# Types
cd packages/types && bunx tsc --noEmit

# Bot
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/

# Web
cd apps/web && bunx tsc --noEmit
bunx oxlint src/
```

**Critério de pronto:**

- [x] `tsc --noEmit` verde em `packages/types`
- [x] `tsc --noEmit` verde em `apps/bot`
- [x] `tsc --noEmit` verde em `apps/web`
- [x] `oxlint` sem warnings novos em `apps/bot`
- [x] `oxlint` sem warnings novos em `apps/web`

---

## Resumo de arquivos afetados

| Arquivo | Task | Operação |
| --- | --- | --- |
| `packages/types/src/activity-log.ts` | T01 | Editar |
| `packages/types/src/owner.ts` | T01 | Criar |
| `packages/types/src/index.ts` | T01 | Editar |
| `apps/bot/src/services/activity.ts` | T02 | Criar |
| `apps/bot/src/services/notify.ts` | T03 | Criar |
| `apps/web/src/lib/activity.ts` | T04 | Criar |
| `docs/activity-actions.md` | T05 | Criar |
