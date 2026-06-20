# Funil de Lead — Sincroniza Conversa com Painel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer com que o card do lead no kanban reflita a conversa em tempo real: stage avança conforme o bot progride, nome é preenchido, source não é corrompido, e o proprietário pode arquivar leads de teste sem ir ao banco.

**Architecture:** Cinco correções cirúrgicas no bot (schema, buffer pipeline, `lead/index.ts`, agent prompts, admin route) + uma slice de UI no painel (query filter, API call, badge no card, botão de arquivar). Cada tarefa é independente e testável em isolamento.

**Tech Stack:** Bun · TypeScript strict · Prisma · Redis (ioredis) · Fastify · React 19 · TanStack Query · Supabase · Tailwind CSS v4 · Vitest

## Global Constraints

- Usar `bun` — nunca `npm` ou `yarn`
- Lint: Oxlint (`bunx oxlint`)
- TypeScript: `bunx tsc --noEmit` deve passar sem erros em cada tarefa
- Named exports em componentes React — nunca `export default`
- Sem cores hardcoded em componentes — usar CSS variables / Tailwind tokens
- Sem barrel files em pastas internas
- Commits por tarefa completa — nunca commitar tarefa parcial
- Working directory base: `/Users/fred-reis/Desktop/Projects/personal/kit-manager`

---

## File Map

| Arquivo | Tarefa | O que muda |
|---|---|---|
| `apps/bot/prisma/schema.prisma` | T1 | + `archivedAt DateTime?`, `reactivatedAt DateTime?` no model `Lead` |
| `packages/types/src/lead.ts` | T1 | + `archivedAt: string \| null`, `reactivatedAt: string \| null` na interface `Lead` |
| `apps/bot/src/webhooks/evolution.ts` | T2 | `dispatch()` passa `senderName` para `bufferMessage`/`bufferMedia` |
| `apps/bot/src/buffer.ts` | T2 | `bufferMessage`/`bufferMedia` aceitam `senderName`, armazenam em Redis `sender:{chatId}` |
| `apps/bot/src/flows/router.ts` | T2 | `routeMessage` recebe `senderName`, usa no `upsert.create`, reativa leads arquivados |
| `apps/bot/src/flows/lead/stage-map.ts` | T3 | **Novo** — `fsmStateToLeadStage()` exportada e testável |
| `apps/bot/src/flows/lead/__tests__/stage-map.test.ts` | T3 | **Novo** — testes unitários do mapa FSM→stage |
| `apps/bot/src/flows/lead/index.ts` | T3 | persiste `Lead.name`, remove dependência de nome em `visitRequested`, aplica stage map |
| `apps/bot/src/agents/lead.ts` | T4 | regra de `source` no extractor prompt; scheduling agent pede nome |
| `apps/bot/src/routes/admin.ts` | T5 | + `PATCH /admin/leads/:id/archive` |
| `apps/web/src/lib/queries.ts` | T6 | `fetchLeads` filtra `.is('archivedAt', null)` |
| `apps/web/src/lib/api.ts` | T6 | + `archiveLead(leadId, archived)` |
| `apps/web/src/components/lead-kanban-card.tsx` | T6 | badge "Reativado" quando `reactivatedAt != null` |
| `apps/web/src/routes/_dashboard/leads/$leadId.tsx` | T6 | botão "Arquivar lead" com confirmação |

---

## Task 1: Schema migration + shared types

**Files:**
- Modify: `apps/bot/prisma/schema.prisma` — adicionar 2 campos ao model `Lead`
- Create: migration via `bunx prisma migrate dev`
- Modify: `packages/types/src/lead.ts` — adicionar campos à interface `Lead`

**Interfaces:**
- Produces: `Lead.archivedAt` e `Lead.reactivatedAt` no banco e nos tipos — T2, T5, T6 dependem disso

- [ ] **Step 1: Adicionar campos ao schema Prisma**

Abrir `apps/bot/prisma/schema.prisma`. Localizar o model `Lead` (começa com `model Lead {`). Adicionar as duas linhas **antes** da linha `createdAt DateTime @default(now())`:

```prisma
  archivedAt    DateTime?
  reactivatedAt DateTime?
```

O bloco final do model `Lead` deve ficar assim (apenas as linhas novas e as já existentes de data):

```prisma
  archivedAt    DateTime?
  reactivatedAt DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
```

- [ ] **Step 2: Criar e aplicar a migration**

```bash
cd apps/bot && bunx prisma migrate dev --name lead_archive_fields
```

Resultado esperado:
```
✔ Generated Prisma Client
```

Se pedir nome da migration, digitar: `lead_archive_fields`

- [ ] **Step 3: Atualizar o tipo compartilhado `Lead`**

Abrir `packages/types/src/lead.ts`. Localizar a interface `Lead` e adicionar os dois campos após `updatedAt`:

```typescript
export interface Lead {
  id: string;
  ownerId: string;
  externalId: string | null;
  phone: string;
  name: string | null;
  source: LeadSource | null;
  propertyId: string | null;
  propertyExternalId: string | null;
  stage: LeadStage;
  contractUrl: string | null;
  autentiqueDocId: string | null;
  visitedAt: string | null;
  docsSentAt: string | null;
  contractSignedAt: string | null;
  archivedAt: string | null;       // ← novo
  reactivatedAt: string | null;    // ← novo
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Verificar tipos**

```bash
cd apps/bot && bunx tsc --noEmit
```

Esperado: sem erros. Se aparecer erro de campo desconhecido no Prisma Client, rodar `bunx prisma generate` primeiro.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/prisma/schema.prisma apps/bot/prisma/migrations packages/types/src/lead.ts
git commit -m "feat(schema): add archivedAt and reactivatedAt to Lead"
```

---

## Task 2: senderName pelo pipeline do buffer + reativação no router

**Files:**
- Modify: `apps/bot/src/webhooks/evolution.ts` — `dispatch()` passa `senderName`
- Modify: `apps/bot/src/buffer.ts` — armazenar/ler `senderName` no Redis
- Modify: `apps/bot/src/flows/router.ts` — usar `senderName`, reativar leads arquivados

**Interfaces:**
- Consumes: `Lead.archivedAt` e `Lead.reactivatedAt` do T1
- Produces: `routeMessage(chatId, text, mediaItems, senderName?)` — assinatura nova usada em T2

- [ ] **Step 1: Atualizar `evolution.ts` — passar senderName para o buffer**

Abrir `apps/bot/src/webhooks/evolution.ts`. Localizar a função `dispatch` (linha ~114). Substituir o bloco inteiro:

```typescript
async function dispatch(inbound: InboundMessage): Promise<void> {
  const { chatId, messageId, messageType, text, mediaMime, mediaBase64, senderName } = inbound;

  if (messageType === 'text' && text) {
    await bufferMessage(chatId, text, messageId, senderName);
    return;
  }

  if (messageType === 'audio') {
    await bufferMedia(
      chatId,
      { type: 'audio', mime: mediaMime ?? undefined, messageId: messageId ?? undefined },
      text ?? undefined,
      messageId,
      senderName,
    );
    return;
  }

  if ((messageType === 'image' || messageType === 'document') && mediaBase64) {
    await bufferMedia(
      chatId,
      {
        type: messageType,
        mime: mediaMime ?? undefined,
        base64: mediaBase64,
        messageId: messageId ?? undefined,
      },
      text ?? undefined,
      messageId,
      senderName,
    );
    return;
  }
}
```

- [ ] **Step 2: Atualizar `buffer.ts` — armazenar e ler senderName**

Abrir `apps/bot/src/buffer.ts`.

**2a.** Adicionar helper interno após as imports, antes de `debounceHandles`:

```typescript
async function storeSenderName(chatId: string, name: string | null | undefined): Promise<void> {
  if (!name) return;
  await redis.set(`sender:${chatId}`, name, 'EX', config.BUFFER_TTL_SECONDS);
}
```

**2b.** Atualizar assinatura de `bufferMessage` — adicionar `senderName` opcional:

```typescript
export async function bufferMessage(
  chatId: string,
  message: string,
  messageId: string | null = null,
  senderName?: string | null,
): Promise<void> {
  if (await isDuplicateMessage(chatId, messageId)) {
    logger.warn({ chatId, messageId }, '[buffer] Duplicate message ignored');
    return;
  }

  const bufferKey = `msg_buffer:${chatId}`;
  await redis.rpush(bufferKey, message);
  await redis.expire(bufferKey, config.BUFFER_TTL_SECONDS);

  await storeSenderName(chatId, senderName);  // ← novo

  resetDebounce(chatId);
}
```

**2c.** Atualizar assinatura de `bufferMedia` — adicionar `senderName` opcional:

```typescript
export async function bufferMedia(
  chatId: string,
  media: MediaItem,
  message?: string,
  messageId?: string | null,
  senderName?: string | null,    // ← novo
): Promise<void> {
```

Dentro de `bufferMedia`, adicionar `await storeSenderName(chatId, senderName);` logo após a linha `await redis.expire(mediaKey, config.BUFFER_TTL_SECONDS);` no final da função (antes do `resetDebounce(chatId);`).

**2d.** Atualizar `flushAndProcess` — ler senderName e passar para routeMessage:

```typescript
async function flushAndProcess(chatId: string): Promise<void> {
  debounceHandles.delete(chatId);

  const bufferKey = `msg_buffer:${chatId}`;
  const mediaKey = `media_buffer:${chatId}`;

  const [messages, mediaRows, senderName] = await Promise.all([
    redis.lrange(bufferKey, 0, -1),
    redis.lrange(mediaKey, 0, -1),
    redis.get(`sender:${chatId}`),   // ← novo
  ]);

  await Promise.all([redis.del(bufferKey), redis.del(mediaKey)]);

  const text = messages.join(' ').trim() || null;
  const mediaItems: MediaItem[] = mediaRows.map((row) => JSON.parse(row) as MediaItem);

  if (!text && mediaItems.length === 0) return;

  logger.info({ chatId, mediaCount: mediaItems.length }, '[buffer] Processing');

  const { routeMessage } = await import('@/flows/router');
  await routeMessage(chatId, text, mediaItems, senderName ?? null);  // ← novo arg
}
```

- [ ] **Step 3: Atualizar `router.ts` — usar senderName e reativar leads arquivados**

Abrir `apps/bot/src/flows/router.ts`. Substituir o arquivo inteiro:

```typescript
import type { MediaItem } from '@/buffer';
import { prisma } from '@/db/client';
import { handleLeadMessage } from '@/flows/lead/index';
import { handleTenantMessage } from '@/flows/tenant/index';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';

export async function routeMessage(
  chatId: string,
  text: string | null,
  mediaItems: MediaItem[],
  senderName?: string | null,
): Promise<void> {
  const owner = await prisma.owner.findFirst();
  if (!owner) {
    logger.error('[router] No owner record found — cannot route message');
    return;
  }

  const [existingLead, tenant, conversation] = await Promise.all([
    prisma.lead.findUnique({
      where: { phone: chatId },
      select: { id: true, archivedAt: true },
    }),
    prisma.tenant.findUnique({ where: { phone: chatId } }),
    prisma.conversation.findUnique({ where: { chatId }, select: { botPaused: true } }),
  ]);

  if (tenant) {
    await handleTenantMessage(chatId, text);
    return;
  }

  if (conversation?.botPaused) {
    logger.info({ chatId }, '[router] Bot paused — message suppressed');
    return;
  }

  const isNew = !existingLead;
  const isReactivation = !!existingLead?.archivedAt;

  const lead = await prisma.lead.upsert({
    where: { phone: chatId },
    update: isReactivation ? { archivedAt: null, reactivatedAt: new Date() } : {},
    create: {
      phone: chatId,
      stage: 'interest',
      source: 'whatsapp',
      ownerId: owner.id,
      name: senderName ?? null,
    },
  });

  if (isNew) {
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_created',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_created failed'));
  } else if (isReactivation) {
    logActivity({
      ownerId: owner.id,
      actorType: 'bot',
      actorLabel: 'Bot',
      action: 'lead_reactivated',
      subjectType: 'lead',
      subjectId: lead.id,
      subject: lead.name ?? chatId,
    }).catch((err) => logger.error({ err }, '[router] logActivity lead_reactivated failed'));
  }

  await handleLeadMessage(chatId, text, mediaItems, owner.id);
}
```

- [ ] **Step 4: Verificar tipos**

```bash
cd apps/bot && bunx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/webhooks/evolution.ts apps/bot/src/buffer.ts apps/bot/src/flows/router.ts
git commit -m "feat(bot): propagate senderName through buffer pipeline; reactivate archived leads"
```

---

## Task 3: FSM→stage map + Lead.name persistence + visitRequested fix

**Files:**
- Create: `apps/bot/src/flows/lead/stage-map.ts`
- Create: `apps/bot/src/flows/lead/__tests__/stage-map.test.ts`
- Modify: `apps/bot/src/flows/lead/index.ts`

**Interfaces:**
- Consumes: `TERMINAL_STAGES` de `./kyc`; `LeadStage` de `@kit-manager/types`
- Produces: `fsmStateToLeadStage(fsmState: string, currentStage: string): LeadStage | null`

- [ ] **Step 1: Criar `stage-map.ts`**

Criar novo arquivo `apps/bot/src/flows/lead/stage-map.ts`:

```typescript
import type { LeadStage } from '@kit-manager/types';
import { TERMINAL_STAGES } from './kyc';

const FSM_TO_STAGE: Partial<Record<string, LeadStage>> = {
  'lead.start': 'interest',
  'lead.offer_options': 'interest',
  'lead.property_info': 'interest',
  'lead.objection_handling': 'interest',
  'lead.visit_scheduling': 'visiting',
  'lead.visit_requested': 'visiting',
  'lead.post_visit_decision': 'collection',
  'lead.collect_application': 'collection',
  'lead.review_submitted': 'review_submitted',
};

/**
 * Mapeia estado do FSM de conversa para LeadStage do banco.
 * Retorna null se o stage atual for terminal (não regride KYC em diante).
 */
export function fsmStateToLeadStage(fsmState: string, currentStage: string): LeadStage | null {
  if (TERMINAL_STAGES.has(currentStage)) return null;
  return FSM_TO_STAGE[fsmState] ?? null;
}
```

- [ ] **Step 2: Criar os testes unitários**

Criar pasta `apps/bot/src/flows/lead/__tests__/` se não existir. Criar arquivo `apps/bot/src/flows/lead/__tests__/stage-map.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { fsmStateToLeadStage } from '../stage-map';

describe('fsmStateToLeadStage', () => {
  it('mapeia lead.visit_scheduling para visiting', () => {
    expect(fsmStateToLeadStage('lead.visit_scheduling', 'interest')).toBe('visiting');
  });

  it('mapeia lead.visit_requested para visiting', () => {
    expect(fsmStateToLeadStage('lead.visit_requested', 'interest')).toBe('visiting');
  });

  it('mapeia estados de informação para interest', () => {
    expect(fsmStateToLeadStage('lead.start', 'interest')).toBe('interest');
    expect(fsmStateToLeadStage('lead.property_info', 'interest')).toBe('interest');
    expect(fsmStateToLeadStage('lead.offer_options', 'interest')).toBe('interest');
    expect(fsmStateToLeadStage('lead.objection_handling', 'interest')).toBe('interest');
  });

  it('mapeia estados pós-visita para collection', () => {
    expect(fsmStateToLeadStage('lead.post_visit_decision', 'visiting')).toBe('collection');
    expect(fsmStateToLeadStage('lead.collect_application', 'visiting')).toBe('collection');
  });

  it('mapeia lead.review_submitted para review_submitted', () => {
    expect(fsmStateToLeadStage('lead.review_submitted', 'collection')).toBe('review_submitted');
  });

  it('retorna null para stage terminal (não regride kyc_pending)', () => {
    expect(fsmStateToLeadStage('lead.visit_scheduling', 'kyc_pending')).toBeNull();
    expect(fsmStateToLeadStage('lead.start', 'contract_signed')).toBeNull();
    expect(fsmStateToLeadStage('lead.property_info', 'converted')).toBeNull();
  });

  it('retorna null para estado FSM desconhecido', () => {
    expect(fsmStateToLeadStage('lead.unknown_state', 'interest')).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar os testes para verificar que passam**

```bash
cd apps/bot && bun test src/flows/lead/__tests__/stage-map.test.ts
```

Esperado: 8 testes passando.

- [ ] **Step 4: Atualizar `lead/index.ts` — três mudanças cirúrgicas**

Abrir `apps/bot/src/flows/lead/index.ts`.

**4a.** Adicionar import de `fsmStateToLeadStage` no topo (junto dos outros imports de flows/lead):

```typescript
import { fsmStateToLeadStage } from '@/flows/lead/stage-map';
```

**4b.** Localizar a condição de `visitRequested` (linha ~210). Remover a dependência de `context.name`:

Antes:
```typescript
if (context.visitedProperty === false && context.wantsSchedule && context.name) {
  context.visitRequested = true;
} else if (context.visitedProperty !== false) {
  context.visitRequested = false;
}
```

Depois:
```typescript
if (context.visitedProperty === false && context.wantsSchedule) {
  context.visitRequested = true;
} else if (context.visitedProperty !== false) {
  context.visitRequested = false;
}
```

**4c.** Localizar o bloco `if (Object.keys(leadPatch).length > 0)` (linha ~246). **Antes** desse bloco, adicionar as duas linhas de enriquecimento:

```typescript
// Persistir nome extraído pelo LLM
if (context.name && context.name !== lead.name) {
  leadPatch.name = context.name;
}

// Sincronizar Lead.stage com o estado da conversa
const mappedStage = fsmStateToLeadStage(snapshot.state, lead.stage);
if (mappedStage && mappedStage !== lead.stage) {
  leadPatch.stage = mappedStage;
}

if (Object.keys(leadPatch).length > 0) {
  await prisma.lead.update({ where: { phone: chatId }, data: leadPatch });
}
```

- [ ] **Step 5: Verificar tipos**

```bash
cd apps/bot && bunx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/flows/lead/stage-map.ts apps/bot/src/flows/lead/__tests__/stage-map.test.ts apps/bot/src/flows/lead/index.ts
git commit -m "feat(bot): sync Lead.stage with FSM; persist Lead.name; fix visitRequested"
```

---

## Task 4: Correções nos prompts dos agentes

**Files:**
- Modify: `apps/bot/src/agents/lead.ts`

**Interfaces:**
- Nenhuma dependência de T1-T3. Pode ser executada em qualquer ordem após T1.

- [ ] **Step 1: Corrigir regra de `source` no extractor prompt**

Abrir `apps/bot/src/agents/lead.ts`. Localizar `EXTRACTOR_SYSTEM_PROMPT`. Localizar a linha:

```
- Para property_interest: se a mensagem pede informacao, video, foto, visita...
```

Adicionar **depois** dessa linha (antes do fechamento da template string `` ` ``):

```
- Para source: preencha APENAS quando o lead citar explicitamente o portal ou canal pelo qual encontrou o imóvel (exemplos: "vi no OLX", "achei no Zap Imóveis", "vi no Instagram", "me indicaram", "vi no seu site"). Contato direto pelo WhatsApp sem menção de origem → retornar null. "Zap", "mandei um zap", "fiz um zap" são gíria para WhatsApp — não equivalem ao portal Zap Imóveis. Só preencher source = "zap" se o lead disser literalmente "Zap Imóveis" ou "portal Zap".`;
```

- [ ] **Step 2: Atualizar o agente de agendamento para pedir nome**

Localizar `SCHEDULING_AGENT_PROMPT`. Localizar a linha:

```
- Seja pratico, cordial e breve.
```

Adicionar antes do fechamento da template string:

```
- Se o contexto indicar que o nome do lead ainda não é conhecido (campo "Nome conhecido: não informado"), pergunte o nome de forma natural durante o agendamento. Exemplo: "Para confirmar sua visita, qual o seu nome?". Faça isso apenas uma vez; se já souber o nome, não pergunte de novo.`;
```

- [ ] **Step 3: Verificar tipos**

```bash
cd apps/bot && bunx tsc --noEmit
```

Esperado: sem erros (são mudanças de string).

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/agents/lead.ts
git commit -m "fix(bot): restrict source extraction to explicit portal mentions; ask name during scheduling"
```

---

## Task 5: Endpoint admin de arquivar lead

**Files:**
- Modify: `apps/bot/src/routes/admin.ts`

**Interfaces:**
- Consumes: `Lead.archivedAt` do T1 (campo já existe no banco)
- Produces: `PATCH /admin/leads/:id/archive` com body `{ archived: boolean }`

- [ ] **Step 1: Adicionar o endpoint de arquivamento**

Abrir `apps/bot/src/routes/admin.ts`. Localizar o endpoint `pause-bot` (linha ~121). Adicionar **após o bloco completo** desse endpoint (após o `});` que fecha o handler de pause-bot):

```typescript
  // ─── archive / unarchive lead ─────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { archived: boolean } }>(
    '/admin/leads/:id/archive',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { archived } = request.body;

      if (typeof archived !== 'boolean') {
        return reply.status(400).send({ error: 'archived must be a boolean' });
      }

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: { name: true, phone: true, ownerId: true },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });

      const updated = await prisma.lead.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
      });

      const action = archived ? 'lead_archived' : 'lead_unarchived';
      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action,
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send(updated);
    },
  );
```

- [ ] **Step 2: Verificar tipos**

```bash
cd apps/bot && bunx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 3: Testar o endpoint manualmente**

Com o bot rodando localmente (`cd apps/bot && bun run dev`), obter o JWT do painel (DevTools → Network → qualquer request ao bot → copiar `Authorization: Bearer ...`). Então:

```bash
# Substituir <JWT> pelo token e <LEAD_ID> por um UUID real da tabela Lead
curl -X PATCH http://localhost:3000/admin/leads/<LEAD_ID>/archive \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"archived": true}'
```

Esperado: resposta JSON com `"archivedAt": "<timestamp>"`.

```bash
# Verificar no Supabase SQL Editor:
SELECT id, phone, "archivedAt" FROM "Lead" WHERE id = '<LEAD_ID>';
```

Esperado: `archivedAt` preenchido.

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/routes/admin.ts
git commit -m "feat(admin): add PATCH /admin/leads/:id/archive endpoint"
```

---

## Task 6: Web — query filter, API call, badge no card, botão de arquivar

**Files:**
- Modify: `apps/web/src/lib/queries.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/lead-kanban-card.tsx`
- Modify: `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

**Interfaces:**
- Consumes: `Lead.archivedAt` e `Lead.reactivatedAt` de T1; endpoint `PATCH /admin/leads/:id/archive` de T5

- [ ] **Step 1: Filtrar leads arquivados em `fetchLeads`**

Abrir `apps/web/src/lib/queries.ts`. Localizar `fetchLeads` (linha ~32). Adicionar `.is('archivedAt', null)` antes de `.order(...)`:

```typescript
export async function fetchLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select('*, property:Property(externalId)')
    .is('archivedAt', null)                        // ← novo
    .order('updatedAt', { ascending: false })
    .limit(100);
  if (error) throw error;
  return ((data ?? []) as LeadRow[]).map(mapLeadRow);
}
```

Nota: `mapLeadRow` usa spread (`{ ...row, ... }`) — os novos campos `archivedAt` e `reactivatedAt` propagam automaticamente sem alteração na função.

- [ ] **Step 2: Adicionar `archiveLead` à API client**

Abrir `apps/web/src/lib/api.ts`. Localizar `pauseLead` (linha ~94). Adicionar após essa linha:

```typescript
  archiveLead: (leadId: string, archived: boolean) =>
    botApi.patch(`/admin/leads/${leadId}/archive`, { archived }),
```

- [ ] **Step 3: Adicionar badge "Reativado" no card do kanban**

Abrir `apps/web/src/components/lead-kanban-card.tsx`. Substituir o bloco `<div className="mt-2 flex flex-wrap gap-1">` pelo seguinte:

```tsx
      <div className="mt-2 flex flex-wrap gap-1">
        {lead.reactivatedAt && (
          <span
            title={`Reativado em ${new Date(lead.reactivatedAt).toLocaleDateString('pt-BR')}`}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
          >
            Reativado
          </span>
        )}
        {lead.source && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {SOURCE_LABELS[lead.source]}
          </span>
        )}
        {lead.propertyExternalId && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-medium text-accent-ink">
            {lead.propertyExternalId}
          </span>
        )}
      </div>
```

- [ ] **Step 4: Adicionar botão de arquivar no detalhe do lead**

Abrir `apps/web/src/routes/_dashboard/leads/$leadId.tsx`.

**4a.** Localizar os imports de Lucide no topo e adicionar `Archive`:

```typescript
import { AlertCircle, Archive, CheckCircle, ChevronLeft, FileText } from 'lucide-react';
```

**4b.** Dentro da função `LeadDetailPage`, após a declaração do `queryClient` (ou onde estão os outros `useMutation`), adicionar a mutation de arquivamento. Procurar um bloco `useMutation` existente e adicionar após ele:

```typescript
  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => adminApi.archiveLead(lead.id, archived),
    onSuccess: (_, archived) => {
      toast.success(archived ? 'Lead arquivado.' : 'Lead reativado.');
      void qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao arquivar lead.')),
  });
```

**4c.** Localizar onde o botão de "Pausar bot" é renderizado na UI. Adicionar o botão de arquivar **abaixo** dele (ou numa área de ações perigosas):

```tsx
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Zona de risco
            </p>
            {lead.archivedAt ? (
              <CustomButton
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm('Reativar este lead?')) archiveMutation.mutate(false);
                }}
                disabled={archiveMutation.isPending}
              >
                <Archive className="mr-1.5 size-3.5" />
                Reativar lead
              </CustomButton>
            ) : (
              <CustomButton
                variant="outline"
                size="sm"
                className="text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (confirm('Arquivar este lead? Ele vai sumir do kanban mas pode ser reativado pelo WhatsApp ou manualmente.')) {
                    archiveMutation.mutate(true);
                  }
                }}
                disabled={archiveMutation.isPending}
              >
                <Archive className="mr-1.5 size-3.5" />
                Arquivar lead
              </CustomButton>
            )}
          </div>
```

- [ ] **Step 5: Verificar tipos no web**

```bash
cd apps/web && bunx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/queries.ts apps/web/src/lib/api.ts apps/web/src/components/lead-kanban-card.tsx apps/web/src/routes/_dashboard/leads/\$leadId.tsx
git commit -m "feat(web): hide archived leads; add archive button and reactivated badge"
```

---

## Self-Review

**Cobertura do spec:**
- ✅ Lead.archivedAt, Lead.reactivatedAt — T1
- ✅ pushName via senderName → Lead.name no create — T2
- ✅ Reativação de lead arquivado pelo bot — T2
- ✅ Lead.name persistido quando LLM extrai explicitamente — T3
- ✅ visitRequested desacoplado de context.name — T3
- ✅ FSM state → Lead.stage sincronizado por turno, sem regredir terminais — T3
- ✅ source só preenche com menção explícita de portal — T4
- ✅ Scheduling agent pede nome quando desconhecido — T4
- ✅ PATCH /admin/leads/:id/archive — T5
- ✅ Activity log lead_archived, lead_unarchived, lead_reactivated — T2+T5
- ✅ fetchLeads filtra archivedAt null — T6
- ✅ archiveLead na API client — T6
- ✅ Badge "Reativado" no card kanban — T6
- ✅ Botão arquivar/reativar no detalhe — T6
- 🔶 Badge "KYC negado" — adiado: precisa de ação lead_kyc_rejected no ActivityLog que ainda não existe no fluxo

**Tipos consistentes:**
- `fsmStateToLeadStage(fsmState: string, currentStage: string): LeadStage | null` — definido em T3, usado em T3
- `archiveLead(leadId: string, archived: boolean)` — definido em T6 api.ts, usado em T6 $leadId.tsx
- `Lead.archivedAt: string | null` — definido em T1, usado em T2 (router), T5 (admin), T6 (queries filter + badge logic)

**Sem placeholders:** confirmado.
