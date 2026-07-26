# Responsável pelo imóvel (Coordinator)

> Data: 2026-07-26
> Origem: bug em produção — bot escala para humano quando lead pergunta "quem eu procuro no dia
> da visita"; feature já prevista em `ROADMAP.md` ("V2 — Responsável por visita por imóvel"),
> nunca implementada.

## Problema

Duas causas empilhadas no bug relatado:

1. `Property` não tem nenhum fato de domínio sobre "quem procurar" na visita — o bot não tem como
   responder isso, mesmo que quisesse.
2. `wants_human` (`apps/bot/src/agents/lead.ts:155`) não tem nenhuma regra no
   `EXTRACTOR_SYSTEM_PROMPT` dizendo quando deve ser `true`. O LLM decide sozinho, e uma pergunta
   ambígua ("quem eu procuro?") disparou escalação para humano — viola a regra do projeto de que
   o LLM nunca improvisa.

Corrigir só a causa raiz (2) resolve o bug imediato, mas não dá ao bot uma resposta real. A causa
(1) exige a feature completa: um responsável por imóvel — pessoa que mostra o imóvel, entrega/
recebe chave e faz vistoria — cadastrável no painel, e notificado quando uma visita é agendada.

## Escopo

Reutilizável entre imóveis: o mesmo responsável pode ser vinculado a 1, vários ou todos os imóveis
sem recadastrar nome/telefone — quem tem 50 imóveis com o mesmo zelador não recadastra 50 vezes.

Fora de escopo:
- Cron de lembrete com múltiplos offsets (V3 do ROADMAP — reusa este model, trabalho futuro)
- Notificação por e-mail ao responsável (só WhatsApp)
- Login/acesso ao painel para o responsável
- Disponibilidade configurável por responsável (V4 do ROADMAP)

## Decisões

- **Entidade reutilizável (`Coordinator`) + join table (`PropertyCoordinator`)**, não um campo
  direto em `Property`. Mesmo padrão já usado em `RuleSet` ↔ `PropertyRuleSet` ↔ `Property`
  (`apps/bot/prisma/schema.prisma:263-296`, rotas em `apps/bot/src/routes/admin/rule-sets.ts`,
  página `apps/web/src/routes/_dashboard/rules/index.tsx`). Considerado e rejeitado: um toggle
  global "modo por imóvel vs modo global" em Configurações — é binário e não cobre o caso comum
  de "quase todos os imóveis com a mesma pessoa, menos um" sem forçar a trocar o modo inteiro.
- **`responsibilities` mora no vínculo (`PropertyCoordinator`), não na pessoa (`Coordinator`)** —
  permite a mesma pessoa ter papel diferente por imóvel (raro, mas sem custo extra de modelagem:
  é só uma coluna a mais no join, igual `RuleSetPolicy.appliesToProperty`). No caso comum
  (mesma responsabilidade em todos os imóveis), o "aplicar a todos" abaixo cobre em uma ação.
- **`responsibilities: String[]`** (enum de aplicação, não de banco — mesma convenção de
  `PropertyMedia.type`): `show_property`, `deliver_keys`, `receive_keys`, `inspection`.
- **Bulk-link endpoint novo** (`POST /admin/coordinators/:id/properties/bulk-link`) — não existe
  equivalente em rule-sets (lá o vínculo é sempre manual, um por um); aqui é o mecanismo que
  resolve o "não quero recadastrar/relinkar 50 vezes".
- **Leitura do bot via cache Redis existente** (`catalog.ts`, TTL 10 min) — mutações em
  coordinator/vínculo invalidam o cache do(s) imóvel(is) afetado(s), mesmo padrão de
  `invalidatePropertyCache` já usado para mídia.
- **Fato "Responsável pela visita" só considera `show_property`** — as outras responsabilidades
  (`deliver_keys`, `receive_keys`, `inspection`) são operacionais internas, sem uso no prompt do
  lead agent; mantém o contexto do LLM enxuto (YAGNI).

## Schema

`apps/bot/prisma/schema.prisma`:

```prisma
model Coordinator {
  id         String                @id @default(uuid())
  ownerId    String
  owner      Owner                 @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  name       String
  phone      String
  properties PropertyCoordinator[]
  createdAt  DateTime              @default(now())

  @@index([ownerId])
}

model PropertyCoordinator {
  propertyId       String
  property         Property    @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  coordinatorId    String
  coordinator      Coordinator @relation(fields: [coordinatorId], references: [id], onDelete: Cascade)
  responsibilities String[]    @default([])

  @@id([propertyId, coordinatorId])
}
```

Adicionar `coordinators PropertyCoordinator[]` em `model Property` e `coordinators Coordinator[]`
em `model Owner`.

Migration `apps/bot/prisma/migrations/<timestamp>_property_coordinator/migration.sql`:

```sql
CREATE TABLE "Coordinator" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" TEXT NOT NULL REFERENCES "Owner"("id"),
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX "Coordinator_ownerId_idx" ON "Coordinator"("ownerId");

CREATE TABLE "PropertyCoordinator" (
  "propertyId" TEXT NOT NULL REFERENCES "Property"("id") ON DELETE CASCADE,
  "coordinatorId" TEXT NOT NULL REFERENCES "Coordinator"("id") ON DELETE CASCADE,
  "responsibilities" TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY ("propertyId", "coordinatorId")
);
```

RLS: policy `TO authenticated USING ("ownerId" = auth.uid())` em `Coordinator`, criada junto com a
migration mas inerte até a ativação geral de RLS (gated, separada — ver
`docs/adrs/001-rls-strategy.md` e PR #29).

## Tipos compartilhados (`packages/types`)

Novo arquivo `packages/types/src/coordinator.ts`:

```typescript
export type CoordinatorResponsibility =
  | 'show_property'
  | 'deliver_keys'
  | 'receive_keys'
  | 'inspection';

export interface Coordinator {
  id: string;
  ownerId: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface PropertyCoordinatorLink {
  propertyId: string;
  coordinatorId: string;
  responsibilities: CoordinatorResponsibility[];
  coordinator?: Coordinator; // presente quando incluído via property
}
```

Adicionar `coordinators?: PropertyCoordinatorLink[]` em `Property`
(`packages/types/src/property.ts`).

## Backend (`apps/bot`)

### `apps/bot/src/routes/admin/coordinators.ts` (novo, mirror de `rule-sets.ts`)

```
GET    /admin/coordinators                              → lista com _count.properties
POST   /admin/coordinators                { name, phone }
PATCH  /admin/coordinators/:id            { name?, phone? }
DELETE /admin/coordinators/:id                          → 409 se ainda houver vínculos
POST   /admin/coordinators/:id/properties { propertyId, responsibilities }
PATCH  /admin/coordinators/:id/properties/:propertyId { responsibilities }
DELETE /admin/coordinators/:id/properties/:propertyId
POST   /admin/coordinators/:id/properties/bulk-link { responsibilities }
```

`bulk-link`: busca todos os `Property` do `ownerId` do coordinator com `active = true` e ainda sem
vínculo com esse coordinator; cria um `PropertyCoordinator` por imóvel dentro de uma
`prisma.$transaction`; emite um único `logActivity` (`coordinator_bulk_linked`,
`metadata: { propertyCount }`). Cada mutação invalida `invalidatePropertyCache` dos imóveis
afetados e `invalidateAvailablePropertiesCache`.

Todas as rotas seguem o padrão de `verifyAdminJwt` + validação de `ownerId` (coordinator e
property precisam pertencer ao mesmo owner, mesma checagem de `rule-sets.ts:170`).

### `apps/bot/src/services/catalog.ts`

`PropertyData` ganha `coordinators: (PropertyCoordinatorLink & { coordinator: Coordinator })[]`.
`getPropertyByExternalId` e `listAvailableProperties` ganham
`include: { coordinators: { include: { coordinator: true } } }`.

Em `describeProperty` e `describePropertyTerms`:

```typescript
const showCoordinators = p.coordinators.filter((c) =>
  c.responsibilities.includes('show_property'),
);
if (showCoordinators.length > 0) {
  facts.push(
    `Responsavel pela visita: ${showCoordinators
      .map((c) => `${c.coordinator.name} (${c.coordinator.phone})`)
      .join(', ')}`,
  );
}
```

Se vazio, o fato não aparece — prompt trata a ausência (ver abaixo).

### `apps/bot/src/agents/lead.ts`

`INFO_AGENT_PROMPT` e `SCHEDULING_AGENT_PROMPT` ganham a regra:

> Se a pessoa perguntar quem procurar, quem vai mostrar o imóvel ou quem recebe no dia da visita,
> responda com o "Responsavel pela visita" presente no contexto. Se esse fato não estiver no
> contexto, diga que qualquer pessoa presente no local vai atendê-la e que não há responsável
> específico cadastrado no momento. Nunca invente nome ou telefone.

`EXTRACTOR_SYSTEM_PROMPT` (linha 97-116) ganha a regra que corrige a causa raiz do bug:

> wants_human = true APENAS quando a pessoa pedir explicitamente para falar com atendente, pessoa,
> corretor ou humano (ex: "quero falar com alguém", "tem atendente?", "quero uma pessoa real").
> Perguntas sobre o imóvel, a visita ou o processo — mesmo que a resposta não esteja clara no
> contexto — NÃO configuram wants_human.

### `apps/bot/src/services/notify.ts`

Nova função (coordinators não são `Owner`, não reusa `notifyOwner`):

```typescript
export async function notifyCoordinators(
  propertyId: string,
  payload: { leadName: string; leadPhone: string; scheduledVisitAt: string; propertyExternalId: string },
): Promise<void>
```

Busca `PropertyCoordinator` do imóvel com `show_property`, envia WhatsApp (mesmo padrão de
`sendText` + normalização de telefone de `notifyOwner`) para cada `coordinator.phone`, via
`Promise.allSettled`, non-blocking, log de falha por canal. Chamada nos dois pontos onde
`Lead.scheduledVisitAt` é definido/alterado: `apps/bot/src/flows/lead/index.ts` (extrator do bot) e
`apps/bot/src/routes/admin/visits.ts` (`POST /admin/visits`, agendamento manual).

## Frontend (`apps/web`)

### Nova rota `apps/web/src/routes/_dashboard/coordinators/index.tsx` (mirror de `rules/index.tsx`)

- Lista de `Coordinator`: nome, telefone, contador de imóveis vinculados
- Form "Novo responsável": nome + telefone
- Ao selecionar um responsável, painel de detalhe:
  - Imóveis vinculados: linha por vínculo com badges de `responsibilities` (editáveis inline,
    mesmo padrão de `AppliesToToggle`) e botão de desvincular (`UnlinkPropertyButton`)
  - `LinkPropertyForm`: select de imóvel ainda não vinculado + checkboxes de responsabilidades
  - Botão **"Aplicar a todos os imóveis"** ao lado do form — chama `bulkLinkCoordinator` com as
    responsabilidades marcadas no form

Nav item em `_dashboard.tsx`: `{ href: '/coordinators', label: 'Responsáveis', icon: UserCheck }`.

### `apps/web/src/lib/api.ts`

```typescript
createCoordinator: (data: { name: string; phone: string }) => botApi.post('/admin/coordinators', data),
updateCoordinator: (id: string, data: { name?: string; phone?: string }) => botApi.patch(`/admin/coordinators/${id}`, data),
deleteCoordinator: (id: string) => botApi.delete(`/admin/coordinators/${id}`),
linkCoordinatorProperty: (id: string, data: { propertyId: string; responsibilities: CoordinatorResponsibility[] }) =>
  botApi.post(`/admin/coordinators/${id}/properties`, data),
updateCoordinatorProperty: (id: string, propertyId: string, data: { responsibilities: CoordinatorResponsibility[] }) =>
  botApi.patch(`/admin/coordinators/${id}/properties/${propertyId}`, data),
unlinkCoordinatorProperty: (id: string, propertyId: string) =>
  botApi.delete(`/admin/coordinators/${id}/properties/${propertyId}`),
bulkLinkCoordinator: (id: string, data: { responsibilities: CoordinatorResponsibility[] }) =>
  botApi.post(`/admin/coordinators/${id}/properties/bulk-link`, data),
```

### `apps/web/src/lib/queries.ts`

`fetchProperty` ganha uma terceira query paralela (mesmo padrão de `media` em
`queries.ts:110-122`):

```typescript
supabase
  .from('PropertyCoordinator')
  .select('*, coordinator:Coordinator(*)')
  .eq('propertyId', id),
```

### `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`

Na aba "Detalhes" (linhas 427-483), `InfoRow` opcional, só leitura:

```tsx
{showCoordinators.length > 0 && (
  <InfoRow label="Responsável" value={showCoordinators.map((c) => c.coordinator.name).join(', ')} />
)}
```

Edição fica só na página `/coordinators` — evita duplicar UI de gestão em dois lugares.

## Activity log keys

| Key | actorType | subjectType | Quando |
|---|---|---|---|
| `coordinator_created` | `user` | `coordinator` | responsável cadastrado |
| `coordinator_updated` | `user` | `coordinator` | nome/telefone alterado |
| `coordinator_deleted` | `user` | `coordinator` | responsável removido |
| `coordinator_linked` | `user` | `coordinator` | vinculado a 1 imóvel |
| `coordinator_unlinked` | `user` | `coordinator` | desvinculado de 1 imóvel |
| `coordinator_bulk_linked` | `user` | `coordinator` | vinculado a todos os imóveis de uma vez (`metadata.propertyCount`) |

Adicionar em `docs/activity-actions.md` e em `ActivityLogAction`
(`packages/types/src/activity-log.ts`).

## Edge cases

| Caso | Comportamento |
|---|---|
| Imóvel sem nenhum coordinator vinculado | Bot responde que não há responsável específico; `notifyCoordinators` não envia nada (array vazio) |
| Deletar `Coordinator` com vínculos ativos | 409 — precisa desvincular de todos os imóveis antes (mesma regra de `RuleSet`) |
| `bulk-link` chamado de novo (idempotência) | Só cria vínculo pros imóveis ainda não vinculados a esse coordinator; não duplica nem falha |
| Mesma pessoa com papéis diferentes em imóveis diferentes | Suportado nativamente — `responsibilities` é por vínculo, editável individualmente após o bulk-link |
| Reagendamento de visita (nova data) | `notifyCoordinators` dispara de novo a cada mudança de `scheduledVisitAt`, não só na primeira vez |
| Telefone mal formatado | Mesma validação/máscara já usada em `Owner.notificationPhone`; normalização de `+` no envio, igual `notifyOwner` |

## Testes / verificação

- Migration aplica limpo em dev (`bunx prisma migrate dev`)
- `POST /admin/coordinators/:id/properties/bulk-link`: com 50 imóveis do owner, cria 50 vínculos em uma transação; chamado de novo não duplica
- `describeProperty`: com coordinator `show_property` vinculado, fato aparece; sem vínculo, fato ausente (não aparece linha vazia)
- Bot: pergunta "quem eu procuro no dia da visita" responde com o fato, não aciona `wants_human` (teste de regressão do bug relatado)
- `notifyCoordinators`: chamado ao agendar visita via bot e via `POST /admin/visits`; falha de envio não bloqueia o fluxo (non-blocking, `Promise.allSettled`)
- Web: página `/coordinators` cria, edita, remove, vincula, desvincula e aplica em lote; `bunx tsc --noEmit` e `bunx oxlint` verdes em `apps/web` e `apps/bot`
