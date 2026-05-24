# Spec: Foundation Helpers (Slice 0b)

> Sliced de [ROADMAP.md](../ROADMAP.md) F0.2 (activity log helpers) + F0.4 (notif infra WhatsApp) + gap F0.5 (Owner type).
> Depende de: [Slice 0a](./foundation-schema.md) — schema ActivityLog e Owner.notificationPhone já existem.
> Workflow: [workflow.md](../workflow.md).

---

## 1. Objetivo

Criar os helpers de infraestrutura que todas as slices de feature vão usar:

- `logActivity()` (bot + web) — gravar audit trail no ActivityLog
- `notifyOwner()` (bot) — notificar o owner via WhatsApp quando eventos críticos ocorrem
- `ActivityLogAction` union type — compile-time safety nas chamadas
- `Owner` type em `packages/types` — gap da Slice 0a
- `docs/activity-actions.md` — referência humana de todas as chaves `action`

Zero mudanças de schema. Zero UI. Apenas infraestrutura reutilizável.

---

## 2. Escopo

### Dentro

- `apps/bot/src/services/activity.ts` — `logActivity()` helper
- `apps/web/src/lib/activity.ts` — variante client-side via supabase-js
- `apps/bot/src/services/notify.ts` — `notifyOwner()` WhatsApp (Evolution API)
- `packages/types/src/activity-log.ts` — adicionar `ActivityLogAction` union type
- `packages/types/src/owner.ts` — criar tipo `Owner` (gap da Slice 0a)
- `packages/types/src/index.ts` — exportar `owner.ts`
- `docs/activity-actions.md` — documentação de todas as chaves `action`

### Fora

- Resend / email — nenhuma slice precisa antes do Slice 7
- In-app notifications via Supabase Realtime — só Dashboard (Slice 8) usa
- RLS policies — Fase 2
- Qualquer mudança de schema, migration ou UI
- `RESEND_API_KEY` env — não entra ainda

---

## 3. Schema changes

Nenhuma. Schema já preparado na Slice 0a.

---

## 4. Tipos compartilhados (`packages/types`)

### 4.1 — `ActivityLogAction` (adicionar em `activity-log.ts`)

```ts
export type ActivityLogAction =
  // Lead
  | 'lead_created'
  | 'lead_stage_changed'
  | 'lead_source_corrected'
  | 'bot_paused'
  | 'bot_resumed'
  // KYC / contrato
  | 'kyc_approved'
  | 'kyc_rejected'
  | 'contract_created'
  | 'contract_signed'
  | 'contract_cancelled'
  // Pagamento
  | 'payment_recorded'
  | 'payment_confirmed'
  | 'payment_marked_overdue'
  // Imóvel
  | 'property_created'
  | 'property_published'
  | 'property_archived'
  // Inquilino
  | 'tenant_created'
  | 'tenant_status_changed'
  // Template / regras
  | 'template_created'
  | 'template_published'
  | 'template_unpublished'
  | 'rule_set_created'
  | 'rule_set_linked'
  | 'rule_set_unlinked'
  // Owner
  | 'owner_updated'
```

`ActivityLog.action` passa de `string` para `ActivityLogAction`.

### 4.2 — `Owner` (criar `owner.ts`)

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

### 4.3 — `NotifyOwnerEventType` (local no bot — não em packages/types)

Tipagem local no bot — não precisa ser compartilhada com o web:

```ts
type NotifyOwnerEventType = 'kyc_pending' | 'contract_signed' | 'payment_overdue'

type NotifyPayloadMap = {
  kyc_pending: { leadName: string; leadPhone: string }
  contract_signed: { tenantName: string; contractCode: string }
  payment_overdue: { tenantName: string; propertyName: string; daysOverdue: number }
}
```

---

## 5. Bot changes

### 5.1 — `apps/bot/src/services/activity.ts` (CRIAR)

```ts
import { prisma } from '../db/client'
import type {
  ActivityLogActorType,
  ActivityLogSubjectType,
  ActivityLogAction,
} from '@kit-manager/types'

interface LogActivityParams {
  ownerId: string
  actorType: ActivityLogActorType
  actorId?: string
  actorLabel: string
  action: ActivityLogAction
  subjectType: ActivityLogSubjectType
  subjectId: string
  subject?: string
  metadata?: Record<string, unknown>
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  await prisma.activityLog.create({
    data: {
      ownerId: params.ownerId,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel,
      action: params.action,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      subject: params.subject ?? null,
      metadata: params.metadata ?? {},
    },
  })
}
```

**Comportamento de erro:** propaga (throw). O caller decide se envolve em try/catch.
Razão: silenciar falha de audit trail obscurece bugs. Caller de Slice 1+ pode fazer `logActivity(...).catch(console.error)` se quiser fire-and-forget.

### 5.2 — `apps/bot/src/services/notify.ts` (CRIAR)

```ts
import { prisma } from '../db/client'
import { sendText } from './evolution'

type NotifyOwnerEventType = 'kyc_pending' | 'contract_signed' | 'payment_overdue'

type NotifyPayloadMap = {
  kyc_pending: { leadName: string; leadPhone: string }
  contract_signed: { tenantName: string; contractCode: string }
  payment_overdue: { tenantName: string; propertyName: string; daysOverdue: number }
}

function buildMessage<T extends NotifyOwnerEventType>(
  eventType: T,
  payload: NotifyPayloadMap[T],
): string {
  switch (eventType) {
    case 'kyc_pending': {
      const p = payload as NotifyPayloadMap['kyc_pending']
      return `KYC pendente: ${p.leadName} (${p.leadPhone}) enviou documentos para analise.`
    }
    case 'contract_signed': {
      const p = payload as NotifyPayloadMap['contract_signed']
      return `Contrato ${p.contractCode} assinado por ${p.tenantName}.`
    }
    case 'payment_overdue': {
      const p = payload as NotifyPayloadMap['payment_overdue']
      return `Pagamento em atraso ha ${p.daysOverdue} dias: ${p.tenantName} - ${p.propertyName}.`
    }
  }
}

export async function notifyOwner<T extends NotifyOwnerEventType>(
  ownerId: string,
  eventType: T,
  payload: NotifyPayloadMap[T],
): Promise<void> {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: ownerId } })
    if (!owner) {
      console.error(`notifyOwner: owner ${ownerId} not found`)
      return
    }
    const phone = owner.notificationPhone ?? owner.phone
    const message = buildMessage(eventType, payload)
    await sendText(`${phone}@s.whatsapp.net`, message)
  } catch (err) {
    console.error('notifyOwner failed (non-blocking):', err)
  }
}
```

**Comportamento de erro:** fire-and-forget — falha de notificação não deve quebrar o fluxo principal. Loga erro e retorna silenciosamente.

---

## 6. Web changes

### `apps/web/src/lib/activity.ts` (CRIAR)

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActivityLogActorType,
  ActivityLogSubjectType,
  ActivityLogAction,
} from '@kit-manager/types'

interface LogActivityParams {
  ownerId: string
  actorType: ActivityLogActorType
  actorId?: string
  actorLabel: string
  action: ActivityLogAction
  subjectType: ActivityLogSubjectType
  subjectId: string
  subject?: string
  metadata?: Record<string, unknown>
}

export async function logActivity(
  supabase: SupabaseClient,
  params: LogActivityParams,
): Promise<void> {
  const { error } = await supabase.from('ActivityLog').insert({
    ownerId: params.ownerId,
    actorType: params.actorType,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel,
    action: params.action,
    subjectType: params.subjectType,
    subjectId: params.subjectId,
    subject: params.subject ?? null,
    metadata: params.metadata ?? {},
  })
  if (error) throw error
}
```

**Nota:** Prisma cria colunas com nomes camelCase no Postgres (`"ownerId"`, `"actorType"`, etc.). Supabase-js acessa os mesmos nomes — ambas as pontas usam camelCase, sem conflito.

---

## 7. Activity log keys

Documentadas em `docs/activity-actions.md` (criado nessa slice) e tipadas via `ActivityLogAction` em `packages/types`.

### Convenção

- Formato: `<objeto>_<verbo_passado>` — snake_case
- `actorType` valores: `'bot'` (webhook), `'user'` (owner logado no admin), `'system'` (cron/automação)
- `actorLabel` valores típicos: `'Bot'`, `'Sistema'`, nome do owner

### Chaves por slice

| Slice | Chave | actorType | subjectType |
| --- | --- | --- | --- |
| 0b (esta) | — (helpers criados, nenhum log emitido ainda) | — | — |
| 1 — Leads | `lead_created` | `bot` | `lead` |
| 1 — Leads | `lead_source_corrected` | `user` | `lead` |
| 1 — Leads | `bot_paused` | `user` | `lead` |
| 1 — Leads | `bot_resumed` | `user` | `lead` |
| 2 — Properties | `property_created` | `user` | `property` |
| 2 — Properties | `property_published` | `user` | `property` |
| 2 — Properties | `property_archived` | `user` | `property` |
| 3 — Tenants | `tenant_created` | `bot` | `tenant` |
| 4 — Templates | `template_created` | `user` | `template` |
| 4 — Templates | `template_published` | `user` | `template` |
| 4 — Templates | `template_unpublished` | `user` | `template` |
| 5 — Contracts | `contract_created` | `user` | `contract` |
| 5 — Contracts | `contract_signed` | `bot` | `contract` |
| 6 — Rules | `rule_set_created` | `user` | `rule_set` |
| 6 — Rules | `rule_set_linked` | `user` | `rule_set` |
| 7 — Finance | `payment_recorded` | `user` | `payment` |
| 7 — Finance | `payment_confirmed` | `bot` | `payment` |
| 7 — Finance | `payment_marked_overdue` | `system` | `payment` |
| bot | `kyc_approved` | `user` | `lead` |
| bot | `kyc_rejected` | `user` | `lead` |
| bot | `contract_created` | `bot` | `contract` |

---

## 8. Notificações

### Eventos WhatsApp (MVP)

| Evento | Gatilho | Payload |
| --- | --- | --- |
| `kyc_pending` | Bot: lead avança para stage `kyc_pending` | `{ leadName, leadPhone }` |
| `contract_signed` | Bot: lead confirma assinatura do contrato | `{ tenantName, contractCode }` |
| `payment_overdue` | Cron (Slice 7): pagamento vencido há > 5 dias | `{ tenantName, propertyName, daysOverdue }` |

**Canal:** WhatsApp via Evolution API — `owner.notificationPhone ?? owner.phone`.

**Futuros canais (fora do escopo):** email Resend, in-app Realtime.

**Trade-off consciente:** adicionar novo tipo de notificação exige novo `case` em `notify.ts` e novo entry em `NotifyPayloadMap`. Aceito para MVP — centraliza o copy e garante type safety.

---

## 9. Critérios de aceite

- [x] `apps/bot/src/services/activity.ts` criado e exporta `logActivity()`
- [x] `apps/web/src/lib/activity.ts` criado e exporta `logActivity(supabase, params)`
- [x] `apps/bot/src/services/notify.ts` criado e exporta `notifyOwner(ownerId, eventType, payload)`
- [x] `notifyOwner` tipado: TS recusa event types não definidos em `NotifyOwnerEventType`
- [x] `ActivityLogAction` union type adicionado em `packages/types/src/activity-log.ts`
- [x] `ActivityLog.action` usa `ActivityLogAction` (não `string`)
- [x] `packages/types/src/owner.ts` criado e exportado em `index.ts` (Owner em `property.ts`, re-exportado via `index.ts`)
- [x] `docs/activity-actions.md` criado com tabela completa de chaves
- [x] `bunx tsc --noEmit` verde em `packages/types`, `apps/bot`, `apps/web`
- [x] `bunx oxlint` sem warnings novos em `apps/bot` e `apps/web`
- [ ] Bot inicia sem erros (`bun run dev`)
- [ ] Web inicia sem erros (`bun run dev`)

---

## 10. Riscos / edge cases

### R1 — `owner.notificationPhone` null

Owner pode não ter preenchido `notificationPhone`. Mitigação: `notifyOwner` faz fallback para `owner.phone`.

### R2 — Evolution API fora do ar

`sendText()` pode falhar. Mitigação: `notifyOwner` captura o erro, loga com `console.error`, retorna sem throw. Fluxo principal não quebra.

### R3 — `ActivityLog.action` string vs union

O Prisma schema define `action String` — não há enum no banco. A union type `ActivityLogAction` só existe no TypeScript. Prisma aceita qualquer string no insert; a segurança é compile-time only. Aceitável para MVP.

### R4 — Nomes de coluna camelCase em ambas as pontas

Prisma cria colunas como `"ownerId"` (camelCase com aspas no Postgres). Supabase-js acessa os mesmos nomes sem conversão. Ambas as pontas usam camelCase — sem conflito, sem mapeamento manual necessário.

### R5 — `logActivity` sem await no caller

Chamadas fire-and-forget sem `.catch()` engolirão erros silenciosamente. Mitigação: documentado em `docs/activity-actions.md` — callers devem usar `await` ou `.catch(console.error)` explicitamente.

---

## 11. Dependências / pré-condições

- Slice 0a aplicada — schema ActivityLog com todos os campos novos
- `Owner.notificationPhone` coluna existe (nullable)
- Evolution API configurada e acessível
- `@kit-manager/types` importável em `apps/bot` e `apps/web`

---

## 12. Out of scope (explícito)

- Resend email integration
- Supabase Realtime in-app notifications
- RLS policies
- Qualquer mudança de schema
- Qualquer UI change
- Testes automatizados (sem infraestrutura de teste no projeto ainda)
