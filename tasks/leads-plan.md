# Plan: Slice 1 — Leads (kanban + detalhe + pausar bot)

> Spec: [specs/leads.md](../specs/leads.md)
> Objetivo: bot extrai source/propertyId, admin pausa bot por conversa, kanban e detalhe mostram dados enriquecidos.

---

## Grafo de dependências

```
T01 (Migration + Types)
  ├── T02 (Bot router: botPaused check + lead_created log)
  ├── T03 (Bot flow: source persist + propertyId + kyc_pending stage + notify)
  ├── T04 (Bot endpoint: PATCH pause-bot)
  └── T05 (Web foundation: lead-utils + SOURCE_LABELS + api.ts)
        ├── T06 (Web queries: fetchLead + botPaused) ←── T01
        ├── T07 (Web kanban card: externalId) ←── T05
        └── T08 (Web detail: source dropdown + pause toggle + badge) ←── T04, T05, T06
```

**Execução sequencial obrigatória:** T01 → (T02, T03, T04, T05 podem ser feitos em sequência) → T06 → T07 → T08.

---

## Fase 1 — Fundação (schema + tipos)

---

### T01 — Migration `Conversation.botPaused` + atualizar tipos

**Descrição:** Criar a migration que adiciona `botPaused boolean NOT NULL DEFAULT false` em `Conversation`. Atualizar `LeadSource` com os novos valores (`olx`, `outro`, `desconhecido`) e criar o tipo `Conversation` em `packages/types`.

**Arquivos afetados:**
- `apps/bot/prisma/schema.prisma` — adicionar `botPaused Boolean @default(false)` em `Conversation`
- `apps/bot/prisma/migrations/<timestamp>_leads_slice_conversation_bot_paused/migration.sql` — `ALTER TABLE "Conversation" ADD COLUMN "botPaused" BOOLEAN NOT NULL DEFAULT false`
- `packages/types/src/lead.ts` — expandir `LeadSource` union + adicionar `Conversation` interface
- `packages/types/src/index.ts` — exportar `Conversation` se movido para arquivo separado (ou deixar em `lead.ts`)

**Critério de pronto:**
- [x] `prisma migrate dev` aplica migration sem erro
- [x] `Conversation` tem coluna `botPaused` no banco (verificar via `prisma studio` ou query)
- [x] `LeadSource` inclui `'olx' | 'outro' | 'desconhecido'`
- [x] `Conversation` interface exportada de `@kit-manager/types`
- [x] `bunx tsc --noEmit` verde nos 3 pacotes (packages/types, apps/bot, apps/web)

**Verificação:**
```bash
cd apps/bot && bunx prisma migrate dev --name leads_slice_conversation_bot_paused
cd packages/types && bun run typecheck
cd apps/bot && bun run typecheck
cd apps/web && bun run typecheck
```

**Dependências:** Slice 0a e 0b aplicadas.
**Escopo:** S (3 arquivos + migration SQL).

---

## Checkpoint 1 — Após T01

- [x] Migration aplicada sem erros
- [x] Todos os typechecks verdes
- [x] Bot roda sem erros: `bun run dev`

---

## Fase 2 — Bot (paralelas entre si, sequenciais com T01)

---

### T02 — Bot router: verificar `botPaused` + logar `lead_created`

**Descrição:** Antes de chamar `handleLeadMessage`, verificar se `Conversation.botPaused === true` — se sim, criar `Event` de supressão e retornar sem invocar o LLM. Também detectar primeira criação do lead (via `findUnique` antes do `upsert`) e logar `lead_created` via `logActivity` helper.

**Arquivos afetados:**
- `apps/bot/src/flows/router.ts`

**Mudanças:**
1. `findUnique` antes do `upsert` para detectar nova criação
2. Após `upsert`: se `!existing` → `logActivity('lead_created', ...)` com `.catch(console.error)`
3. Após upsert: buscar `Conversation` via `prisma.conversation.findUnique({ where: { chatId } })`
4. Se `conversation?.botPaused === true` → `prisma.event.create(...)` + `return` (sem handleLeadMessage)

**Critério de pronto:**
- [x] Se `botPaused === true`, mensagem não chega ao LLM (confirmado por log de supressão)
- [x] `lead_created` logado exatamente uma vez por lead (primeira mensagem)
- [x] `bunx tsc --noEmit` verde em `apps/bot`
- [x] `bun run lint:bot` — 0 novos errors

**Verificação:**
```bash
cd apps/bot && bun run typecheck
bun run lint:bot
```

**Dependências:** T01 (campo `botPaused` no Prisma schema).
**Escopo:** S (1 arquivo, ~30 linhas).

---

### T03 — Bot flow: persistir `source` + `propertyId` + kyc_pending stage + `notifyOwner`

**Descrição:** Adicionar `source` ao `LeadExtractionSchema` Zod. Após extração LLM, persistir `Lead.source` se for primeira detecção. Persistir `Lead.propertyId` quando o imóvel em foco muda. Detectar `docsStage === 'complete'` → transitar `Lead.stage` para `kyc_pending` e chamar `notifyOwner`.

**Arquivos afetados:**
- `apps/bot/src/agents/lead.ts` — adicionar `source` ao `LeadExtractionSchema`
- `apps/bot/src/flows/lead/index.ts` — persistir source, propertyId, detectar kyc_pending

**Mudanças em `agents/lead.ts`:**
```ts
// Dentro de LeadExtractionSchema:
source: z.enum(['olx','zap','site','instagram','indicacao','outro','desconhecido']).nullable().default(null),
```

**Mudanças em `flows/lead/index.ts`** (após step 5, extração LLM):
```ts
// Persistir source (primeira detecção)
if (extracted.source && (!lead.source || lead.source === 'whatsapp')) {
  await prisma.lead.update({ where: { phone: chatId }, data: { source: extracted.source } });
}

// Persistir propertyId (quando foco muda)
if (snapshot.propertyInFocus?.id && snapshot.propertyInFocus.id !== lead.propertyId) {
  await prisma.lead.update({ where: { phone: chatId }, data: { propertyId: snapshot.propertyInFocus.id } });
}

// Transitar para kyc_pending quando docs completos
const TERMINAL_STAGES = ['kyc_pending','kyc_approved','residents_docs_complete','contract_pending','contract_signed','converted'];
if (snapshot.docsStage === 'complete' && !TERMINAL_STAGES.includes(lead.stage)) {
  await prisma.lead.update({ where: { phone: chatId }, data: { stage: 'kyc_pending' } });
  notifyOwner(lead.ownerId, 'kyc_pending', {
    leadName: lead.name ?? chatId,
    leadPhone: chatId,
  }).catch(console.error);
}
```

**Teste RED/GREEN (bot):**
Adicionar em `apps/bot/src/__tests__/` teste que valida o schema Zod:
```ts
// lead-extraction-schema.test.ts
test('aceita source válido', () => {
  const result = LeadExtractionSchema.parse({ source: 'olx' });
  expect(result.source).toBe('olx');
});
test('source null por default', () => {
  const result = LeadExtractionSchema.parse({});
  expect(result.source).toBeNull();
});
test('rejeita source inválido', () => {
  expect(() => LeadExtractionSchema.parse({ source: 'facebook' })).toThrow();
});
```

> `LeadExtractionSchema` precisará ser exportado de `agents/lead.ts` para o teste.

**Critério de pronto:**
- [x] `LeadExtractionSchema` tem campo `source` com enum correto
- [x] Testes Zod passam: `bun test src/__tests__/lead-extraction-schema.test.ts`
- [x] `Lead.source` persistido corretamente (1ª detecção, não sobrescreve)
- [x] `Lead.propertyId` persistido quando foco muda
- [x] `Lead.stage` transita para `kyc_pending` quando `docsStage === 'complete'`
- [x] `bunx tsc --noEmit` verde em `apps/bot`

**Verificação:**
```bash
cd apps/bot && bun test src/__tests__
bun run typecheck
```

**Dependências:** T01.
**Escopo:** M (2 arquivos principais + 1 arquivo de teste).

---

### T04 — Bot endpoints: `PATCH /admin/leads/:id/pause-bot` + `PATCH /admin/leads/:id`

**Descrição:** Dois novos endpoints no `admin.ts`. (1) `pause-bot`: recebe `{ paused: boolean }`, faz upsert na `Conversation`, loga `bot_paused`/`bot_resumed`. (2) `PATCH /admin/leads/:id`: recebe `{ source? }` para correção manual de source — não existe atualmente, necessário para o source dropdown no web.

**Arquivos afetados:**
- `apps/bot/src/routes/admin.ts`

**Mudanças:**
```ts
import { logActivity as logActivityHelper } from '@/services/activity';

fastify.patch<{ Params: { id: string }; Body: { paused: boolean } }>(
  '/admin/leads/:id/pause-bot',
  { preHandler: verifyAdminJwt },
  async (request, reply) => {
    const { id } = request.params;
    const { paused } = request.body;

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { phone: true, name: true, ownerId: true },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });

    await prisma.conversation.upsert({
      where: { chatId: lead.phone },
      create: { chatId: lead.phone, ownerId: lead.ownerId, data: {}, botPaused: paused },
      update: { botPaused: paused },
    });

    await logActivityHelper({
      ownerId: lead.ownerId,
      actorType: 'user',
      actorLabel: request.adminUserId ?? 'Admin',
      action: paused ? 'bot_paused' : 'bot_resumed',
      subjectType: 'lead',
      subjectId: id,
      subject: lead.name ?? lead.phone,
    }).catch(fastify.log.warn.bind(fastify.log));

    return reply.send({ paused });
  },
);
```

**Critério de pronto:**
- [x] `PATCH /admin/leads/:id/pause-bot` retorna `{ paused: boolean }`
- [x] Se lead não existe → 404
- [x] `Conversation.botPaused` atualizado (upsert — funciona mesmo sem Conversation prévia)
- [x] Activity log `bot_paused` / `bot_resumed` emitido
- [x] `bunx tsc --noEmit` verde em `apps/bot`

**Verificação:**
```bash
cd apps/bot && bun run typecheck
bun run lint:bot
```

**Dependências:** T01.
**Escopo:** S (1 arquivo, ~35 linhas).

---

## Checkpoint 2 — Após T02, T03, T04

- [x] `bun test src/__tests__` (bot): 35+ pass (inclui novos testes Zod)
- [x] `bun run typecheck` (bot): verde
- [x] `bun run lint:bot`: 0 novos errors
- [x] Bot sobe sem erros: `bun run dev`

---

## Fase 3 — Web

---

### T05 — Web foundation: `lead-utils.ts` + `SOURCE_LABELS` + `api.ts`

**Descrição:** Criar `lib/lead-utils.ts` com `stageToColumn()`. Expandir `SOURCE_LABELS` com novos valores. Adicionar `pauseLead` e `updateLeadSource` no `api.ts`.

**Arquivos afetados:**
- `apps/web/src/lib/lead-utils.ts` — CRIAR
- `apps/web/src/lib/leads.ts` — expandir `SOURCE_LABELS`
- `apps/web/src/lib/api.ts` — adicionar `pauseLead`, `updateLeadSource`

**Teste RED/GREEN:**

Criar `apps/web/src/__tests__/lead-utils.test.ts`:
```ts
import { describe, test, expect } from 'vitest';
import { stageToColumn } from '@/lib/lead-utils';
import type { LeadStage } from '@kit-manager/types';

const ALL_STAGES: LeadStage[] = [
  'interest', 'collection', 'review_submitted', 'visiting',
  'kyc_pending', 'kyc_approved', 'residents_docs_complete',
  'contract_pending', 'contract_signed', 'converted',
];

describe('stageToColumn', () => {
  test('interest → novo', () => expect(stageToColumn('interest')).toBe('novo'));
  test('collection → qualificacao', () => expect(stageToColumn('collection')).toBe('qualificacao'));
  test('review_submitted → qualificacao', () => expect(stageToColumn('review_submitted')).toBe('qualificacao'));
  test('visiting → visita', () => expect(stageToColumn('visiting')).toBe('visita'));
  test('kyc_pending → proposta', () => expect(stageToColumn('kyc_pending')).toBe('proposta'));
  test('kyc_approved → proposta', () => expect(stageToColumn('kyc_approved')).toBe('proposta'));
  test('residents_docs_complete → proposta', () => expect(stageToColumn('residents_docs_complete')).toBe('proposta'));
  test('contract_pending → proposta', () => expect(stageToColumn('contract_pending')).toBe('proposta'));
  test('contract_signed → proposta', () => expect(stageToColumn('contract_signed')).toBe('proposta'));
  test('converted → ganho', () => expect(stageToColumn('converted')).toBe('ganho'));
  test('todos os 10 stages têm mapeamento', () => {
    for (const stage of ALL_STAGES) {
      expect(['novo','qualificacao','visita','proposta','ganho']).toContain(stageToColumn(stage));
    }
  });
});
```

Atualizar `apps/web/src/__tests__/lead-source.test.ts` com novos valores:
```ts
test('maps olx to OLX', () => expect(SOURCE_LABELS.olx).toBe('OLX'));
test('maps outro to Outro', () => expect(SOURCE_LABELS.outro).toBe('Outro'));
test('maps desconhecido to ?', () => expect(SOURCE_LABELS.desconhecido).toBe('?'));
```

**Critério de pronto:**
- [x] `stageToColumn` cobre todos os 10 stages de `LeadStage`
- [x] `SOURCE_LABELS` cobre `olx`, `outro`, `desconhecido`
- [x] `api.ts` exporta `pauseLead(id, paused)` e `updateLeadSource(id, source)`
- [x] Todos os testes passam: `vitest run`
- [x] `bun run typecheck` (web): verde

**Verificação:**
```bash
cd apps/web && vitest run
bun run typecheck
```

**Dependências:** T01 (para que `LeadSource` tenha os novos valores).
**Escopo:** M (3 arquivos + 2 arquivos de teste).

---

### T06 — Web queries: `fetchLead` retorna `botPaused`

**Descrição:** Atualizar `fetchLead` para buscar `Conversation(botPaused)` em paralelo via `lead.phone`, retornando `Lead & { botPaused: boolean }`.

**Arquivos afetados:**
- `apps/web/src/lib/queries.ts`

**Mudanças:**
```ts
export async function fetchLead(id: string): Promise<Lead & { botPaused: boolean; documents: LeadDocument[] }> {
  const { data: lead, error } = await supabase
    .from('Lead')
    .select('*, property:Property(externalId)')
    .eq('id', id)
    .single();
  if (error) throw error;

  const [{ data: docs }, { data: conv }] = await Promise.all([
    supabase.from('LeadDocument').select('*').eq('leadId', id).order('createdAt', { ascending: true }),
    supabase.from('Conversation').select('botPaused').eq('chatId', lead.phone).maybeSingle(),
  ]);

  return {
    ...mapLeadRow(lead),
    botPaused: conv?.botPaused ?? false,
    documents: docs ?? [],
  };
}
```

**Critério de pronto:**
- [x] `fetchLead` retorna `botPaused: boolean`
- [x] `botPaused` é `false` quando não há Conversation (`.maybeSingle()` retorna `null`)
- [x] `bun run typecheck` (web): verde

**Verificação:**
```bash
cd apps/web && bun run typecheck
```

**Dependências:** T01.
**Escopo:** XS (1 arquivo, ~10 linhas).

---

### T07 — Web kanban card: adicionar `externalId`

**Descrição:** O `LeadKanbanCard` já tem source chip, tempo relativo e propertyExternalId. Falta o `Lead.externalId` (ex: `LD-0001`) em mono muted. Adicionar abaixo do nome/phone.

**Arquivos afetados:**
- `apps/web/src/components/lead-kanban-card.tsx`

**Mudança:** Adicionar após o nome/phone:
```tsx
{lead.externalId && (
  <p className="font-mono text-[10px] text-muted-foreground/60">{lead.externalId}</p>
)}
```

**Critério de pronto:**
- [x] `lead.externalId` renderizado quando não-null
- [x] Não quebra cards sem externalId (nullable)
- [x] `bun run typecheck` (web): verde

**Verificação:**
```bash
cd apps/web && bun run typecheck
vitest run
```

**Dependências:** T05 (SOURCE_LABELS atualizado para que o chip funcione com novos valores).
**Escopo:** XS (1 arquivo, 3 linhas).

---

### T08 — Web detail: source dropdown + pause toggle + badge

**Descrição:** Na página de detalhe do lead, adicionar: (1) dropdown de origem para correção manual → chama `updateLeadSource` + loga `lead_source_corrected`; (2) toggle "Pausar bot / Retomar bot" → chama `pauseLead`; (3) badge "Bot pausado — você assume" quando `botPaused === true`.

**Arquivos afetados:**
- `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

**Mudanças:**
1. Atualizar `useQuery` para usar o retorno `Lead & { botPaused }` de `fetchLead`
2. Adicionar `useMutation` para `pauseLead` (com `invalidateQuery` no `onSuccess`)
3. Adicionar `useMutation` para `updateLeadSource` (com `invalidateQuery` + `logActivity` no `onSuccess`)
4. Renderizar badge `data-slot="bot-paused-badge"` condicional
5. Renderizar `<select>` de source com `Object.entries(SOURCE_LABELS)`
6. Renderizar botão pause/resume

**Nota sobre `logActivity` no web:** Ao corrigir source, chamar `logActivity(supabase, { action: 'lead_source_corrected', ... })` de `@/lib/activity`. Requer `supabase` da sessão. Buscar via `useSupabase()` hook ou importar `supabase` diretamente de `@/lib/supabase`.

**Critério de pronto:**
- [x] Dropdown de source visível no detalhe, com todos os valores de `SOURCE_LABELS`
- [x] Ao mudar source, `PATCH /admin/leads/:id` chamado + `lead_source_corrected` logado
- [x] Toggle "Pausar bot" / "Retomar bot" funcional
- [x] Badge "Bot pausado — você assume" visível quando `botPaused === true`
- [x] `bun run typecheck` (web): verde
- [x] `vitest run`: sem regressões

**Verificação:**
```bash
cd apps/web && bun run typecheck
vitest run
```

**Dependências:** T04 (endpoint pause-bot), T05 (api.ts methods + SOURCE_LABELS), T06 (fetchLead retorna botPaused).
**Escopo:** M (1 arquivo, ~80 linhas de adição).

---

## Checkpoint 3 — Final

- [x] `bun test src/__tests__` (bot): todos passam, incluindo novos testes Zod
- [x] `vitest run` (web): todos passam, incluindo lead-utils e lead-source novos testes
- [x] `bun run typecheck` (bot): verde
- [x] `bun run typecheck` (web): verde
- [x] `bun run lint`: 0 novos errors
- [x] Critérios de aceite do spec verificados (seção 9 de `specs/leads.md`)

---

## Resumo de arquivos afetados

| Arquivo | Task | Operação |
|---|---|---|
| `apps/bot/prisma/schema.prisma` | T01 | Editar |
| `apps/bot/prisma/migrations/<ts>_leads_slice_*/migration.sql` | T01 | Criar |
| `packages/types/src/lead.ts` | T01 | Editar (LeadSource + Conversation) |
| `apps/bot/src/flows/router.ts` | T02 | Editar |
| `apps/bot/src/agents/lead.ts` | T03 | Editar (export + source) |
| `apps/bot/src/flows/lead/index.ts` | T03 | Editar |
| `apps/bot/src/__tests__/lead-extraction-schema.test.ts` | T03 | Criar |
| `apps/bot/src/routes/admin.ts` | T04 | Editar |
| `apps/web/src/lib/lead-utils.ts` | T05 | Criar |
| `apps/web/src/lib/leads.ts` | T05 | Editar |
| `apps/web/src/lib/api.ts` | T05 | Editar |
| `apps/web/src/__tests__/lead-utils.test.ts` | T05 | Criar |
| `apps/web/src/__tests__/lead-source.test.ts` | T05 | Editar |
| `apps/web/src/lib/queries.ts` | T06 | Editar |
| `apps/web/src/components/lead-kanban-card.tsx` | T07 | Editar |
| `apps/web/src/routes/_dashboard/leads/$leadId.tsx` | T08 | Editar |

**Total: 16 arquivos — 6 edições bot, 8 edições web, 1 migration, 1 arquivo de tipos.**

---

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| `Conversation` sem row para lead existente | Médio | `upsert` no pause-bot; `.maybeSingle()` no fetchLead |
| `source` LLM sobrescreve correção manual do owner | Alto | Condição `!lead.source \|\| lead.source === 'whatsapp'` |
| `logActivity` import colidindo com local em admin.ts | Baixo | Alias `logActivityHelper` |
| `LeadExtractionSchema` não exportado atualmente | Baixo | Adicionar `export` ao criar o teste |
| `updateLead` endpoint (`PATCH /admin/leads/:id`) não existe | Médio | Verificar em admin.ts — se ausente, criar junto ao T04 |
