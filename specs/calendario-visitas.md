# Spec: Calendário de Visitas V1

## Objetivo

Página `/visits` no painel admin para o proprietário visualizar e gerenciar visitas agendadas com leads.
Visitas aparecem em grid semanal com data e horário. Proprietário pode criar visitas manualmente e marcá-las como realizadas.

**Usuário:** proprietário do imóvel (único owner, single-tenant).

---

## Escopo

### In
- Schema: novo campo `Lead.scheduledVisitAt DateTime?`
- Bot: extrator LLM captura `scheduledVisitAt` quando agente de scheduling confirma data/hora com lead; persiste em `Lead.scheduledVisitAt`
- Web: nova rota `_dashboard/visits/index.tsx` com grid semanal
- Web: nav item "Visitas" (CalendarDays icon) no grupo principal, entre Dashboard e Imóveis
- Web: modal "Nova visita" — cria visita com Lead, Imóvel, Data+Hora, Nota; seta `scheduledVisitAt` e muda stage para `visiting`
- Web: botão "Marcar como realizada" no card — seta `Lead.visitedAt = now()`, stage → `post_visit_decision`
- Bot: novo endpoint `POST /admin/visits` — cria visita manual (web usa este)
- Bot: novo endpoint `PATCH /admin/leads/:id/complete-visit` — marca visita realizada
- Activity log: `visit_scheduled`, `visit_completed`

### Out
- Visitas passadas (V1 exibe só futuras ou sem data — `scheduledVisitAt >= hoje` ou `scheduledVisitAt IS NULL`)
- Integração Google Calendar (V2)
- Notificações de lembrete (V2)
- Cancelamento de visita
- Múltiplas visitas por lead
- Responsivo mobile

---

## Schema changes

```sql
-- Migration: adicionar scheduledVisitAt em Lead
ALTER TABLE "Lead" ADD COLUMN "scheduledVisitAt" TIMESTAMP(3);
```

Prisma schema (`apps/bot/prisma/schema.prisma`):

```prisma
model Lead {
  -- campos existentes...
  scheduledVisitAt DateTime?
  -- ...
}
```

---

## Tipos compartilhados (`packages/types`)

Atualizar `packages/types/src/lead.ts`:

```typescript
export interface Lead {
  // existentes...
  scheduledVisitAt: string | null; // ISO 8601
}
```

---

## Bot changes

### Extrator LLM (`apps/bot/src/agents/lead.ts`)

Adicionar campo ao schema Zod do extrator:

```typescript
scheduled_visit_at: z.string().nullable().optional()
  .describe("ISO 8601 date-time da visita confirmada na conversa, ex: '2026-06-25T14:00:00-03:00'. Null se não foi acordado horário específico.")
```

Condição de preenchimento: o LLM só preenche quando há confirmação explícita de data E hora na conversa (ex: "pode ser terça às 14h", "então fica segunda 10h"). Menção vaga ("algum dia dessa semana") → null.

### Flow (`apps/bot/src/flows/lead/index.ts`)

Após extrator, se `extracted.scheduled_visit_at` for non-null e diferente do valor atual em `Lead.scheduledVisitAt`:

```typescript
await prisma.lead.update({
  where: { id: lead.id },
  data: { scheduledVisitAt: new Date(extracted.scheduled_visit_at) },
});
```

Só atualiza se `scheduledVisitAt` ainda estiver null ou se a nova data for posterior à atual (não regride).

### Endpoint: `POST /admin/visits`

```
POST /admin/visits
Authorization: Bearer <supabase-jwt>

Body:
{
  leadId: string,
  propertyId: string,
  scheduledVisitAt: string, // ISO 8601
  note?: string
}

Response 200:
{
  leadId: string,
  scheduledVisitAt: string
}
```

Ação:
1. Valida `leadId` e `propertyId` existem e pertencem ao `ownerId`
2. `prisma.lead.update({ scheduledVisitAt, stage: 'visiting', propertyId })`
3. Emite `logActivity({ action: 'visit_scheduled', subjectId: leadId, ... })`

### Endpoint: `PATCH /admin/leads/:id/complete-visit`

```
PATCH /admin/leads/:id/complete-visit
Authorization: Bearer <supabase-jwt>

Body: {} (vazio)

Response 200:
{ leadId: string, visitedAt: string, stage: 'post_visit_decision' }
```

Ação:
1. Valida `lead.ownerId === requestOwnerId`
2. `prisma.lead.update({ visitedAt: new Date(), stage: 'post_visit_decision' })`
3. Emite `logActivity({ action: 'visit_completed', subjectId: leadId, ... })`

---

## Web changes

### Nova rota: `apps/web/src/routes/_dashboard/visits/index.tsx`

Query principal:

```typescript
// queries.ts
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

### Tipo local (não entra em `packages/types` — web-only)

```typescript
interface VisitEntry {
  id: string;
  externalId: string | null;
  name: string | null;
  phone: string;
  stage: LeadStage;
  scheduledVisitAt: string | null;
  propertyId: string | null;
  property: { externalId: string | null; address: string; neighborhood: string } | null;
}
```

### Layout da página

```
┌─ Header ────────────────────────────────────────────────────────┐
│  Calendário de Visitas          < Semana anterior  Semana >     │
│                                 [Hoje]  [Nova visita]           │
├─────────────────────────────────────────────────────────────────┤
│  Dom 22  │  Seg 23  │  Ter 24  │  Qua 25  │  Qui 26  │  Sex 27 │  Sáb 28  │
│          │          │          │          │          │          │          │
│          │  VisitCard           │          │  VisitCard          │          │
│          │  [Lead]  │          │          │  [Lead]  │          │          │
│          │          │          │          │          │          │          │
│          │          │          │          │          │          │          │
├──────────┤          ├──────────┤──────────┤          ├──────────┤──────────┤
│  Sem data agendada  ──  leads com stage=visiting e scheduledVisitAt null  │
│  VisitCard  VisitCard  ...                                                │
└─────────────────────────────────────────────────────────────────────────┘
```

- Grid: semana corrente por padrão. Navegar com `< >` por semana.
- Botão "Hoje" volta à semana atual.
- Leads com `scheduledVisitAt` dentro da semana exibida → aparecem na coluna do dia.
- Leads com `stage = 'visiting'` e `scheduledVisitAt IS NULL` → seção "Sem data agendada" abaixo do grid.
- Visitas com data no passado fora da semana exibida → não aparecem (V1 só exibe pela janela de semana selecionada + sem-data).

### VisitCard

```
┌──────────────────────────────────┐
│  14:00  Lead #L-012              │
│  João Silva                      │
│  AP-007 · Rua das Flores, 10     │
│                              [✓] │
└──────────────────────────────────┘
```

- Horário mono muted (ou "Hora a confirmar" se null)
- Nome do lead (ou telefone se sem nome)
- ExternalId do imóvel + endereço
- Botão [✓] "Marcar como realizada" → `PATCH /admin/leads/:id/complete-visit` + optimistic remove do card

### Modal "Nova visita"

Campos:
- **Lead** — `Select` dos leads com `stage != 'converted'` e `archivedAt IS NULL`; exibe `name ?? phone` + externalId
- **Imóvel** — `Select` das properties com `status = 'available'`; exibe externalId + endereço
- **Data** — `<input type="date">`
- **Hora** — `<input type="time">`
- **Nota** — `<textarea>` opcional (armazenada em ActivityLog metadata, não em campo dedicado)

Ao confirmar → `POST /admin/visits` → invalidate query `fetchVisits` + toast "Visita agendada".

### Nav item

Em `_dashboard.tsx`, no grupo principal (após Dashboard, antes de Imóveis):

```typescript
{ href: '/visits', label: 'Visitas', icon: CalendarDays }
```

---

## Activity log keys

| Key | Quem emite | Quando |
|---|---|---|
| `visit_scheduled` | bot (extrator) ou web (modal) | scheduledVisitAt definido pela primeira vez |
| `visit_completed` | web (botão) | visitedAt marcado |

Convenção: `actorType = 'system'` quando bot; `actorType = 'owner'` quando painel.

---

## Notificações

Fora do escopo V1. V2 poderá usar `notifyOwner` para lembrete N horas antes.

---

## Critérios de aceite

- [ ] Campo `Lead.scheduledVisitAt` existe no schema Prisma e na migration SQL
- [ ] Tipo `Lead.scheduledVisitAt: string | null` em `packages/types`
- [ ] Bot: quando agente de scheduling confirma data+hora explícita → `Lead.scheduledVisitAt` é persistido
- [ ] Bot: `POST /admin/visits` cria visita, muda stage para `visiting`, emite `visit_scheduled`
- [ ] Bot: `PATCH /admin/leads/:id/complete-visit` seta `visitedAt`, muda stage para `post_visit_decision`, emite `visit_completed`
- [ ] Web: nav item "Visitas" aparece no sidebar e navega para `/visits`
- [ ] Web: página `/visits` exibe grid semanal com 7 colunas
- [ ] Web: leads com `scheduledVisitAt` na semana exibida aparecem na coluna do dia correto
- [ ] Web: leads com `stage = 'visiting'` e sem data aparecem na seção "Sem data agendada"
- [ ] Web: navegação `< semana anterior | semana seguinte >` e botão "Hoje" funcionam
- [ ] Web: botão "Marcar como realizada" remove o card otimisticamente e chama o endpoint
- [ ] Web: modal "Nova visita" valida campos obrigatórios antes de submeter
- [ ] Web: `bunx tsc --noEmit` verde em `apps/web` e `apps/bot`
- [ ] Web: `bunx oxlint` sem warnings novos

---

## Riscos / edge cases

| Risco | Mitigação |
|---|---|
| LLM extrai data ambígua ("amanhã") sem contexto de data atual | Injetar `currentDate` no system prompt do extrator; se ainda ambíguo, retornar null |
| Lead tem múltiplas conversas de agendamento (remarcação) | `scheduledVisitAt` aceita update; só não regride se nova data for null |
| Lead movido manualmente para `visiting` sem data | Aparece em "Sem data agendada"; proprietário pode reagendar pelo modal |
| `POST /admin/visits` com `propertyId` diferente do atual em Lead | Atualiza `Lead.propertyId` junto com `scheduledVisitAt` (lead pode ter trocado de imóvel) |
| Fuso horário: bot em UTC, exibição no painel em horário local | Armazenar sempre em UTC; exibir com `toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })` |
