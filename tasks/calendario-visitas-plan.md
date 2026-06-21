# calendario-visitas Implementation Plan

> Spec: `specs/calendario-visitas.md`
> Pipeline: schema → types → bot extractor → bot flow → bot endpoints → web queries/api → web UI

**Goal:** Página `/visits` no painel admin com grid semanal de visitas. Criação manual + marcação como realizada.

**Architecture:** Uma migration + tipos → extração bot → 2 endpoints bot → queries/api web → 3 componentes web.

**Tech Stack:** Prisma migrations, Bun/TypeScript, Fastify, React 19, TanStack Query, shadcn/ui, Zod

---

## Arquivos modificados

| Arquivo | O que muda |
|---|---|
| `apps/bot/prisma/schema.prisma` | Adiciona `scheduledVisitAt DateTime?` em Lead |
| `apps/bot/prisma/migrations/20260621000001_lead_scheduled_visit_at/migration.sql` | Migration SQL |
| `packages/types/src/lead.ts` | Adiciona `scheduledVisitAt: string \| null` |
| `apps/bot/src/agents/lead.ts` | Adiciona `scheduled_visit_at` ao `LeadExtractionSchema` |
| `apps/bot/src/flows/lead/index.ts` | Persiste `scheduledVisitAt` quando extrator retorna data |
| `apps/bot/src/routes/admin.ts` | Adiciona `POST /admin/visits` e `PATCH /admin/leads/:id/complete-visit` |
| `apps/web/src/lib/queries.ts` | Adiciona `fetchVisits()` e tipo local `VisitEntry` |
| `apps/web/src/lib/api.ts` | Adiciona `createVisit()` e `completeVisit()` |
| `apps/web/src/routes/_dashboard.tsx` | Adiciona nav item "Visitas" |
| `apps/web/src/routes/_dashboard/visits/index.tsx` | Nova rota — grid semanal |
| `apps/web/src/components/visits/visit-card.tsx` | VisitCard component |
| `apps/web/src/components/visits/new-visit-modal.tsx` | Modal Nova visita |

---

## Phase 1 — Schema + Types

### T01 — Migration: `Lead.scheduledVisitAt`

**Arquivos:**
- `apps/bot/prisma/schema.prisma`
- `apps/bot/prisma/migrations/20260621000001_lead_scheduled_visit_at/migration.sql`

**O que fazer:**
1. Adicionar `scheduledVisitAt DateTime?` ao model `Lead` em `schema.prisma`, após `reactivatedAt`
2. Criar arquivo de migration com SQL:
   ```sql
   ALTER TABLE "Lead" ADD COLUMN "scheduledVisitAt" TIMESTAMP(3);
   ```

**Critério de pronto:**
- [ ] `scheduledVisitAt DateTime?` presente no `schema.prisma` (após `reactivatedAt`)
- [ ] Arquivo de migration SQL existe com o ALTER TABLE correto
- [ ] `cd apps/bot && bunx prisma validate` sem erros

**Verificação:** `cd apps/bot && bunx prisma validate`

---

### T02 — Tipo compartilhado: `Lead.scheduledVisitAt`

**Arquivo:** `packages/types/src/lead.ts`

**O que fazer:**
Adicionar campo à interface `Lead`, após `reactivatedAt`:
```typescript
scheduledVisitAt: string | null;
```

**Critério de pronto:**
- [ ] Campo `scheduledVisitAt: string | null` na interface `Lead`
- [ ] `cd packages/types && bunx tsc --noEmit` verde

**Verificação:** `cd packages/types && bunx tsc --noEmit`

---

### Checkpoint 1

- [ ] `bunx prisma validate` sem erros
- [ ] `packages/types` compila sem erros

---

## Phase 2 — Bot: Extração + Persistência

### T03 — Extrator LLM: campo `scheduled_visit_at`

**Arquivo:** `apps/bot/src/agents/lead.ts`

**O que fazer:**
Adicionar ao `LeadExtractionSchema` (após o campo `source`):
```typescript
scheduled_visit_at: z
  .string()
  .nullable()
  .default(null)
  .describe(
    "ISO 8601 date-time da visita confirmada na conversa, ex: '2026-06-25T14:00:00-03:00'. " +
    "Preencher APENAS quando lead e bot confirmaram explicitamente DIA e HORA especificos. " +
    "Mencao vaga ('qualquer dia', 'essa semana') → null.",
  ),
```

**Critério de pronto:**
- [ ] Campo `scheduled_visit_at` presente no schema Zod com `.describe()` claro
- [ ] `cd apps/bot && bunx tsc --noEmit` verde

**Verificação:** `cd apps/bot && bunx tsc --noEmit`

---

### T04 — Flow: persistir `scheduledVisitAt` quando extraído

**Arquivo:** `apps/bot/src/flows/lead/index.ts`

**O que fazer:**
No bloco onde `leadPatch` é construído (após sincronizar `Lead.stage`, antes do `prisma.lead.update`), adicionar:

```typescript
// Persistir data de visita confirmada pelo agente de scheduling
if (extracted.scheduled_visit_at) {
  const proposedDate = new Date(extracted.scheduled_visit_at);
  if (
    !isNaN(proposedDate.getTime()) &&
    (lead.scheduledVisitAt === null || proposedDate > new Date(lead.scheduledVisitAt))
  ) {
    leadPatch.scheduledVisitAt = proposedDate;
  }
}
```

Regra: só atualiza se data extraída for válida e posterior à atual (não regride em caso de nova mensagem).

**Critério de pronto:**
- [ ] Bloco de persistência presente após o sync de stage
- [ ] Não regride `scheduledVisitAt` para data anterior
- [ ] `cd apps/bot && bunx tsc --noEmit` verde

**Verificação:** `cd apps/bot && bunx tsc --noEmit`

---

### Checkpoint 2

- [ ] `cd apps/bot && bunx tsc --noEmit` verde
- [ ] `cd apps/bot && bunx oxlint src/` sem warnings novos

---

## Phase 3 — Bot: Endpoints

### T05 — Endpoint: `POST /admin/visits`

**Arquivo:** `apps/bot/src/routes/admin.ts`

**O que fazer:**
Adicionar rota após os endpoints de lead existentes:

```typescript
fastify.post<{
  Body: { leadId: string; propertyId: string; scheduledVisitAt: string; note?: string };
}>(
  '/admin/visits',
  { preHandler: verifyAdminJwt },
  async (request, reply) => {
    const { leadId, propertyId, scheduledVisitAt, note } = request.body;
    const ownerId = (request as AuthedRequest).ownerId;

    if (!leadId || !propertyId || !scheduledVisitAt) {
      return reply.status(400).send({ error: 'leadId, propertyId and scheduledVisitAt are required' });
    }

    const visitDate = new Date(scheduledVisitAt);
    if (isNaN(visitDate.getTime())) {
      return reply.status(400).send({ error: 'Invalid scheduledVisitAt date' });
    }

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || lead.ownerId !== ownerId) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property || property.ownerId !== ownerId) {
      return reply.status(404).send({ error: 'Property not found' });
    }

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { scheduledVisitAt: visitDate, stage: 'visiting', propertyId },
    });

    logActivityHelper({
      action: 'visit_scheduled',
      actorType: 'owner',
      actorLabel: 'Admin',
      ownerId,
      subjectType: 'lead',
      subjectId: leadId,
      metadata: { scheduledVisitAt, note: note ?? null },
    });

    return reply.send({ leadId, scheduledVisitAt: updated.scheduledVisitAt });
  },
);
```

**Critério de pronto:**
- [ ] `POST /admin/visits` registrado no Fastify com `verifyAdminJwt`
- [ ] Valida campos obrigatórios e datas inválidas (400)
- [ ] Valida `ownerId` em Lead e Property (404)
- [ ] Atualiza `scheduledVisitAt`, `stage = 'visiting'`, `propertyId`
- [ ] Emite `visit_scheduled` no ActivityLog
- [ ] `cd apps/bot && bunx tsc --noEmit` verde

**Verificação:** `cd apps/bot && bunx tsc --noEmit`

---

### T06 — Endpoint: `PATCH /admin/leads/:id/complete-visit`

**Arquivo:** `apps/bot/src/routes/admin.ts`

**O que fazer:**
Adicionar logo após `POST /admin/visits`:

```typescript
fastify.patch<{ Params: { id: string } }>(
  '/admin/leads/:id/complete-visit',
  { preHandler: verifyAdminJwt },
  async (request, reply) => {
    const { id } = request.params;
    const ownerId = (request as AuthedRequest).ownerId;

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead || lead.ownerId !== ownerId) {
      return reply.status(404).send({ error: 'Lead not found' });
    }

    if (lead.visitedAt) {
      return reply.status(409).send({ error: 'Visit already completed' });
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: { visitedAt: new Date(), stage: 'post_visit_decision' },
    });

    logActivityHelper({
      action: 'visit_completed',
      actorType: 'owner',
      actorLabel: 'Admin',
      ownerId,
      subjectType: 'lead',
      subjectId: id,
    });

    return reply.send({ leadId: id, visitedAt: updated.visitedAt, stage: updated.stage });
  },
);
```

**Critério de pronto:**
- [ ] `PATCH /admin/leads/:id/complete-visit` registrado com `verifyAdminJwt`
- [ ] Valida `ownerId` (404)
- [ ] Idempotência: 409 se `visitedAt` já preenchido
- [ ] Seta `visitedAt = now()` e `stage = 'post_visit_decision'`
- [ ] Emite `visit_completed` no ActivityLog
- [ ] `cd apps/bot && bunx tsc --noEmit` verde

**Verificação:** `cd apps/bot && bunx tsc --noEmit`

---

### Checkpoint 3

- [ ] `cd apps/bot && bunx tsc --noEmit` verde
- [ ] `cd apps/bot && bunx oxlint src/` sem warnings novos

---

## Phase 4 — Web: Queries + API Client

### T07 — `fetchVisits()` e mutations em `api.ts`/`queries.ts`

**Arquivos:**
- `apps/web/src/lib/queries.ts`
- `apps/web/src/lib/api.ts`

**O que fazer em `queries.ts`:**
Adicionar tipo local e função de query ao final do arquivo:

```typescript
export interface VisitEntry {
  id: string;
  externalId: string | null;
  name: string | null;
  phone: string;
  stage: string;
  scheduledVisitAt: string | null;
  propertyId: string | null;
  property: { externalId: string | null; address: string; neighborhood: string } | null;
}

export async function fetchVisits(): Promise<VisitEntry[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select('id, externalId, name, phone, stage, scheduledVisitAt, propertyId, property:propertyId(externalId, address, neighborhood)')
    .eq('stage', 'visiting')
    .is('archivedAt', null)
    .order('scheduledVisitAt', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as VisitEntry[];
}
```

**O que fazer em `api.ts`:**
Adicionar ao objeto de exports:
```typescript
createVisit: (data: {
  leadId: string;
  propertyId: string;
  scheduledVisitAt: string;
  note?: string;
}) => botApi.post('/admin/visits', data),

completeVisit: (leadId: string) =>
  botApi.patch(`/admin/leads/${leadId}/complete-visit`),
```

**Critério de pronto:**
- [ ] `fetchVisits()` e `VisitEntry` exportados de `queries.ts`
- [ ] `api.createVisit()` e `api.completeVisit()` adicionados em `api.ts`
- [ ] `cd apps/web && bunx tsc --noEmit` verde

**Verificação:** `cd apps/web && bunx tsc --noEmit`

---

## Phase 5 — Web: UI

### T08 — Nav item "Visitas"

**Arquivo:** `apps/web/src/routes/_dashboard.tsx`

**O que fazer:**
1. Adicionar `CalendarDays` ao import de `lucide-react`
2. No array `NAV_GROUPS`, no grupo principal, adicionar após Dashboard e antes de Imóveis:
   ```typescript
   { href: '/visits', label: 'Visitas', icon: CalendarDays },
   ```
3. Em `getPageTitle`, adicionar:
   ```typescript
   if (path.startsWith('/visits')) return 'Visitas';
   ```

**Critério de pronto:**
- [ ] Item "Visitas" aparece no sidebar com ícone `CalendarDays`
- [ ] Link navega para `/visits`
- [ ] `cd apps/web && bunx tsc --noEmit` verde

**Verificação:** `cd apps/web && bunx tsc --noEmit`

---

### T09 — Componente `VisitCard`

**Arquivo:** `apps/web/src/components/visits/visit-card.tsx`

**O que fazer:**
Criar componente seguindo padrão `.claude/skills/create-component/`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { VisitEntry } from '@/lib/queries';

interface VisitCardProps {
  visit: VisitEntry;
  onCompleted: (leadId: string) => void;
}

export function VisitCard({ visit, onCompleted }: VisitCardProps) { ... }
```

Conteúdo do card:
- Horário: `scheduledVisitAt` formatado como `HH:mm` (ou "Hora a confirmar")
- Nome do lead (ou telefone)
- ExternalId do imóvel + endereço
- Botão [✓] com `aria-label="Marcar como realizada"` → `api.completeVisit(visit.id)` → `onCompleted(visit.id)` (optimistic remove) + toast

**Critério de pronto:**
- [ ] Named export `VisitCard`
- [ ] Arquivo lowercase com hífens `visit-card.tsx`
- [ ] `data-slot="visit-card"` no elemento raiz
- [ ] Horário exibido com locale `pt-BR` + timezone `America/Sao_Paulo`
- [ ] Botão "Marcar como realizada" chama `api.completeVisit` e emite `onCompleted`
- [ ] `cd apps/web && bunx tsc --noEmit` verde

**Verificação:** `cd apps/web && bunx tsc --noEmit`

---

### T10 — Componente `NewVisitModal`

**Arquivo:** `apps/web/src/components/visits/new-visit-modal.tsx`

**O que fazer:**
Modal com `Dialog` do shadcn/ui:

Campos:
- Lead — `Select` dos leads com `stage != 'converted'` e `archivedAt IS NULL` (query `fetchLeads()` existente + filtro)
- Imóvel — `Select` das properties com `status = 'available'` (query `fetchProperties()` existente + filtro)
- Data — `<input type="date">`
- Hora — `<input type="time">`
- Nota — `<textarea>` placeholder "Observações (opcional)"

Ao confirmar:
1. Valida campos obrigatórios
2. `api.createVisit({ leadId, propertyId, scheduledVisitAt: isoString, note })` onde `isoString = new Date(date + 'T' + time).toISOString()`
3. `queryClient.invalidateQueries({ queryKey: ['visits'] })`
4. Toast "Visita agendada"
5. Fechar modal

Props: `open: boolean`, `onClose: () => void`

**Critério de pronto:**
- [ ] Named export `NewVisitModal`
- [ ] `data-slot="new-visit-modal"` no Dialog
- [ ] Campos Lead, Imóvel, Data, Hora, Nota presentes
- [ ] Validação client-side: Lead, Imóvel, Data, Hora obrigatórios
- [ ] Ao submeter: chama `api.createVisit`, invalida query, toast, fecha
- [ ] `cd apps/web && bunx tsc --noEmit` verde

**Verificação:** `cd apps/web && bunx tsc --noEmit`

---

### T11 — Rota `/visits` com grid semanal

**Arquivo:** `apps/web/src/routes/_dashboard/visits/index.tsx`

**O que fazer:**
Criar a rota com:

```typescript
export const Route = createFileRoute('/_dashboard/visits/')({
  component: VisitsPage,
});
```

Estado local: `weekStart: Date` (domingo da semana corrente via `startOfWeek`).

Navegação: `< Semana anterior` / `Semana seguinte >` incrementa/decrementa `weekStart` por 7 dias. Botão "Hoje" reseta.

Estrutura:
```
Header: "Calendário de Visitas"  |  < Semana >  [Hoje]  [Nova visita]
Grid: 7 colunas (Dom–Sáb)
  → Coluna header: "Dom 22" / "Seg 23" etc.
  → Corpo: VisitCards com scheduledVisitAt nessa data
Seção "Sem data agendada": VisitCards com scheduledVisitAt IS NULL
```

Query:
```typescript
const { data: visits = [] } = useQuery({
  queryKey: ['visits'],
  queryFn: fetchVisits,
  refetchInterval: 30_000,
});
```

Lógica de distribuição por coluna:
```typescript
function getVisitsForDay(visits: VisitEntry[], day: Date): VisitEntry[] {
  return visits.filter((v) => {
    if (!v.scheduledVisitAt) return false;
    const d = new Date(v.scheduledVisitAt);
    return (
      d.getFullYear() === day.getFullYear() &&
      d.getMonth() === day.getMonth() &&
      d.getDate() === day.getDate()
    );
  });
}
```

Sem data agendada:
```typescript
const unscheduled = visits.filter((v) => !v.scheduledVisitAt);
```

Optimistic remove ao marcar como realizada: filtrar o lead do state local (ou invalidar a query).

**Critério de pronto:**
- [ ] Rota `/_dashboard/visits/` renderiza sem erro
- [ ] Grid de 7 colunas com header de dia/data
- [ ] Visitas com data na semana exibida aparecem na coluna correta
- [ ] Visitas sem data aparecem em "Sem data agendada"
- [ ] Navegação `< >` e "Hoje" funcionam
- [ ] Botão "Nova visita" abre `NewVisitModal`
- [ ] `cd apps/web && bunx tsc --noEmit` verde
- [ ] `cd apps/web && bunx oxlint src/` sem warnings novos

**Verificação:** `cd apps/web && bunx tsc --noEmit && bunx oxlint src/`

---

### Checkpoint Final

- [ ] `cd apps/bot && bunx tsc --noEmit` verde
- [ ] `cd apps/bot && bunx oxlint src/` sem warnings novos
- [ ] `cd apps/web && bunx tsc --noEmit` verde
- [ ] `cd apps/web && bunx oxlint src/` sem warnings novos
- [ ] Nav item "Visitas" visível no sidebar
- [ ] `/visits` abre sem erro de runtime
- [ ] Grid semanal renderiza 7 colunas
- [ ] "Nova visita" abre modal, preenche campos, submete sem erro
- [ ] "Marcar como realizada" remove o card da tela

---

## Ordem de execução

```
T01 (migration) → T02 (types) → T03 (extrator) → T04 (flow) → T05 (POST visits) → T06 (PATCH complete-visit) → T07 (queries/api) → T08 (nav) → T09 (VisitCard) → T10 (NewVisitModal) → T11 (rota)
```

Dependências críticas:
- T02 depende de T01 (tipo referencia o campo do schema)
- T03/T04 dependem de T01+T02 (bot precisa do campo existir)
- T07 depende de T05+T06 (api.ts chama os endpoints novos)
- T09–T11 dependem de T07 (usam `VisitEntry` e funções da api)

---

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Supabase JS não retorna `scheduledVisitAt` de leads sem migration aplicada em prod | Alto | Testar localmente com `prisma db push` antes de PR |
| LLM preenche `scheduled_visit_at` com texto relativo ("amanhã") sem ser ISO | Médio | `new Date(value)` retorna `NaN` → guard `isNaN` no flow descarta silenciosamente |
| `startOfWeek` sem lib: `Date.getDay()` retorna 0 = domingo, comportamento esperado | Baixo | Implementar com aritmética nativa, sem depender de `date-fns` |
