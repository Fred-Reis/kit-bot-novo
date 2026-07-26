# Property Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a proprietário cadastrar responsáveis (nome + WhatsApp) reutilizáveis entre imóveis, vinculados com responsabilidades por imóvel (mostrar imóvel, entregar chave, receber chave, vistoria); o bot usa isso pra responder "quem eu procuro" na visita em vez de escalar pra humano; o painel notifica o responsável via WhatsApp quando uma visita é agendada.

**Architecture:** Nova entidade `Coordinator` (reutilizável, por owner) + join table `PropertyCoordinator` (propertyId + coordinatorId, com `responsibilities: String[]` no vínculo) — mesmo padrão já usado em `RuleSet`/`PropertyRuleSet`/`Property`. Bot lê via `catalog.ts` (cache Redis existente) e injeta o fato no contexto do lead agent; painel gerencia numa página própria (`/coordinators`), mirror de `/rules`.

**Tech Stack:** Prisma + Fastify + `bun:test` (bot); React 19 + TanStack Query + Supabase JS + `vitest` (web).

## Global Constraints

- `bun` para tudo (nunca npm/yarn) — `cd apps/bot && bun test`, `cd apps/web && bunx vitest run`
- `bunx tsc --noEmit` verde em `apps/bot` e `apps/web` ao final
- `bunx oxlint` sem warnings novos
- Sem cores hardcoded em componentes React — usar CSS variables existentes (`text-muted-foreground`, etc.)
- Named export nos componentes React — nunca `export default`
- Todas as rotas admin usam `preHandler: verifyAdminJwt` e validam `ownerId` (single-tenant: sempre `prisma.owner.findFirst()`)
- RLS: policy criada junto com a migration, mas **não ativa** globalmente ainda (gated — ver PR #29). Não tentar rodar `ENABLE ROW LEVEL SECURITY` nesta feature.
- Fora de escopo: fluxo v2 do bot (`agentar_visita` tool em `apps/bot/src/agents/tools.ts:171`) — só o fluxo v1 (`apps/bot/src/flows/lead/index.ts`) e o endpoint manual (`POST /admin/visits`) recebem a notificação nesta feature; v2 está gated e não roda em produção hoje.

---

## Task 1: Schema — models `Coordinator` e `PropertyCoordinator`

**Files:**
- Modify: `apps/bot/prisma/schema.prisma`
- Create: `apps/bot/prisma/migrations/20260726010000_property_coordinator/migration.sql`

**Interfaces:**
- Produces: modelos Prisma `Coordinator` (`id`, `ownerId`, `name`, `phone`, `createdAt`) e `PropertyCoordinator` (`propertyId`, `coordinatorId`, `responsibilities: String[]`) — usados por todas as tasks seguintes via `prisma.coordinator` / `prisma.propertyCoordinator`.

- [ ] **Step 1: Adicionar os models no schema**

Em `apps/bot/prisma/schema.prisma`, adicionar `coordinators Coordinator[]` no `model Owner` (junto das outras relações, ex: depois de `ruleSets RuleSet[]`) e `coordinators PropertyCoordinator[]` no `model Property` (junto de `ruleSets PropertyRuleSet[]`). Depois, adicionar os dois models novos (após `model PropertyRuleSet`, antes de `model ContractTemplate`):

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

- [ ] **Step 2: Gerar o client Prisma**

Run: `cd apps/bot && bunx prisma generate`
Expected: `Generated Prisma Client` sem erros.

- [ ] **Step 3: Escrever a migration manualmente**

Criar `apps/bot/prisma/migrations/20260726010000_property_coordinator/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "Coordinator" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coordinator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyCoordinator" (
    "propertyId" TEXT NOT NULL,
    "coordinatorId" TEXT NOT NULL,
    "responsibilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "PropertyCoordinator_pkey" PRIMARY KEY ("propertyId","coordinatorId")
);

-- CreateIndex
CREATE INDEX "Coordinator_ownerId_idx" ON "Coordinator"("ownerId");

-- AddForeignKey
ALTER TABLE "Coordinator" ADD CONSTRAINT "Coordinator_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCoordinator" ADD CONSTRAINT "PropertyCoordinator_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyCoordinator" ADD CONSTRAINT "PropertyCoordinator_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "Coordinator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RowLevelSecurity (created but not enabled — see PR #29 / docs/adrs/001-rls-strategy.md)
ALTER TABLE "Coordinator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Coordinator" FORCE ROW LEVEL SECURITY;
CREATE POLICY "select_own_rows" ON "Coordinator"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");

ALTER TABLE "PropertyCoordinator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PropertyCoordinator" FORCE ROW LEVEL SECURITY;
CREATE POLICY "select_own_rows" ON "PropertyCoordinator"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Property" p WHERE p.id = "propertyId" AND auth.uid()::text = p."ownerId"
  ));
```

> Nota: `ENABLE ROW LEVEL SECURITY` habilita RLS só nessas 2 tabelas novas (sem afetar as demais); não é a "ativação geral" gated do PR #29, que é sobre destravar o enforcement em todas as tabelas de uma vez para o app já funcionar sem quebrar. Aqui as tabelas nascem protegidas desde o início, igual `RuleSet`/`PropertyRuleSet` fizeram na migration `20260717000001_rls_policies`.

- [ ] **Step 4: Aplicar a migration em dev**

Run: `cd apps/bot && bunx prisma migrate dev`
Expected: prompt reconhece a migration já escrita manualmente (nome bate com a pasta) e aplica sem re-gerar; ou, se pedir para criar do diff, responda não e confirme que a pasta manual já existe. Ao final, `prisma migrate status` deve mostrar a migration aplicada.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/prisma/schema.prisma apps/bot/prisma/migrations/20260726010000_property_coordinator
git commit -m "feat(bot): add Coordinator and PropertyCoordinator schema"
```

---

## Task 2: Tipos compartilhados e activity log

**Files:**
- Create: `packages/types/src/coordinator.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/property.ts`
- Modify: `packages/types/src/activity-log.ts`

**Interfaces:**
- Consumes: nenhuma (tipos puros)
- Produces: `CoordinatorResponsibility`, `Coordinator`, `PropertyCoordinatorLink`, `CoordinatorSummary`, `CoordinatorDetail` — usados por todas as tasks web (10-14) e pela task 3 (bot).

- [ ] **Step 1: Criar `packages/types/src/coordinator.ts`**

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

export interface CoordinatorSummary extends Coordinator {
  _count: { properties: number };
}

export interface LinkedPropertyWithResponsibilities {
  propertyId: string;
  externalId: string;
  responsibilities: CoordinatorResponsibility[];
}

export interface CoordinatorDetail extends Coordinator {
  linkedProperties: LinkedPropertyWithResponsibilities[];
}

export interface PropertyCoordinatorLink {
  responsibilities: CoordinatorResponsibility[];
  coordinator: Pick<Coordinator, 'id' | 'name' | 'phone'>;
}
```

- [ ] **Step 2: Exportar no barrel do pacote**

Em `packages/types/src/index.ts`, adicionar (ordem alfabética, junto das outras linhas `export * from`):

```typescript
export * from './coordinator';
```

- [ ] **Step 3: Adicionar `coordinators` em `Property`**

Em `packages/types/src/property.ts`, importar `PropertyCoordinatorLink` e adicionar o campo (opcional — nem toda query inclui a relação):

```typescript
import type { PropertyCoordinatorLink } from './coordinator';

export interface Property {
  // ...campos existentes...
  coordinators?: PropertyCoordinatorLink[];
}
```

- [ ] **Step 4: Adicionar as 6 novas actions e o novo subjectType**

Em `packages/types/src/activity-log.ts`:

```typescript
export type ActivityLogSubjectType =
  | 'lead'
  | 'tenant'
  | 'property'
  | 'contract'
  | 'payment'
  | 'template'
  | 'rule_set'
  | 'coordinator'
  | 'owner'
  | 'workspace';

export type ActivityLogAction =
  | 'lead_created'
  // ...todas as existentes, sem remover nenhuma...
  | 'document_reclassified'
  | 'coordinator_created'
  | 'coordinator_updated'
  | 'coordinator_deleted'
  | 'coordinator_linked'
  | 'coordinator_unlinked'
  | 'coordinator_bulk_linked';
```

- [ ] **Step 5: Verificar tipos**

Run: `cd apps/bot && bunx tsc --noEmit && cd ../web && bunx tsc --noEmit`
Expected: sem erros novos (o campo `coordinators` opcional não quebra nenhum construtor de `Property` existente).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src
git commit -m "feat(types): add Coordinator types and activity log actions"
```

---

## Task 3: `catalog.ts` — fato "Responsável pela visita" no contexto do bot

**Files:**
- Modify: `apps/bot/src/services/catalog.ts`
- Test: `apps/bot/src/__tests__/catalog-coordinators.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (função pura nova)
- Produces: `coordinatorFact(coordinators: PropertyCoordinatorLink[]): string | null` — exportada; consumida por `describeProperty`/`describePropertyTerms` no mesmo arquivo, e (mais tarde, indiretamente) pelo lead agent via `renderLeadContext`.

- [ ] **Step 1: Escrever o teste (falhando)**

Criar `apps/bot/src/__tests__/catalog-coordinators.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { coordinatorFact } from '@/services/catalog';
import type { PropertyCoordinatorLink } from '@kit-manager/types';

describe('coordinatorFact', () => {
  test('retorna null quando não há coordinators', () => {
    expect(coordinatorFact([])).toBeNull();
  });

  test('retorna null quando nenhum tem show_property', () => {
    const links: PropertyCoordinatorLink[] = [
      { responsibilities: ['deliver_keys'], coordinator: { id: '1', name: 'Maria', phone: '11999990000' } },
    ];
    expect(coordinatorFact(links)).toBeNull();
  });

  test('formata um responsável com show_property', () => {
    const links: PropertyCoordinatorLink[] = [
      { responsibilities: ['show_property'], coordinator: { id: '1', name: 'João', phone: '11988887777' } },
    ];
    expect(coordinatorFact(links)).toBe('Responsavel pela visita: João (11988887777)');
  });

  test('formata múltiplos responsáveis com show_property, ignorando quem só tem outras responsabilidades', () => {
    const links: PropertyCoordinatorLink[] = [
      { responsibilities: ['show_property'], coordinator: { id: '1', name: 'João', phone: '11988887777' } },
      { responsibilities: ['deliver_keys', 'receive_keys'], coordinator: { id: '2', name: 'Maria', phone: '11999990000' } },
      { responsibilities: ['show_property', 'inspection'], coordinator: { id: '3', name: 'Ana', phone: '11977776666' } },
    ];
    expect(coordinatorFact(links)).toBe(
      'Responsavel pela visita: João (11988887777), Ana (11977776666)',
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd apps/bot && bun test src/__tests__/catalog-coordinators.test.ts`
Expected: FAIL — `coordinatorFact is not exported` ou `is not a function`.

- [ ] **Step 3: Implementar em `catalog.ts`**

No topo do arquivo, ajustar o import de tipos:

```typescript
import type { Property, PropertyMedia } from '@prisma/client';
import type { PropertyCoordinatorLink } from '@kit-manager/types';
```

Adicionar ao `PropertyData` (perto da definição existente):

```typescript
export interface PropertyData extends Property {
  media: PropertyMedia[];
  policies: PolicyEntry[];
  coordinators: PropertyCoordinatorLink[];
}
```

Adicionar a função pura (perto de `describeProperty`, antes dela):

```typescript
export function coordinatorFact(coordinators: PropertyCoordinatorLink[]): string | null {
  const showCoordinators = coordinators.filter((c) => c.responsibilities.includes('show_property'));
  if (showCoordinators.length === 0) return null;
  return `Responsavel pela visita: ${showCoordinators
    .map((c) => `${c.coordinator.name} (${c.coordinator.phone})`)
    .join(', ')}`;
}
```

Em `describeProperty`, logo após a linha `if (p.media.length > 0) facts.push(...)`:

```typescript
  const visitCoordinator = coordinatorFact(p.coordinators);
  if (visitCoordinator) facts.push(visitCoordinator);
```

Em `describePropertyTerms`, logo após a linha `if (p.media.length > 0) facts.push(...)`:

```typescript
  const visitCoordinatorTerms = coordinatorFact(p.coordinators);
  if (visitCoordinatorTerms) facts.push(visitCoordinatorTerms);
```

- [ ] **Step 4: Rodar o teste de novo**

Run: `cd apps/bot && bun test src/__tests__/catalog-coordinators.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Incluir `coordinators` nas queries do Prisma**

Em `getPropertyByExternalId` e `listAvailableProperties`, trocar:

```typescript
include: { media: { orderBy: { order: 'asc' } }, ...POLICY_INCLUDE },
```

por:

```typescript
include: {
  media: { orderBy: { order: 'asc' } },
  coordinators: { include: { coordinator: true } },
  ...POLICY_INCLUDE,
},
```

(nos dois lugares — `getPropertyByExternalId` e `listAvailableProperties`). O destructure `const { ruleSets: _, ...rest } = property;` já preserva `coordinators` em `rest` automaticamente (não precisa mudar essa linha).

- [ ] **Step 6: Checar tipos**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros. Se o shape do include (`{ coordinator: {...} }` vs `PropertyCoordinatorLink.coordinator`) não bater exatamente, ajustar o mapeamento com um `.map()` no retorno de cada função (mesmo padrão de `extractPolicies`).

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/services/catalog.ts apps/bot/src/__tests__/catalog-coordinators.test.ts
git commit -m "feat(bot): inject visit coordinator fact into lead agent context"
```

---

## Task 4: Rotas admin — CRUD de `Coordinator`

**Files:**
- Create: `apps/bot/src/routes/admin/coordinators.ts`
- Modify: `apps/bot/src/routes/admin/index.ts`
- Modify: `docs/activity-actions.md`

**Interfaces:**
- Consumes: `prisma.coordinator` (Task 1), `ActivityLogAction` `coordinator_created`/`coordinator_updated`/`coordinator_deleted` (Task 2)
- Produces: `GET/POST /admin/coordinators`, `PATCH/DELETE /admin/coordinators/:id` — consumidos pela Task 10 (web `api.ts`)

- [ ] **Step 1: Criar o arquivo de rotas com CRUD básico**

Criar `apps/bot/src/routes/admin/coordinators.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity as logActivityHelper } from '@/services/activity';
import { invalidateAvailablePropertiesCache, invalidatePropertyCache } from '@/services/catalog';

export const VALID_RESPONSIBILITIES = new Set([
  'show_property',
  'deliver_keys',
  'receive_keys',
  'inspection',
]);

export function validateResponsibilities(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string' && VALID_RESPONSIBILITIES.has(v))) return null;
  return value as string[];
}

export async function coordinatorsRoutes(fastify: FastifyInstance): Promise<void> {
  // ─── list coordinators ──────────────────────────────────────────────────
  fastify.get('/admin/coordinators', { preHandler: verifyAdminJwt }, async (_request, reply) => {
    const coordinators = await prisma.coordinator.findMany({
      include: { _count: { select: { properties: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send(coordinators);
  });

  // ─── create coordinator ─────────────────────────────────────────────────
  fastify.post<{ Body: { name: string; phone: string } }>(
    '/admin/coordinators',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { name, phone } = request.body;
      if (!name) return reply.status(400).send({ error: 'name is required' });
      if (!phone) return reply.status(400).send({ error: 'phone is required' });
      const owner = await prisma.owner.findFirst();
      if (!owner) return reply.status(400).send({ error: 'No owner found' });
      const coordinator = await prisma.coordinator.create({
        data: { name, phone, ownerId: owner.id },
      });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_created',
        subject: coordinator.name,
        subjectId: coordinator.id,
        subjectType: 'coordinator',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send(coordinator);
    },
  );

  // ─── update coordinator ─────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string }; Body: { name?: string; phone?: string } }>(
    '/admin/coordinators/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { name, phone } = request.body;
      const existing = await prisma.coordinator.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return reply.status(404).send({ error: 'Coordinator not found' });
      const data: Record<string, unknown> = {};
      if (name !== undefined) data.name = name;
      if (phone !== undefined) data.phone = phone;
      const coordinator = await prisma.coordinator.update({ where: { id }, data });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_updated',
        subject: coordinator.name,
        subjectId: coordinator.id,
        subjectType: 'coordinator',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send(coordinator);
    },
  );

  // ─── delete coordinator ─────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/admin/coordinators/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const existing = await prisma.coordinator.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Coordinator not found' });
      const linked = await prisma.propertyCoordinator.count({ where: { coordinatorId: id } });
      if (linked > 0) {
        return reply.status(409).send({ error: 'Coordinator is linked to properties — unlink first' });
      }
      await prisma.coordinator.delete({ where: { id } });
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: existing.ownerId,
        action: 'coordinator_deleted',
        subject: existing.name,
        subjectId: existing.id,
        subjectType: 'coordinator',
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send({ success: true });
    },
  );
}
```

Nota: `invalidateAvailablePropertiesCache`/`invalidatePropertyCache` importados aqui só serão usados na Task 5 (endpoints de vínculo) — deixá-los importados já agora deixaria `oxlint` reclamar de import não usado; **não** adicionar esse import nesta task, só na Task 5. (Remover a linha de import deles do bloco acima.)

- [ ] **Step 2: Registrar as rotas**

Em `apps/bot/src/routes/admin/index.ts`, adicionar o import e a chamada:

```typescript
import { coordinatorsRoutes } from './coordinators';
// ...
  await coordinatorsRoutes(fastify);
```

- [ ] **Step 3: Escrever o teste da validação pura**

Criar `apps/bot/src/__tests__/coordinators-validation.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { validateResponsibilities } from '@/routes/admin/coordinators';

describe('validateResponsibilities', () => {
  test('aceita array com valores válidos', () => {
    expect(validateResponsibilities(['show_property', 'inspection'])).toEqual([
      'show_property',
      'inspection',
    ]);
  });

  test('aceita array vazio', () => {
    expect(validateResponsibilities([])).toEqual([]);
  });

  test('rejeita valor inválido', () => {
    expect(validateResponsibilities(['show_property', 'lava_louca'])).toBeNull();
  });

  test('rejeita não-array', () => {
    expect(validateResponsibilities('show_property')).toBeNull();
    expect(validateResponsibilities(undefined)).toBeNull();
  });
});
```

- [ ] **Step 4: Rodar o teste**

Run: `cd apps/bot && bun test src/__tests__/coordinators-validation.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Checar tipos e lint**

Run: `cd apps/bot && bunx tsc --noEmit && bunx oxlint src/routes/admin/coordinators.ts src/routes/admin/index.ts`
Expected: sem erros/warnings.

- [ ] **Step 6: Verificação manual do CRUD**

Com o bot rodando (`cd apps/bot && bun run dev`) e um JWT válido de admin:

```bash
curl -X POST http://localhost:3000/admin/coordinators \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"name":"João Zelador","phone":"11988887777"}'
# Espera 201 com o coordinator criado

curl http://localhost:3000/admin/coordinators -H "Authorization: Bearer $JWT"
# Espera array com o coordinator e _count.properties: 0
```

- [ ] **Step 7: Adicionar as 3 chaves em `docs/activity-actions.md`**

Na tabela "Chaves por slice", adicionar (nova linha "Slice — Responsáveis"):

```markdown
| `coordinator_created` | `user` | `coordinator` | Responsáveis |
| `coordinator_updated` | `user` | `coordinator` | Responsáveis |
| `coordinator_deleted` | `user` | `coordinator` | Responsáveis |
```

- [ ] **Step 8: Commit**

```bash
git add apps/bot/src/routes/admin/coordinators.ts apps/bot/src/routes/admin/index.ts apps/bot/src/__tests__/coordinators-validation.test.ts docs/activity-actions.md
git commit -m "feat(bot): add Coordinator CRUD admin routes"
```

---

## Task 5: Rotas admin — vínculo, edição de responsabilidades, desvínculo e bulk-link

**Files:**
- Modify: `apps/bot/src/routes/admin/coordinators.ts`
- Modify: `docs/activity-actions.md`

**Interfaces:**
- Consumes: `validateResponsibilities`, `VALID_RESPONSIBILITIES` (Task 4); `prisma.propertyCoordinator` (Task 1)
- Produces: `POST /admin/coordinators/:id/properties`, `PATCH/DELETE /admin/coordinators/:id/properties/:propertyId`, `POST /admin/coordinators/:id/properties/bulk-link` — consumidos pela Task 10 (web `api.ts`)

- [ ] **Step 1: Adicionar o import de invalidação de cache**

No topo de `apps/bot/src/routes/admin/coordinators.ts`, adicionar:

```typescript
import { invalidateAvailablePropertiesCache, invalidatePropertyCache } from '@/services/catalog';
```

- [ ] **Step 2: Endpoint de vínculo (link)**

Adicionar dentro de `coordinatorsRoutes`, após o `delete coordinator`:

```typescript
  // ─── link property to coordinator ──────────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { propertyId: string; responsibilities: string[] } }>(
    '/admin/coordinators/:id/properties',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { propertyId } = request.body;
      if (!propertyId) return reply.status(400).send({ error: 'propertyId is required' });
      const responsibilities = validateResponsibilities(request.body.responsibilities);
      if (!responsibilities) {
        return reply
          .status(400)
          .send({ error: `responsibilities must be an array of: ${[...VALID_RESPONSIBILITIES].join(', ')}` });
      }
      const coordinator = await prisma.coordinator.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      if (!coordinator) return reply.status(404).send({ error: 'Coordinator not found' });
      const property = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { id: true, ownerId: true },
      });
      if (!property || property.ownerId !== coordinator.ownerId) {
        return reply.status(404).send({ error: 'Property not found' });
      }
      const existing = await prisma.propertyCoordinator.findUnique({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      if (existing) {
        return reply.status(409).send({ error: 'Property is already linked to this coordinator' });
      }
      await prisma.propertyCoordinator.create({
        data: { coordinatorId: id, propertyId, responsibilities },
      });
      await invalidatePropertyCache(propertyId);
      await invalidateAvailablePropertiesCache();
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_linked',
        subject: coordinator.name,
        subjectId: id,
        subjectType: 'coordinator',
        metadata: { propertyId, responsibilities },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.status(201).send({ success: true });
    },
  );
```

- [ ] **Step 3: Endpoint de edição do vínculo**

```typescript
  // ─── update link responsibilities ──────────────────────────────────────
  fastify.patch<{
    Params: { id: string; propertyId: string };
    Body: { responsibilities: string[] };
  }>(
    '/admin/coordinators/:id/properties/:propertyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, propertyId } = request.params;
      const responsibilities = validateResponsibilities(request.body.responsibilities);
      if (!responsibilities) {
        return reply
          .status(400)
          .send({ error: `responsibilities must be an array of: ${[...VALID_RESPONSIBILITIES].join(', ')}` });
      }
      const existing = await prisma.propertyCoordinator.findUnique({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      if (!existing) return reply.status(404).send({ error: 'Link not found' });
      const link = await prisma.propertyCoordinator.update({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
        data: { responsibilities },
      });
      await invalidatePropertyCache(propertyId);
      await invalidateAvailablePropertiesCache();
      return reply.send(link);
    },
  );
```

- [ ] **Step 4: Endpoint de desvínculo (unlink)**

```typescript
  // ─── unlink property from coordinator ──────────────────────────────────
  fastify.delete<{ Params: { id: string; propertyId: string } }>(
    '/admin/coordinators/:id/properties/:propertyId',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id, propertyId } = request.params;
      const coordinator = await prisma.coordinator.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      const existing = await prisma.propertyCoordinator.findUnique({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      if (!existing || !coordinator) return reply.status(404).send({ error: 'Link not found' });
      await prisma.propertyCoordinator.delete({
        where: { propertyId_coordinatorId: { propertyId, coordinatorId: id } },
      });
      await invalidatePropertyCache(propertyId);
      await invalidateAvailablePropertiesCache();
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_unlinked',
        subject: coordinator.name,
        subjectId: id,
        subjectType: 'coordinator',
        metadata: { propertyId },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send({ success: true });
    },
  );
```

- [ ] **Step 5: Endpoint de bulk-link**

```typescript
  // ─── bulk-link coordinator to all active properties ────────────────────
  fastify.post<{ Params: { id: string }; Body: { responsibilities: string[] } }>(
    '/admin/coordinators/:id/properties/bulk-link',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const responsibilities = validateResponsibilities(request.body.responsibilities);
      if (!responsibilities) {
        return reply
          .status(400)
          .send({ error: `responsibilities must be an array of: ${[...VALID_RESPONSIBILITIES].join(', ')}` });
      }
      const coordinator = await prisma.coordinator.findUnique({
        where: { id },
        select: { ownerId: true, name: true },
      });
      if (!coordinator) return reply.status(404).send({ error: 'Coordinator not found' });

      const alreadyLinked = await prisma.propertyCoordinator.findMany({
        where: { coordinatorId: id },
        select: { propertyId: true },
      });
      const linkedIds = new Set(alreadyLinked.map((l) => l.propertyId));

      const targetProperties = await prisma.property.findMany({
        where: { ownerId: coordinator.ownerId, active: true, id: { notIn: [...linkedIds] } },
        select: { id: true },
      });
      if (targetProperties.length === 0) {
        return reply.send({ success: true, propertyCount: 0 });
      }

      await prisma.$transaction(
        targetProperties.map((p) =>
          prisma.propertyCoordinator.create({
            data: { coordinatorId: id, propertyId: p.id, responsibilities },
          }),
        ),
      );
      await Promise.all(targetProperties.map((p) => invalidatePropertyCache(p.id)));
      await invalidateAvailablePropertiesCache();
      await logActivityHelper({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: coordinator.ownerId,
        action: 'coordinator_bulk_linked',
        subject: coordinator.name,
        subjectId: id,
        subjectType: 'coordinator',
        metadata: { propertyCount: targetProperties.length, responsibilities },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send({ success: true, propertyCount: targetProperties.length });
    },
  );
```

- [ ] **Step 6: Checar tipos e lint**

Run: `cd apps/bot && bunx tsc --noEmit && bunx oxlint src/routes/admin/coordinators.ts`
Expected: sem erros.

- [ ] **Step 7: Verificação manual**

```bash
curl -X POST http://localhost:3000/admin/coordinators/$COORDINATOR_ID/properties \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"propertyId":"'"$PROPERTY_ID"'","responsibilities":["show_property"]}'
# Espera 201

curl -X POST http://localhost:3000/admin/coordinators/$COORDINATOR_ID/properties/bulk-link \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"responsibilities":["show_property"]}'
# Espera 200 com propertyCount = número de imóveis ativos ainda não vinculados

# Chamar de novo — idempotente, não duplica
curl -X POST http://localhost:3000/admin/coordinators/$COORDINATOR_ID/properties/bulk-link \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"responsibilities":["show_property"]}'
# Espera 200 com propertyCount = 0
```

- [ ] **Step 8: Adicionar as 3 chaves restantes em `docs/activity-actions.md`**

```markdown
| `coordinator_linked` | `user` | `coordinator` | Responsáveis |
| `coordinator_unlinked` | `user` | `coordinator` | Responsáveis |
| `coordinator_bulk_linked` | `user` | `coordinator` | Responsáveis |
```

- [ ] **Step 9: Commit**

```bash
git add apps/bot/src/routes/admin/coordinators.ts docs/activity-actions.md
git commit -m "feat(bot): add Coordinator property link/unlink/bulk-link endpoints"
```

---

## Task 6: Guardrail `wants_human` no extrator (corrige a causa raiz do bug)

**Files:**
- Modify: `apps/bot/src/agents/lead.ts`
- Test: `apps/bot/src/__tests__/lead-prompts.test.ts`

**Interfaces:**
- Produces: `EXTRACTOR_SYSTEM_PROMPT` exportado — usado pelo teste de regressão.

- [ ] **Step 1: Exportar os 3 prompts relevantes**

Em `apps/bot/src/agents/lead.ts`, trocar `const` por `export const` nas linhas 32, 51 e 97:

```typescript
export const INFO_AGENT_PROMPT = `Voce cuida apenas de responder duvidas sobre o imovel...`;
export const SCHEDULING_AGENT_PROMPT = `Voce cuida apenas do agendamento de visita...`;
export const EXTRACTOR_SYSTEM_PROMPT = `Voce extrai apenas dados estruturados...`;
```

(mantém o conteúdo idêntico — só adiciona `export`)

- [ ] **Step 2: Escrever o teste de regressão (falhando)**

Criar `apps/bot/src/__tests__/lead-prompts.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { EXTRACTOR_SYSTEM_PROMPT, INFO_AGENT_PROMPT, SCHEDULING_AGENT_PROMPT } from '@/agents/lead';

describe('EXTRACTOR_SYSTEM_PROMPT — wants_human guardrail', () => {
  test('tem regra explícita de quando wants_human deve ser true', () => {
    expect(EXTRACTOR_SYSTEM_PROMPT).toMatch(/wants_human = true APENAS/);
  });

  test('explicita que perguntas ambíguas não configuram wants_human', () => {
    expect(EXTRACTOR_SYSTEM_PROMPT.toLowerCase()).toContain('não configuram wants_human');
  });
});

describe('prompts de agente — fato do responsável pela visita', () => {
  test('INFO_AGENT_PROMPT instrui a responder "quem procurar" com o fato do contexto', () => {
    expect(INFO_AGENT_PROMPT.toLowerCase()).toContain('responsavel pela visita');
  });

  test('SCHEDULING_AGENT_PROMPT instrui a responder "quem procurar" com o fato do contexto', () => {
    expect(SCHEDULING_AGENT_PROMPT.toLowerCase()).toContain('responsavel pela visita');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `cd apps/bot && bun test src/__tests__/lead-prompts.test.ts`
Expected: FAIL — nenhuma das strings existe ainda nos prompts.

- [ ] **Step 4: Adicionar a regra no `EXTRACTOR_SYSTEM_PROMPT`**

Adicionar como última linha do template (antes do fechamento da crase), junto das outras regras com `-`:

```
- wants_human = true APENAS quando a pessoa pedir explicitamente para falar com atendente, pessoa, corretor ou humano (ex: "quero falar com alguem", "tem atendente?", "quero uma pessoa real"). Perguntas sobre o imovel, a visita ou o processo — mesmo que a resposta nao esteja clara no contexto — NAO configuram wants_human.`;
```

- [ ] **Step 5: Adicionar a regra no `INFO_AGENT_PROMPT` e `SCHEDULING_AGENT_PROMPT`**

Em ambos os templates, adicionar como regra:

```
- Se a pessoa perguntar quem procurar, quem vai mostrar o imovel ou quem recebe no dia da visita, responda com o "Responsavel pela visita" presente no contexto. Se esse fato nao estiver no contexto, diga que qualquer pessoa presente no local vai atende-la e que nao ha responsavel especifico cadastrado no momento. Nunca invente nome ou telefone.
```

- [ ] **Step 6: Rodar o teste de novo**

Run: `cd apps/bot && bun test src/__tests__/lead-prompts.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 7: Checar tipos**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/bot/src/agents/lead.ts apps/bot/src/__tests__/lead-prompts.test.ts
git commit -m "fix(bot): constrain wants_human extraction and answer visit-coordinator questions"
```

---

## Task 7: `notify.ts` — `notifyCoordinators`

**Files:**
- Modify: `apps/bot/src/services/notify.ts`
- Test: `apps/bot/src/__tests__/notify-coordinators.test.ts`

**Interfaces:**
- Consumes: `sendText` (já existe em `@/services/evolution`), `prisma.propertyCoordinator` (Task 1)
- Produces: `notifyCoordinators(propertyId, payload): Promise<void>` e `buildVisitScheduledMessage(payload): string` (exportada para teste) — consumida pela Task 8.

- [ ] **Step 1: Escrever o teste da função pura de mensagem (falhando)**

Criar `apps/bot/src/__tests__/notify-coordinators.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { buildVisitScheduledMessage } from '@/services/notify';

describe('buildVisitScheduledMessage', () => {
  test('formata a mensagem de visita agendada', () => {
    const msg = buildVisitScheduledMessage({
      leadName: 'Maria Silva',
      leadPhone: '11999998888',
      scheduledVisitAt: '2026-07-27T15:00:00-03:00',
      propertyExternalId: 'AP-007',
    });
    expect(msg).toContain('AP-007');
    expect(msg).toContain('Maria Silva');
    expect(msg).toContain('11999998888');
    expect(msg).toContain('27/07/2026');
    expect(msg).toContain('15:00');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd apps/bot && bun test src/__tests__/notify-coordinators.test.ts`
Expected: FAIL — `buildVisitScheduledMessage is not exported`.

- [ ] **Step 3: Implementar em `notify.ts`**

Adicionar ao final de `apps/bot/src/services/notify.ts` (após a função `notifyOwner`):

```typescript
export function buildVisitScheduledMessage(payload: {
  leadName: string;
  leadPhone: string;
  scheduledVisitAt: string;
  propertyExternalId: string;
}): string {
  const date = new Date(payload.scheduledVisitAt);
  const tz = 'America/Sao_Paulo';
  const dateStr = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: tz,
  });
  const timeStr = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
  return (
    `📅 Nova visita agendada\n` +
    `Imóvel: ${payload.propertyExternalId}\n` +
    `Lead: ${payload.leadName} (${payload.leadPhone})\n` +
    `Data: ${dateStr} às ${timeStr}`
  );
}

export async function notifyCoordinators(
  propertyId: string,
  payload: {
    leadName: string;
    leadPhone: string;
    scheduledVisitAt: string;
    propertyExternalId: string;
  },
): Promise<void> {
  try {
    const links = await prisma.propertyCoordinator.findMany({
      where: { propertyId, responsibilities: { has: 'show_property' } },
      include: { coordinator: true },
    });
    if (links.length === 0) return;

    const message = buildVisitScheduledMessage(payload);
    const results = await Promise.allSettled(
      links.map((link) => {
        const phone = link.coordinator.phone.replace(/^\+/, '');
        return sendText(`${phone}@s.whatsapp.net`, message);
      }),
    );
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.warn(
          { err: r.reason, coordinatorId: links[i]?.coordinatorId },
          'notifyCoordinators: whatsapp send failed',
        );
      }
    });
  } catch (err) {
    logger.error({ err }, 'notifyCoordinators failed (non-blocking)');
  }
}
```

- [ ] **Step 4: Rodar o teste de novo**

Run: `cd apps/bot && bun test src/__tests__/notify-coordinators.test.ts`
Expected: PASS.

- [ ] **Step 5: Checar tipos**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros (confirmar que `prisma` já está importado no topo de `notify.ts` — já está, linha 3).

- [ ] **Step 6: Commit**

```bash
git add apps/bot/src/services/notify.ts apps/bot/src/__tests__/notify-coordinators.test.ts
git commit -m "feat(bot): add notifyCoordinators for visit scheduling"
```

---

## Task 8: Disparar `notifyCoordinators` ao agendar visita

**Files:**
- Modify: `apps/bot/src/flows/lead/index.ts`
- Modify: `apps/bot/src/routes/admin/visits.ts`

**Interfaces:**
- Consumes: `notifyCoordinators` (Task 7)

- [ ] **Step 1: Disparar no fluxo v1 do bot**

Em `apps/bot/src/flows/lead/index.ts`, dentro do bloco `if (visitDateChanged) { ... }` (linhas 535-551), adicionar a chamada logo após o cálculo de `dateStr`/`timeStr`, antes de montar `replyText`:

```typescript
        const propertyName = snapshot.propertyInFocus?.name ?? 'o imóvel';
        if (snapshot.propertyInFocus) {
          notifyCoordinators(snapshot.propertyInFocus.id, {
            leadName: lead.name ?? chatId,
            leadPhone: chatId,
            scheduledVisitAt: newVisitAt.toISOString(),
            propertyExternalId: snapshot.propertyInFocus.externalId,
          }).catch((err) => logger.error({ err }, '[lead.flow] notifyCoordinators failed'));
        }
        replyText = `✅ Visita confirmada! Aguardamos você no dia ${dateStr} às ${timeStr} no ${propertyName}. Qualquer dúvida, é só chamar!`;
```

Adicionar o import no topo do arquivo (junto dos outros imports de `@/services/notify`, se já existir; senão criar a linha):

```typescript
import { notifyCoordinators } from '@/services/notify';
```

- [ ] **Step 2: Disparar no endpoint manual do painel**

Em `apps/bot/src/routes/admin/visits.ts`, no handler `POST /admin/visits`, adicionar a chamada antes do `logActivityHelper` (linha ~115), usando `property` (já buscado na linha 88) e `lead`:

```typescript
    notifyCoordinators(propertyId, {
      leadName: lead.name ?? lead.phone,
      leadPhone: lead.phone,
      scheduledVisitAt: visitDate.toISOString(),
      propertyExternalId: property.externalId,
    }).catch((err) => fastify.log.error({ err }, '[visits] notifyCoordinators failed'));
```

Adicionar o import no topo do arquivo:

```typescript
import { notifyCoordinators } from '@/services/notify';
```

- [ ] **Step 3: Checar tipos**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: sem erros. Se `property` não tiver `externalId` no `select` da query original de `visits.ts`, confirmar que o `findUnique` sem `select` explícito já retorna o objeto completo (é o caso — linha 88 usa `prisma.property.findUnique({ where: { id: propertyId } })` sem `select`).

- [ ] **Step 4: Verificação manual**

Com um coordinator vinculado ao imóvel com `show_property` (criado na Task 5) e um lead de teste:

```bash
curl -X POST http://localhost:3000/admin/visits \
  -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"leadId":"'"$LEAD_ID"'","propertyId":"'"$PROPERTY_ID"'","scheduledVisitAt":"2026-07-28T15:00:00-03:00"}'
```
Expected: 201; nos logs do bot (`docker compose logs -f bot`), sem erro de `notifyCoordinators`; se Evolution API estiver conectada, o responsável recebe a mensagem no WhatsApp.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/flows/lead/index.ts apps/bot/src/routes/admin/visits.ts
git commit -m "feat(bot): notify visit coordinator when a visit is scheduled"
```

---

## Task 9: `apps/web/src/lib/api.ts` — client das rotas de coordinator

**Files:**
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: endpoints das Tasks 4 e 5
- Produces: `adminApi.createCoordinator`, `.updateCoordinator`, `.deleteCoordinator`, `.linkCoordinatorProperty`, `.updateCoordinatorProperty`, `.unlinkCoordinatorProperty`, `.bulkLinkCoordinator` — consumidos pela Task 12.

- [ ] **Step 1: Adicionar os métodos**

No objeto `adminApi` de `apps/web/src/lib/api.ts`, adicionar (junto dos métodos de `ruleSet`, mesmo estilo):

```typescript
  createCoordinator: (data: { name: string; phone: string }) =>
    botApi.post('/admin/coordinators', data),
  updateCoordinator: (id: string, data: { name?: string; phone?: string }) =>
    botApi.patch(`/admin/coordinators/${id}`, data),
  deleteCoordinator: (id: string) => botApi.delete(`/admin/coordinators/${id}`),
  linkCoordinatorProperty: (
    id: string,
    data: { propertyId: string; responsibilities: string[] },
  ) => botApi.post(`/admin/coordinators/${id}/properties`, data),
  updateCoordinatorProperty: (
    id: string,
    propertyId: string,
    data: { responsibilities: string[] },
  ) => botApi.patch(`/admin/coordinators/${id}/properties/${propertyId}`, data),
  unlinkCoordinatorProperty: (id: string, propertyId: string) =>
    botApi.delete(`/admin/coordinators/${id}/properties/${propertyId}`),
  bulkLinkCoordinator: (id: string, data: { responsibilities: string[] }) =>
    botApi.post(`/admin/coordinators/${id}/properties/bulk-link`, data),
```

- [ ] **Step 2: Checar tipos**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "feat(web): add Coordinator API client methods"
```

---

## Task 10: `apps/web/src/lib/queries.ts` — leitura via Supabase

**Files:**
- Modify: `apps/web/src/lib/queries.ts`

**Interfaces:**
- Consumes: tabelas `Coordinator`/`PropertyCoordinator` (Task 1), tipos `CoordinatorSummary`/`CoordinatorDetail` (Task 2)
- Produces: `fetchCoordinators()`, `fetchCoordinator(id)`, `fetchProperty` estendido com `coordinators` — consumidos pelas Tasks 12 e 13.

- [ ] **Step 1: Adicionar `fetchCoordinators` e `fetchCoordinator`**

Em `apps/web/src/lib/queries.ts`, importar os tipos novos no topo (junto dos outros imports de `@kit-manager/types`):

```typescript
import type { CoordinatorDetail, CoordinatorSummary, PropertyCoordinatorLink } from '@kit-manager/types';
```

Adicionar as funções (mesmo estilo de `fetchRuleSets`/`fetchRuleSet`, após elas):

```typescript
export async function fetchCoordinators(): Promise<CoordinatorSummary[]> {
  const { data, error } = await supabase
    .from('Coordinator')
    .select('*, properties:PropertyCoordinator(count)')
    .order('createdAt', { ascending: true });
  if (error) throw error;
  type RawRow = CoordinatorSummary & { properties: { count: number }[] };
  return ((data ?? []) as RawRow[]).map((r) => ({
    ...r,
    _count: { properties: r.properties[0]?.count ?? 0 },
  }));
}

export async function fetchCoordinator(id: string): Promise<CoordinatorDetail> {
  const [{ data: c, error: cErr }, { data: links, error: linkErr }] = await Promise.all([
    supabase.from('Coordinator').select('*').eq('id', id).single(),
    supabase
      .from('PropertyCoordinator')
      .select('propertyId, responsibilities, property:Property(externalId)')
      .eq('coordinatorId', id),
  ]);
  if (cErr) throw cErr;
  if (linkErr) throw linkErr;
  type LinkRow = {
    propertyId: string;
    responsibilities: string[];
    property: { externalId: string }[];
  };
  return {
    ...(c as CoordinatorDetail),
    linkedProperties: (links ?? []).map((l) => {
      const row = l as unknown as LinkRow;
      return {
        propertyId: row.propertyId,
        externalId: row.property[0]?.externalId ?? row.propertyId,
        responsibilities: row.responsibilities as CoordinatorDetail['linkedProperties'][number]['responsibilities'],
      };
    }),
  };
}
```

- [ ] **Step 2: Estender `fetchProperty` com os coordinators do imóvel**

Em `fetchProperty` (linhas 110-122), trocar o `Promise.all` de 2 queries por 3:

```typescript
export async function fetchProperty(id: string): Promise<Property> {
  const [
    { data: prop, error: propErr },
    { data: media, error: mediaErr },
    { data: coordinators, error: coordErr },
  ] = await Promise.all([
    supabase.from('Property').select('*').eq('id', id).single(),
    supabase.from('PropertyMedia').select('*').eq('propertyId', id).order('order', { ascending: true }),
    supabase
      .from('PropertyCoordinator')
      .select('responsibilities, coordinator:Coordinator(id, name, phone)')
      .eq('propertyId', id),
  ]);
  if (propErr) throw propErr;
  if (mediaErr) throw mediaErr;
  if (coordErr) throw coordErr;
  type CoordRow = { responsibilities: string[]; coordinator: { id: string; name: string; phone: string }[] };
  return {
    ...(prop as Property),
    media: (media as PropertyMedia[]) ?? [],
    coordinators: ((coordinators ?? []) as unknown as CoordRow[])
      .filter((row) => row.coordinator[0])
      .map((row) => ({
        responsibilities: row.responsibilities as PropertyCoordinatorLink['responsibilities'],
        coordinator: row.coordinator[0],
      })),
  };
}
```

- [ ] **Step 3: Checar tipos**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/queries.ts
git commit -m "feat(web): add Coordinator queries and extend fetchProperty"
```

---

## Task 11: Página `/coordinators`

**Files:**
- Create: `apps/web/src/routes/_dashboard/coordinators/index.tsx`

**Interfaces:**
- Consumes: `fetchCoordinators`, `fetchCoordinator` (Task 10), `adminApi.*Coordinator*` (Task 9), `fetchProperties` (já existe)
- Produces: rota `/coordinators` — consumida pela Task 13 (nav)

- [ ] **Step 1: Criar a página, mirror de `rules/index.tsx`**

Criar `apps/web/src/routes/_dashboard/coordinators/index.tsx`:

```tsx
import type { CoordinatorResponsibility, LinkedPropertyWithResponsibilities } from '@kit-manager/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash2, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { CustomButton } from '@/components/ui/btn';
import { adminApi } from '@/lib/api';
import { fetchCoordinator, fetchCoordinators, fetchProperties } from '@/lib/queries';

export const Route = createFileRoute('/_dashboard/coordinators/')({ component: CoordinatorsPage });

const RESPONSIBILITIES: { value: CoordinatorResponsibility; label: string }[] = [
  { value: 'show_property', label: 'Mostrar imóvel' },
  { value: 'deliver_keys', label: 'Entregar chave' },
  { value: 'receive_keys', label: 'Receber chave' },
  { value: 'inspection', label: 'Vistoria' },
];

function ResponsibilityBadges({ responsibilities }: { responsibilities: CoordinatorResponsibility[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {responsibilities.map((r) => (
        <span
          key={r}
          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {RESPONSIBILITIES.find((opt) => opt.value === r)?.label ?? r}
        </span>
      ))}
    </div>
  );
}

function ResponsibilityCheckboxes({
  selected,
  onChange,
}: {
  selected: CoordinatorResponsibility[];
  onChange: (next: CoordinatorResponsibility[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {RESPONSIBILITIES.map((opt) => (
        <label key={opt.value} className="flex items-center gap-1.5 text-xs text-foreground">
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, opt.value]
                  : selected.filter((v) => v !== opt.value),
              )
            }
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function UnlinkPropertyButton({ coordinatorId, propertyId, externalId }: {
  coordinatorId: string;
  propertyId: string;
  externalId: string;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.unlinkCoordinatorProperty(coordinatorId, propertyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] });
      toast.success('Imóvel desvinculado');
    },
    onError: () => toast.error('Falha ao desvincular'),
  });
  return (
    <button
      type="button"
      aria-label={`Desvincular ${externalId}`}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive transition-colors"
    >
      <X className="size-2.5" />
    </button>
  );
}

function LinkedPropertyRow({ coordinatorId, link }: {
  coordinatorId: string;
  link: LinkedPropertyWithResponsibilities;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (responsibilities: CoordinatorResponsibility[]) =>
      adminApi.updateCoordinatorProperty(coordinatorId, link.propertyId, { responsibilities }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] }),
    onError: () => toast.error('Falha ao salvar responsabilidades'),
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] bg-surface-raised p-3" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-muted-foreground">{link.externalId}</span>
          <UnlinkPropertyButton coordinatorId={coordinatorId} propertyId={link.propertyId} externalId={link.externalId} />
        </div>
        <ResponsibilityCheckboxes
          selected={link.responsibilities}
          onChange={(next) => mutation.mutate(next)}
        />
      </div>
    </div>
  );
}

function LinkPropertyForm({ coordinatorId, linkedProperties }: {
  coordinatorId: string;
  linkedProperties: { propertyId: string }[];
}) {
  const [selectedId, setSelectedId] = useState('');
  const [responsibilities, setResponsibilities] = useState<CoordinatorResponsibility[]>([]);
  const qc = useQueryClient();
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
    staleTime: 60_000,
    refetchInterval: false,
  });
  const linkedIds = linkedProperties.map((lp) => lp.propertyId);
  const available = properties.filter((p) => !linkedIds.includes(p.id));
  const mutation = useMutation({
    mutationFn: () =>
      adminApi.linkCoordinatorProperty(coordinatorId, { propertyId: selectedId, responsibilities }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] });
      setSelectedId('');
      setResponsibilities([]);
      toast.success('Imóvel vinculado');
    },
    onError: () => toast.error('Falha ao vincular imóvel'),
  });
  const bulkMutation = useMutation({
    mutationFn: () => adminApi.bulkLinkCoordinator(coordinatorId, { responsibilities }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['coordinator', coordinatorId] });
      const count = (res.data as { propertyCount: number }).propertyCount;
      toast.success(count > 0 ? `Vinculado a ${count} imóveis` : 'Nenhum imóvel novo para vincular');
    },
    onError: () => toast.error('Falha ao aplicar a todos os imóveis'),
  });

  return (
    <div className="space-y-2 pt-1">
      <ResponsibilityCheckboxes selected={responsibilities} onChange={setResponsibilities} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (selectedId) mutation.mutate();
        }}
        className="flex gap-2"
      >
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">Selecionar imóvel...</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.externalId} — {p.name}
            </option>
          ))}
        </select>
        <CustomButton
          type="submit"
          variant="secondary"
          size="sm"
          disabled={!selectedId || responsibilities.length === 0 || mutation.isPending}
        >
          <Plus className="size-3" />
          Vincular
        </CustomButton>
      </form>
      <CustomButton
        type="button"
        variant="ghost"
        size="sm"
        disabled={responsibilities.length === 0 || bulkMutation.isPending}
        onClick={() => bulkMutation.mutate()}
      >
        Aplicar a todos os imóveis
      </CustomButton>
    </div>
  );
}

function AddCoordinatorForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.createCoordinator({ name: name.trim(), phone: phone.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinators'] });
      setName('');
      setPhone('');
      toast.success('Responsável cadastrado');
    },
    onError: () => toast.error('Falha ao cadastrar responsável'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && phone.trim()) mutation.mutate();
      }}
      className="flex gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome..."
        className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="WhatsApp (11999990000)"
        className="w-48 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <CustomButton type="submit" variant="secondary" size="sm" disabled={!name.trim() || !phone.trim() || mutation.isPending}>
        <Plus className="size-3.5" />
        Adicionar
      </CustomButton>
    </form>
  );
}

function CoordinatorsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: coordinators = [] } = useQuery({
    queryKey: ['coordinators'],
    queryFn: fetchCoordinators,
  });

  const activeId = selectedId ?? coordinators[0]?.id ?? null;

  const { data: detail } = useQuery({
    queryKey: ['coordinator', activeId],
    queryFn: () => fetchCoordinator(activeId!),
    enabled: !!activeId,
  });

  const qc = useQueryClient();

  const deleteCoordinator = useMutation({
    mutationFn: (id: string) => adminApi.deleteCoordinator(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinators'] });
      setSelectedId(null);
      toast.success('Responsável removido');
    },
    onError: () => toast.error('Não é possível remover — desvincule dos imóveis primeiro'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Responsáveis" subtitle="Quem mostra os imóveis, entrega/recebe chaves e faz vistoria" />

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <AddCoordinatorForm />
          <div className="space-y-1.5">
            {coordinators.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    c.id === activeId
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Users className="size-3.5 shrink-0" />
                    {c.name}
                    <span className="ml-auto opacity-60">{c._count.properties}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remover ${c.name}`}
                  disabled={deleteCoordinator.isPending}
                  onClick={() => deleteCoordinator.mutate(c.id)}
                  className="rounded-full p-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            {coordinators.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum responsável cadastrado.</p>
            )}
          </div>
        </div>

        {detail && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{detail.name}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{detail.phone}</p>
            </div>
            <div className="space-y-2">
              {detail.linkedProperties.map((link) => (
                <LinkedPropertyRow key={link.propertyId} coordinatorId={detail.id} link={link} />
              ))}
              {detail.linkedProperties.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum imóvel vinculado ainda.</p>
              )}
              <LinkPropertyForm coordinatorId={detail.id} linkedProperties={detail.linkedProperties} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Checar tipos**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: sem erros. Ajustar imports/props se algum componente (`PageHeader`, `CustomButton`) tiver assinatura diferente da assumida — conferir contra o uso em `rules/index.tsx`.

- [ ] **Step 3: Lint**

Run: `cd apps/web && bunx oxlint src/routes/_dashboard/coordinators/index.tsx`
Expected: sem warnings.

- [ ] **Step 4: Verificação manual no browser**

Run: `cd apps/web && bun run dev`, navegar para `http://localhost:5173/coordinators` (rota ainda sem item de nav — acessar direto pela URL até a Task 13):
- Cadastrar um responsável → aparece na lista
- Selecionar, marcar "Mostrar imóvel", vincular a 1 imóvel → aparece em "linkedProperties" com o badge certo
- Clicar "Aplicar a todos os imóveis" → todos os imóveis ativos aparecem vinculados
- Desvincular um → sai da lista
- Tentar remover o responsável com vínculos → toast de erro (409); desvincular todos e remover de novo → sucesso

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/coordinators/index.tsx
git commit -m "feat(web): add /coordinators management page"
```

---

## Task 12: Nav item e quick-create

**Files:**
- Modify: `apps/web/src/routes/_dashboard.tsx`

**Interfaces:**
- Consumes: rota `/coordinators` (Task 11)

- [ ] **Step 1: Adicionar o item de navegação**

Em `apps/web/src/routes/_dashboard.tsx`, adicionar `Users` ao import de `lucide-react` (junto de `ListChecks` etc.) e adicionar o item no grupo principal, após "Regras" (linha 86):

```typescript
      { href: '/rules', label: 'Regras', icon: ListChecks },
      { href: '/coordinators', label: 'Responsáveis', icon: Users },
```

- [ ] **Step 2: Adicionar ao quick-create (opcional, mesmo padrão dos outros)**

Após `{ href: '/rules', label: 'Nova regra', icon: ListChecks }` (linha 68):

```typescript
      { href: '/coordinators', label: 'Novo responsável', icon: Users },
```

- [ ] **Step 3: Checar tipos**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual**

No browser, confirmar que "Responsáveis" aparece no menu lateral e navega para `/coordinators`; confirmar item no quick-create (botão "+" do header, se aplicável).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard.tsx
git commit -m "feat(web): add Responsáveis nav item"
```

---

## Task 13: Exibir o responsável (somente leitura) no detalhe do imóvel

**Files:**
- Modify: `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`

**Interfaces:**
- Consumes: `Property.coordinators` (Task 10, via `fetchProperty`)

- [ ] **Step 1: Adicionar o `InfoRow` na aba "Detalhes"**

Em `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`, dentro do bloco `{tab === 'details' && (...)}`, após o `InfoRow` de "Visita" (linhas 458-460), adicionar:

```tsx
                {property.coordinators && property.coordinators.some((c) => c.responsibilities.includes('show_property')) && (
                  <InfoRow
                    label="Responsável"
                    value={property.coordinators
                      .filter((c) => c.responsibilities.includes('show_property'))
                      .map((c) => c.coordinator.name)
                      .join(', ')}
                  />
                )}
```

- [ ] **Step 2: Checar tipos**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Verificação manual**

No browser, abrir o detalhe de um imóvel que tenha um coordinator com `show_property` vinculado (cadastrado na Task 11) — confirmar que a linha "Responsável" aparece na aba "Detalhes" com o nome certo. Abrir um imóvel sem vínculo — confirmar que a linha não aparece.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_dashboard/properties/\$propertyId/index.tsx
git commit -m "feat(web): show visit coordinator on property detail page"
```

---

## Final Verification

- [ ] `cd apps/bot && bun test` — todos os testes passam (incluindo os novos: `catalog-coordinators`, `coordinators-validation`, `lead-prompts`, `notify-coordinators`)
- [ ] `cd apps/bot && bunx tsc --noEmit` — sem erros
- [ ] `cd apps/bot && bunx oxlint` — sem warnings novos
- [ ] `cd apps/web && bunx vitest run` — sem regressões
- [ ] `cd apps/web && bunx tsc --noEmit` — sem erros
- [ ] `cd apps/web && bunx oxlint` — sem warnings novos
- [ ] Teste manual end-to-end: cadastrar responsável → vincular a um imóvel com `show_property` → simular no WhatsApp (ou via conversa de teste do bot) a pergunta "quem eu procuro no dia da visita" após agendar → bot responde com o nome/telefone, **sem** escalar para humano
- [ ] Teste manual: agendar visita via `POST /admin/visits` com o coordinator vinculado → verificar que a notificação é tentada (log do bot, ou recebimento real no WhatsApp se Evolution estiver conectada)
