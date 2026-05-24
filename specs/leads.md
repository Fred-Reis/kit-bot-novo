# Spec: Slice 1 — Leads (kanban + detalhe + pausar bot)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 1.
> Depende de: Slice 0a (schema) + Slice 0b (helpers logActivity + notifyOwner).
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Completar o pipeline de leads ponta-a-ponta: bot extrai origem e imóvel do lead, admin consegue pausar o bot por conversa, kanban mostra cards ricos com externalId + origem + imóvel, e detalhe permite corrigir origem e pausar/retomar o bot.

**Usuário alvo:** proprietário logado no admin (apps/web).

**Sucesso:** owner consegue ver de onde veio cada lead, pausar o bot para assumir manualmente, e retomar sem tocar no código.

---

## 2. Escopo

### Dentro

**Schema & migration**
- `Conversation.botPaused boolean NOT NULL DEFAULT false` — nova coluna via migration

**Types (`packages/types`)**
- `LeadSource`: adicionar `'olx' | 'outro' | 'desconhecido'` (manter `'whatsapp'` e `'other'` para compat)
- `Conversation`: novo tipo `{ chatId: string; ownerId: string; botPaused: boolean; updatedAt: string }`

**Bot**
- `LeadExtractionSchema` (Zod em `agents/lead.ts`): adicionar campo `source` — `z.enum(['olx','zap','site','instagram','indicacao','outro','desconhecido']).nullable().default(null)`
- Persistir `Lead.source` na primeira detecção (só se `lead.source == null || lead.source == 'whatsapp'`)
- Persistir `Lead.propertyId` quando `propertyInFocus` muda (em `flows/lead/context.ts` ou `flows/lead/index.ts`)
- Router (`flows/router.ts`): verificar `Conversation.botPaused` antes de invocar `handleLeadMessage` — se `true`, apenas loga `Event` (sem LLM, sem resposta)
- Endpoint novo: `PATCH /admin/leads/:id/pause-bot` — body `{ paused: boolean }` → atualiza `Conversation.botPaused` via `lead.phone`
- `notifyOwner('kyc_pending', ...)` em `approve-kyc` endpoint (quando stage transita para `kyc_pending`) **— apenas se ainda não estiver sendo chamado**
- `logActivity` nos novos eventos desta slice (usando helper `services/activity.ts`)

**Web (admin)**
- `fetchLead(id)`: busca `Conversation(botPaused)` via `lead.phone` em paralelo — retorna `Lead & { botPaused: boolean }`
- `LeadKanbanCard`: adicionar `externalId` (mono muted), source chip, tempo relativo (`updatedAt`)
- `lib/lead-utils.ts`: função pura `stageToColumn(stage: LeadStage): KanbanColumnKey`
- `SOURCE_LABELS`: adicionar `olx`, `outro`, `desconhecido`
- Detalhe lead (`$leadId.tsx`): source dropdown para correção manual → `PATCH /admin/leads/:id` + `logActivity('lead_source_corrected')`
- Detalhe lead: toggle "Pausar bot" → chama `PATCH /admin/leads/:id/pause-bot`
- Detalhe lead: badge "Bot pausado — você assume" quando `botPaused === true`

**Activity log**
- `lead_created`: bot escreve no `upsert` quando `$count === 0` (primeira vez)
- `lead_source_corrected`: web escreve quando owner muda dropdown
- `bot_paused` / `bot_resumed`: web escreve junto ao PATCH

### Fora (próximas slices)

- `lead_stage_changed` (requer hook em toda transição de stage — desvio de escopo)
- Email diário com resumo (Resend — deferred)
- Filtros reais no header (stub é suficiente)
- Modal "Novo lead" (stub "leads vêm via WhatsApp")
- Migrar chamadas `logActivity` legadas em `admin.ts` (old signature) — cleanup separado
- `kyc_approved`, `contract_generated`, `payment_confirmed` ativities — já existem via old helper

---

## 3. Schema changes

### Migration: `leads_slice_conversation_bot_paused`

```sql
ALTER TABLE "Conversation" ADD COLUMN "botPaused" BOOLEAN NOT NULL DEFAULT false;
```

Prisma schema (`apps/bot/prisma/schema.prisma`):

```prisma
model Conversation {
  chatId    String   @id
  ownerId   String
  owner     Owner    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  data      Json
  botPaused Boolean  @default(false)
  updatedAt DateTime @updatedAt

  @@index([ownerId])
}
```

**Sem backfill necessário** — `DEFAULT false` cobre todos os rows existentes.

**Sem outras migrations** — `Lead.name`, `Lead.source`, `Lead.propertyId`, `Lead.externalId` já existem no schema (confirmado na análise).

---

## 4. Tipos compartilhados (`packages/types`)

### 4.1 — `LeadSource` (editar `lead.ts`)

```ts
export type LeadSource =
  | 'whatsapp'   // criação inicial pelo bot (compat)
  | 'olx'        // OLX
  | 'zap'        // Zap Imóveis
  | 'site'       // site próprio
  | 'instagram'
  | 'indicacao'
  | 'outro'      // extraído pelo LLM
  | 'desconhecido'
  | 'other';     // legado (compat com dados existentes)
```

### 4.2 — `Conversation` (criar em `lead.ts` ou novo `conversation.ts`)

```ts
export interface Conversation {
  chatId: string;
  ownerId: string;
  botPaused: boolean;
  updatedAt: string;
}
```

Exportar em `packages/types/src/index.ts`.

---

## 5. Bot changes

### 5.1 — `agents/lead.ts`: adicionar `source` ao `LeadExtractionSchema`

```ts
const LeadExtractionSchema = z.object({
  // ... campos existentes ...
  source: z.enum(['olx','zap','site','instagram','indicacao','outro','desconhecido']).nullable().default(null),
});
```

### 5.2 — `flows/lead/index.ts`: persistir `source` e `propertyId`

Após processar extração do LLM:
- Se `extracted.source != null` e `lead.source == null || lead.source == 'whatsapp'` → `prisma.lead.update({ where: { phone }, data: { source: extracted.source } })`
- Se `snapshot.propertyInFocus?.id != null` e diferente do `lead.propertyId` atual → `prisma.lead.update({ where: { phone }, data: { propertyId: snapshot.propertyInFocus.id } })`

### 5.3 — `flows/router.ts`: verificar `botPaused`

```ts
// Após upsert do Lead, antes de handleLeadMessage:
const conversation = await prisma.conversation.findUnique({ where: { chatId } });
if (conversation?.botPaused) {
  // loga o evento recebido sem responder
  await prisma.event.create({ data: { chatId, type: 'message_suppressed', ownerId: owner.id, payload: { text } } });
  return;
}
```

### 5.4 — `routes/admin.ts`: endpoint `PATCH /admin/leads/:id/pause-bot`

```ts
fastify.patch('/admin/leads/:id/pause-bot', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { paused } = request.body as { paused: boolean };

  const lead = await prisma.lead.findUnique({ where: { id }, select: { phone: true, name: true, ownerId: true } });
  if (!lead) return reply.status(404).send({ error: 'Lead not found' });

  await prisma.conversation.update({ where: { chatId: lead.phone }, data: { botPaused: paused } });

  await logActivityHelper({
    ownerId: lead.ownerId,
    actorType: 'user',
    actorLabel: request.adminUserId ?? 'Admin',
    action: paused ? 'bot_paused' : 'bot_resumed',
    subjectType: 'lead',
    subjectId: id,
    subject: lead.name ?? lead.phone,
  });

  return reply.send({ paused });
});
```

> `logActivityHelper` = import de `services/activity.ts` (renomear o import para não colidir com a função local `logActivity` existente em admin.ts).

### 5.5 — `flows/router.ts`: `logActivity('lead_created')` na primeira criação

Antes do `upsert`, verificar se o lead já existe:

```ts
const existing = await prisma.lead.findUnique({ where: { phone: chatId }, select: { id: true } });

await prisma.lead.upsert({ ... });

if (!existing) {
  await logActivity({
    ownerId: owner.id,
    actorType: 'bot',
    actorLabel: 'Bot',
    action: 'lead_created',
    subjectType: 'lead',
    subjectId: chatId, // substituir pelo id do lead criado
    subject: chatId,
  }).catch(console.error);
}
```

### 5.6 — `notifyOwner` em `kyc_pending` (bot flow, não admin.ts)

O endpoint `approve-kyc` lê de `kyc_pending` — não seta. Quem seta `Lead.stage = 'kyc_pending'` é o bot quando `snapshot.docsStage === 'complete'`. Esse passo está **ausente** no código atual — adicionamos em `flows/lead/index.ts`, após buildar o snapshot:

```ts
// Após buildLeadSnapshot (step 10)
if (
  snapshot.docsStage === 'complete' &&
  lead.stage !== 'kyc_pending' &&
  lead.stage !== 'kyc_approved' &&
  lead.stage !== 'residents_docs_complete' &&
  lead.stage !== 'contract_pending' &&
  lead.stage !== 'contract_signed' &&
  lead.stage !== 'converted'
) {
  await prisma.lead.update({ where: { phone: chatId }, data: { stage: 'kyc_pending' } });
  await notifyOwner(lead.ownerId, 'kyc_pending', {
    leadName: lead.name ?? chatId,
    leadPhone: chatId,
  }).catch(console.error);
}
```

> `notifyOwner` é fire-and-forget — `catch(console.error)` impede que falha de notificação quebre o fluxo.

---

## 6. Web changes

### 6.1 — `lib/lead-utils.ts` (CRIAR)

```ts
import type { LeadStage } from '@kit-manager/types';

export type KanbanColumnKey = 'novo' | 'qualificacao' | 'visita' | 'proposta' | 'ganho';

const STAGE_TO_COLUMN: Record<LeadStage, KanbanColumnKey> = {
  interest: 'novo',
  collection: 'qualificacao',
  review_submitted: 'qualificacao',
  visiting: 'visita',
  kyc_pending: 'proposta',
  kyc_approved: 'proposta',
  residents_docs_complete: 'proposta',
  contract_pending: 'proposta',
  contract_signed: 'proposta',
  converted: 'ganho',
};

export function stageToColumn(stage: LeadStage): KanbanColumnKey {
  return STAGE_TO_COLUMN[stage] ?? 'novo';
}
```

### 6.2 — `lib/queries.ts`: atualizar `fetchLead`

Buscar `Conversation(botPaused)` via `lead.phone` em paralelo:

```ts
export async function fetchLead(id: string): Promise<Lead & { botPaused: boolean; documents: LeadDocument[] }> {
  const { data: lead, error } = await supabase.from('Lead').select('*, property:Property(externalId)').eq('id', id).single();
  if (error) throw error;

  const [{ data: docs }, { data: conv }] = await Promise.all([
    supabase.from('LeadDocument').select('*').eq('leadId', id).order('createdAt', { ascending: true }),
    supabase.from('Conversation').select('botPaused').eq('chatId', lead.phone).single(),
  ]);

  return { ...mapLeadRow(lead), botPaused: conv?.botPaused ?? false, documents: docs ?? [] };
}
```

### 6.3 — `lib/leads.ts`: atualizar `SOURCE_LABELS`

```ts
export const SOURCE_LABELS: Record<LeadSource, string> = {
  whatsapp: 'ZAP',  // compat
  olx: 'OLX',
  zap: 'ZAP',
  site: 'Site',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  outro: 'Outro',
  desconhecido: '?',
  other: 'Outro',  // compat legado
};
```

### 6.4 — `LeadKanbanCard` (componente existente): enriquecer card

Adicionar ao card:
- `externalId` em `font-mono text-[10px] text-muted-foreground` (fallback: ocultar se null)
- Source chip: `<Pill>` com `SOURCE_LABELS[lead.source]` (ocultar se null)
- Property ref: `lead.propertyExternalId` em muted (ocultar se null)
- Tempo relativo: `formatDistanceToNow(new Date(lead.updatedAt), { locale: ptBR, addSuffix: true })`

### 6.5 — `routes/_dashboard/leads/$leadId.tsx`: adicionar ao detalhe

**Source dropdown (correção manual):**
```tsx
<select value={lead.source ?? ''} onChange={handleSourceChange}>
  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
</select>
```
`handleSourceChange` → `PATCH /admin/leads/:id` com `{ source }` → `logActivity('lead_source_corrected')`.

**Toggle pausar bot:**
```tsx
<button onClick={handlePauseToggle}>
  {botPaused ? 'Retomar bot' : 'Pausar bot'}
</button>
```
`handlePauseToggle` → `PATCH /admin/leads/:id/pause-bot` com `{ paused: !botPaused }`.

**Badge "Bot pausado":**
```tsx
{botPaused && (
  <div data-slot="bot-paused-badge">Bot pausado — você assume</div>
)}
```

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `lead_created` | `bot` | `lead` | Bot: primeira criação via upsert |
| `lead_source_corrected` | `user` | `lead` | Web: owner muda dropdown de origem |
| `bot_paused` | `user` | `lead` | Web: owner clica "Pausar bot" |
| `bot_resumed` | `user` | `lead` | Web: owner clica "Retomar bot" |

---

## 8. Notificações

| Evento | Canal | Gatilho | Payload |
|---|---|---|---|
| `kyc_pending` | WhatsApp | Bot: `approve-kyc` endpoint transita para `kyc_pending` | `{ leadName, leadPhone }` |

---

## 9. Critérios de aceite

### Schema
- [ ] Migration aplicada: `Conversation.botPaused boolean NOT NULL DEFAULT false`
- [ ] `prisma generate` OK, bot compila

### Types
- [ ] `LeadSource` inclui `olx`, `outro`, `desconhecido`
- [ ] `Conversation` type exportado de `@kit-manager/types`
- [ ] `bunx tsc --noEmit` verde em todos os pacotes

### Bot
- [ ] `LeadExtractionSchema` tem campo `source` (enum + nullable)
- [ ] `Lead.source` é persistido na primeira detecção (não sobrescreve depois)
- [ ] `Lead.propertyId` é persistido quando `propertyInFocus` muda
- [ ] Se `Conversation.botPaused === true`: mensagem não invoca LLM, não gera resposta
- [ ] `PATCH /admin/leads/:id/pause-bot` atualiza `Conversation.botPaused` e retorna `{ paused }`
- [ ] `logActivity('lead_created')` emitido na primeira criação do lead
- [ ] `notifyOwner('kyc_pending')` chamado no endpoint `approve-kyc`
- [ ] Bot inicia sem erros

### Web
- [ ] `fetchLead` retorna `botPaused: boolean` (de `Conversation`)
- [ ] `stageToColumn()` cobre todos os 10 stages sem fallback inesperado
- [ ] `SOURCE_LABELS` cobre todos os valores de `LeadSource`
- [ ] Kanban card exibe `externalId` mono + source chip + tempo relativo
- [ ] Detalhe: dropdown de origem funcional + `lead_source_corrected` logado
- [ ] Detalhe: toggle "Pausar bot" funcional + badge visível quando pausado
- [ ] Web compila sem erros de tipo
- [ ] Vitest: todos os testes passam (sem regressões)

### Lint / testes
- [ ] `bun run lint` — 0 novos errors
- [ ] `bun test` (bot) — 33 pass
- [ ] `vitest run` (web) — 87+ pass

---

## 10. Riscos / edge cases

### R1 — Lead sem Conversation associada
Se a conversa ainda não foi iniciada, `supabase.from('Conversation').eq('chatId', lead.phone).single()` retorna `null`.  
**Mitigação:** `conv?.botPaused ?? false` — tratar null como não-pausado.

### R2 — PATCH pause-bot sem Conversation row
Se o lead nunca enviou mensagem, não há row em `Conversation`.  
**Mitigação:** endpoint usa `upsert` em vez de `update`:
```ts
await prisma.conversation.upsert({
  where: { chatId: lead.phone },
  create: { chatId: lead.phone, ownerId: lead.ownerId, data: {}, botPaused: paused },
  update: { botPaused: paused },
});
```

### R3 — `source` LLM vs `source` inicial (`'whatsapp'`)
O bot router cria leads com `source: 'whatsapp'` (canal de chegada). O LLM extrai a origem real (OLX, Zap, etc.).  
**Mitigação:** persistir `source` extraído apenas se `lead.source == null || lead.source == 'whatsapp'`. Não sobrescrever origem já corrigida manualmente pelo owner.

### R4 — Detect "primeira criação" no upsert
Prisma não distingue insert de update no retorno do upsert.  
**Mitigação:** comparar `createdAt` ≈ `updatedAt` (< 1s de diferença). Alternativa: query `count` antes do upsert dentro de `$transaction`. Usar a heurística temporal no MVP.

### R5 — `date-fns` disponível no web?
`formatDistanceToNow` depende de `date-fns`.  
**Mitigação:** verificar `apps/web/package.json`. Se ausente, usar alternativa simples: `new Intl.RelativeTimeFormat` ou string manual. Não adicionar dependência sem checar.

### R6 — import naming collision em `admin.ts`
`admin.ts` já tem função local `logActivity`. Importar `logActivity` de `services/activity.ts` com alias:
```ts
import { logActivity as logActivityHelper } from '@/services/activity';
```

---

## 11. Dependências / pré-condições

- Slice 0a aplicada (schema ActivityLog, sequences, ownerId em todas as tabelas)
- Slice 0b aplicada (`logActivity()` e `notifyOwner()` helpers existem)
- `Owner.notificationPhone` coluna existe
- Bot e web rodam sem erros antes desta slice

---

## 12. Out of scope (explícito)

- `lead_stage_changed` activity log
- Email diário de resumo (Resend)
- Filtros reais no kanban (botão stub apenas)
- Modal "Novo lead" funcional (stub "leads vêm via WhatsApp")
- Migrar calls `logActivity` legadas para novo helper (admin.ts existente)
- Testes de integração com banco (sem infra no projeto)
- MSW handlers para novos endpoints (opcional por slice, não obrigatório)
