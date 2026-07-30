# T2 — Reclamações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tenants a way to file a formal complaint through the WhatsApp bot — it gets recorded (`Complaint` model), the owner is notified, the tenant gets a confirmation, and the owner can track/advance its status from the admin panel.

**Architecture:** Same shape as T1's `escalar_owner`/`registrar_renda` tools — a new LangChain tool (`registrar_reclamacao`) on the existing single tenant agent writes to Postgres via Prisma, fires a best-effort owner notification, and returns a string the LLM relays to the tenant in its own turn (no bot pause, unlike escalation). A new `PATCH /admin/complaints/:id` endpoint lets the owner move status `open → acknowledged → resolved`. The web panel reads complaints straight from Supabase (RLS stays inert, same as every other table today) and renders them in a new presentational `ComplaintsSection` on the tenant detail page.

**Tech Stack:** Bun, TypeScript, Prisma 7 (Postgres), Fastify, LangChain tool-calling, React 19 + TanStack Query + Supabase-js, Vitest (web) / bun test (bot).

## Global Constraints

- bun only — never npm/yarn.
- Never Python.
- No hardcoded colors in web components — CSS variables / existing `tv()` variants only.
- Named exports only for React components — never `export default`.
- Component files: lowercase-with-hyphens, no barrel `index.ts` inside component folders, `data-slot="<name>"` on the root element (see `.claude/skills/create-component/SKILL.md`).
- RLS policies are created but stay inert (no `ENABLE`/`FORCE ROW LEVEL SECURITY`) — activation is a separate, explicit, gated migration (ADR 001 / PR #29). This is not optional: a prior slice (PR #38, migration `20260726010000_property_coordinator`) accidentally enabled+forced RLS in the create-table migration and had to ship a follow-up fix (`20260726020000_coordinator_rls_inert`) — don't repeat that mistake.
- Every DB-writing tool/endpoint touched here logs to `ActivityLog` when it represents an owner-relevant event (design §7 rule 6).
- 1 slice = 1 branch = 1 PR. Branch already created: `feat/tenant-t2-reclamacoes`.
- Commit after each task (not each step) unless a step says otherwise.

---

### Task 1: Shared types — `Complaint` + `ActivityLog` additions

**Files:**
- Create: `packages/types/src/complaint.ts`
- Modify: `packages/types/src/activity-log.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Produces: `Complaint` (`id, ownerId, tenantId, summary, content, status: ComplaintStatus, createdAt`), `ComplaintStatus = 'open' | 'acknowledged' | 'resolved'`. `ActivityLogAction` gains `'complaint_registered' | 'complaint_status_changed'`. `ActivityLogSubjectType` gains `'complaint'`. Every later task that calls `logActivity` with these values, or imports `Complaint`/`ComplaintStatus`, depends on this task.

- [ ] **Step 1: Create `packages/types/src/complaint.ts`**

```ts
export type ComplaintStatus = 'open' | 'acknowledged' | 'resolved';

export interface Complaint {
  id: string;
  ownerId: string;
  tenantId: string;
  summary: string;
  content: string;
  status: ComplaintStatus;
  createdAt: string;
}
```

- [ ] **Step 2: Extend `packages/types/src/activity-log.ts`**

In the `ActivityLogSubjectType` union, add `'complaint'` as the last member (before the closing `;`):

```ts
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
  | 'workspace'
  | 'complaint';
```

In the `ActivityLogAction` union, add two members right after `'tenant_emergency'`:

```ts
  | 'tenant_escalated'
  | 'tenant_emergency'
  | 'complaint_registered'
  | 'complaint_status_changed';
```

- [ ] **Step 3: Export the new module from `packages/types/src/index.ts`**

Add, keeping alphabetical order (`complaint` sorts before `contract`):

```ts
export * from './activity-log';
export * from './complaint';
export * from './contract';
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit` and `cd apps/web && bunx tsc --noEmit`
Expected: both pass (nothing consumes the new exports yet, so this only proves the package itself compiles and is still resolvable from both apps).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/complaint.ts packages/types/src/activity-log.ts packages/types/src/index.ts
git commit -m "feat(types): add Complaint type and activity log entries for T2"
```

---

### Task 2: `Complaint` Prisma model + inert-RLS migration

**Files:**
- Modify: `apps/bot/prisma/schema.prisma`
- Create: `apps/bot/prisma/migrations/20260729000000_complaint/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `prisma.complaint` client (`create`, `update`, `findUnique`) with fields `id, ownerId, tenantId, summary, content, status, createdAt`. Task 4 and Task 5 depend on this.

- [x] **Step 1: Add the model and both relation fields to `schema.prisma`**

In `model Owner { ... }`, add one line among the other `X[]` relation fields (e.g. right after `coordinators Coordinator[]`):

```prisma
  complaints        Complaint[]
```

In `model Tenant { ... }`, add one line among the other relation arrays (e.g. right after `documents TenantDocument[]`):

```prisma
  complaints    Complaint[]
```

Add the new model (place it after `model TenantDocument { ... }`, before `model Payment`):

```prisma
model Complaint {
  id        String   @id @default(uuid())
  ownerId   String
  owner     Owner    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  summary   String
  content   String
  status    String   @default("open") // open | acknowledged | resolved
  createdAt DateTime @default(now())

  @@index([ownerId])
  @@index([tenantId])
}
```

- [x] **Step 2: Validate the schema**

Run: `cd apps/bot && bunx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [x] **Step 3 (revised at execution time): hand-write the migration SQL**

`bunx prisma migrate dev --create-only` fails here with P3006 — its shadow-database replay hard-fails on `20260522000002_ownerid_columns`, which requires ≥1 `Owner` row that an empty shadow DB never has. Documented in `docs/superpowers/plans/2026-07-18-lead-conversion-and-login-fixes.md`; every migration since has been hand-authored the same way. Create `apps/bot/prisma/migrations/20260729000000_complaint/migration.sql` by hand, copying the exact style of `20260718000001_add_tenant_documents/migration.sql` (same shape: `ownerId` Restrict FK + `tenantId` Cascade FK + two indexes):

```sql
-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Complaint_ownerId_idx" ON "Complaint"("ownerId");

-- CreateIndex
CREATE INDEX "Complaint_tenantId_idx" ON "Complaint"("tenantId");

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [x] **Step 4: Append the inert RLS policy in the same hand-written file**

Included already in the block above (the `CREATE POLICY` statement). Do **not** add `ALTER TABLE "Complaint" ENABLE ROW LEVEL SECURITY;` or `... FORCE ROW LEVEL SECURITY;` — this is the exact mistake corrected in `20260726020000_coordinator_rls_inert`. A bare `CREATE POLICY` on a table that never enabled RLS is valid Postgres and stays fully inert.

- [x] **Step 5 (revised): apply via `db execute` + record with `migrate resolve`**

```bash
cd apps/bot
set -a && source .env && set +a
bunx prisma db execute --file prisma/migrations/20260729000000_complaint/migration.sql
bunx prisma migrate resolve --applied 20260729000000_complaint
bunx prisma generate
```

Expected: `Script executed successfully.` → `Migration 20260729000000_complaint marked as applied.` → `Generated Prisma Client`. Confirm with `bunx prisma migrate status` → `Database schema is up to date!`.

- [x] **Step 6: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: passes (Prisma Client now exposes `prisma.complaint`).

- [x] **Step 7: Commit**

```bash
git add apps/bot/prisma/schema.prisma apps/bot/prisma/migrations/20260729000000_complaint
git commit -m "feat(db): add Complaint model with inert RLS policy"
```

---

### Task 3: `tenant_complaint` owner notification

**Files:**
- Modify: `apps/bot/src/services/notify.ts`
- Test: `apps/bot/src/__tests__/notify-tenant.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `notifyOwner(ownerId, 'tenant_complaint', { tenantName, tenantPhone, summary })` and exported `buildTenantComplaintMessage(payload: { tenantName: string; tenantPhone: string; summary: string }): string`. Task 4 depends on both.

- [ ] **Step 1: Write the failing test**

Append to `apps/bot/src/__tests__/notify-tenant.test.ts`:

```ts
import { buildTenantComplaintMessage, buildTenantEmergencyMessage, buildTenantEscalationMessage } from '@/services/notify';

describe('buildTenantComplaintMessage', () => {
  test('inclui nome, telefone e resumo', () => {
    const msg = buildTenantComplaintMessage({
      tenantName: 'Ana Costa',
      tenantPhone: '11966665555',
      summary: 'Barulho excessivo do vizinho à noite',
    });
    expect(msg).toContain('Ana Costa');
    expect(msg).toContain('11966665555');
    expect(msg).toContain('Barulho excessivo do vizinho à noite');
  });
});
```

(This replaces the existing single-line import at the top of the file — merge `buildTenantComplaintMessage` into that same `import { ... } from '@/services/notify'` statement rather than adding a second import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/bot && bun test src/__tests__/notify-tenant.test.ts`
Expected: FAIL — `buildTenantComplaintMessage is not a function` / import error.

- [ ] **Step 3: Implement in `apps/bot/src/services/notify.ts`**

Add `tenant_complaint` to the `NotifyPayloadMap` (right after `tenant_emergency`):

```ts
  tenant_complaint: { tenantName: string; tenantPhone: string; summary: string };
```

Add a `case` in `buildChannelContent`'s switch (right after the `tenant_emergency` case):

```ts
    case 'tenant_complaint': {
      const p = payload as NotifyPayloadMap['tenant_complaint'];
      return { whatsapp: buildTenantComplaintMessage(p), email: null };
    }
```

Add the exported builder (right after `buildTenantEmergencyMessage`):

```ts
export function buildTenantComplaintMessage(payload: {
  tenantName: string;
  tenantPhone: string;
  summary: string;
}): string {
  return (
    `📋 Nova reclamação registrada\n` +
    `Inquilino: ${payload.tenantName} (${payload.tenantPhone})\n` +
    `Resumo: ${payload.summary}\n` +
    `Acesse o painel para ver os detalhes.`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/bot && bun test src/__tests__/notify-tenant.test.ts`
Expected: PASS, 3 tests (escalation, emergency, complaint).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/notify.ts apps/bot/src/__tests__/notify-tenant.test.ts
git commit -m "feat(tenant): add tenant_complaint owner notification"
```

---

### Task 4: `registrar_reclamacao` tool + agent prompt update

**Files:**
- Modify: `apps/bot/src/agents/tenant-tools.ts`
- Modify: `apps/bot/src/agents/tenant-v2.ts`
- Test: `apps/bot/src/__tests__/tenant-tools.test.ts`

**Interfaces:**
- Consumes: `prisma.complaint.create` (Task 2), `notifyOwner(..., 'tenant_complaint', ...)` (Task 3), `logActivity` with `action: 'complaint_registered'`, `subjectType: 'complaint'` (Task 1).
- Produces: `buildTenantTools(deps)` now returns `[escalarOwner, registrarReclamacao]` (tool name `'registrar_reclamacao'`, schema `{ resumo: string, conteudo: string }`). `flows/tenant/index.ts` needs no change — it already spreads whatever `buildTenantTools` returns into `runTenantAgentV2`.

- [ ] **Step 1: Write the failing tests**

In `apps/bot/src/__tests__/tenant-tools.test.ts`, add a `complaint.create` mock to the existing `mock.module('@/db/client', ...)` call (merge into the existing `prisma: { ... }` object, don't duplicate the `mock.module` call):

```ts
const complaintCreates: Array<{ ownerId: string; tenantId: string; summary: string; content: string }> = [];

// inside the existing prisma mock object, alongside conversation/event:
    complaint: {
      create: async (args: { data: { ownerId: string; tenantId: string; summary: string; content: string } }) => {
        complaintCreates.push(args.data);
        return { id: 'complaint-1', ...args.data, status: 'open', createdAt: new Date().toISOString() };
      },
    },
```

Reset it in `beforeEach` alongside the other arrays: `complaintCreates.length = 0;`

Add a new describe block, and update the existing "lista completa" test:

```ts
describe('registrar_reclamacao', () => {
  beforeEach(() => {
    conversationUpserts.length = 0;
    events.length = 0;
    sentTexts.length = 0;
    notifyCalls.length = 0;
    activityLogs.length = 0;
    complaintCreates.length = 0;
  });

  it('cria a reclamação, notifica o owner e loga a atividade', async () => {
    const out = (await getTool('registrar_reclamacao').invoke({
      resumo: 'Barulho excessivo do vizinho',
      conteudo: 'O inquilino relata barulho todas as noites desde a semana passada.',
    })) as string;

    expect(complaintCreates).toHaveLength(1);
    expect(complaintCreates[0]).toEqual({
      ownerId: deps.ownerId,
      tenantId: deps.tenantId,
      summary: 'Barulho excessivo do vizinho',
      content: 'O inquilino relata barulho todas as noites desde a semana passada.',
    });
    expect(notifyCalls[0]?.eventType).toBe('tenant_complaint');
    expect(notifyCalls[0]?.payload).toMatchObject({ summary: 'Barulho excessivo do vizinho' });
    expect(activityLogs[0]).toMatchObject({ action: 'complaint_registered', subjectId: 'complaint-1' });
    expect(out).toContain('registrada');
  });
});

describe('lista completa', () => {
  it('expõe as 2 tools da T2', () => {
    const names = buildTenantTools(deps).map((t) => t.name);
    expect(names).toEqual(['escalar_owner', 'registrar_reclamacao']);
  });
});
```

Remove the old `it('expõe exatamente 1 tool na T1', ...)` test (replaced by the block above).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: FAIL — `registrar_reclamacao` tool not found / `complaintCreates` stays empty.

- [ ] **Step 3: Implement the tool in `apps/bot/src/agents/tenant-tools.ts`**

Update the imports at the top of the file:

```ts
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { prisma } from '@/db/client';
import { escalateTenantToOwner } from '@/flows/tenant/escalation';
import { logger } from '@/lib/logger';
import { logActivity } from '@/services/activity';
import { notifyOwner } from '@/services/notify';
```

Add the tool inside `buildTenantTools`, and return both tools:

```ts
  const registrarReclamacao = tool(
    async ({ resumo, conteudo }: { resumo: string; conteudo: string }) => {
      try {
        const complaint = await prisma.complaint.create({
          data: { ownerId: deps.ownerId, tenantId: deps.tenantId, summary: resumo, content: conteudo },
        });
        const displayName = deps.tenantName ?? deps.chatId;
        notifyOwner(deps.ownerId, 'tenant_complaint', {
          tenantName: displayName,
          tenantPhone: deps.chatId,
          summary: resumo,
        }).catch((err) => logger.error({ err }, '[tenant-tools] notifyOwner tenant_complaint falhou'));
        logActivity({
          ownerId: deps.ownerId,
          actorType: 'bot',
          actorLabel: 'Bot',
          action: 'complaint_registered',
          subjectType: 'complaint',
          subjectId: complaint.id,
          subject: displayName,
          metadata: { summary: resumo },
        }).catch((err) => logger.error({ err }, '[tenant-tools] logActivity complaint_registered falhou'));
        return 'Reclamação registrada. O proprietário foi avisado e vai acompanhar o caso.';
      } catch (err) {
        logger.error({ err }, '[tenant-tools] registrar_reclamacao');
        return fail('não consegui registrar a reclamação agora.');
      }
    },
    {
      name: 'registrar_reclamacao',
      description:
        'Registra uma reclamação formal do inquilino (ex: barulho, problema recorrente não resolvido, ' +
        'insatisfação com atendimento). Cria registro no sistema e notifica o proprietário. ' +
        'resumo: uma linha curta. conteudo: o relato completo do inquilino, sem resumir ou inventar detalhes.',
      schema: z.object({ resumo: z.string(), conteudo: z.string() }),
    },
  );

  return [escalarOwner, registrarReclamacao];
```

- [ ] **Step 4: Update the agent prompt in `apps/bot/src/agents/tenant-v2.ts`**

Replace this line:

```
- Assuntos que voce ainda nao resolve sozinho (negociacao financeira, manutencao, reclamacao formal): chame escalar_owner e explique que o proprietario vai continuar a conversa.
```

with:

```
- Reclamacao formal (ex: barulho, problema recorrente, insatisfacao com atendimento): chame registrar_reclamacao com um resumo curto e o relato completo do inquilino, depois confirme o registro.
- Assuntos que voce ainda nao resolve sozinho (negociacao financeira, manutencao): chame escalar_owner e explique que o proprietario vai continuar a conversa.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/bot && bun test src/__tests__/tenant-tools.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Run the full bot suite**

Run: `cd apps/bot && bun run check`
Expected: typecheck + lint + `bun test src` all green (this also catches any other test relying on the old 1-tool list).

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/agents/tenant-tools.ts apps/bot/src/agents/tenant-v2.ts apps/bot/src/__tests__/tenant-tools.test.ts
git commit -m "feat(tenant): add registrar_reclamacao tool"
```

---

### Task 5: `PATCH /admin/complaints/:id`

**Files:**
- Create: `apps/bot/src/routes/admin/complaints.ts`
- Modify: `apps/bot/src/routes/admin/index.ts`

**Interfaces:**
- Consumes: `prisma.complaint` (Task 2), `verifyAdminJwt` (`apps/bot/src/plugins/admin-auth.ts`, already used by every other admin route), `logActivity` with `action: 'complaint_status_changed'` (Task 1).
- Produces: `complaintsRoutes(fastify)` registering `PATCH /admin/complaints/:id`. Task 6 (web) depends on this endpoint's shape: `{ status: 'open' | 'acknowledged' | 'resolved' }` body, returns the updated `Complaint` row as JSON.

- [ ] **Step 1: Create `apps/bot/src/routes/admin/complaints.ts`**

```ts
import type { ComplaintStatus } from '@kit-manager/types';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@/db/client';
import { verifyAdminJwt } from '@/plugins/admin-auth';
import { logActivity } from '@/services/activity';

const VALID_STATUSES: ComplaintStatus[] = ['open', 'acknowledged', 'resolved'];

export async function complaintsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.patch<{ Params: { id: string }; Body: { status: ComplaintStatus } }>(
    '/admin/complaints/:id',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;
      if (!VALID_STATUSES.includes(status)) {
        return reply.status(400).send({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      const existing = await prisma.complaint.findUnique({ where: { id } });
      if (!existing) return reply.status(404).send({ error: 'Complaint not found' });
      const complaint = await prisma.complaint.update({ where: { id }, data: { status } });
      await logActivity({
        actorType: 'user',
        actorId: request.adminUserId ?? undefined,
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: complaint.ownerId,
        action: 'complaint_status_changed',
        subject: complaint.summary,
        subjectId: complaint.id,
        subjectType: 'complaint',
        metadata: { status },
      }).catch(fastify.log.warn.bind(fastify.log));
      return reply.send(complaint);
    },
  );
}
```

- [ ] **Step 2: Register the route in `apps/bot/src/routes/admin/index.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { botSettingsRoutes } from './bot-settings';
import { complaintsRoutes } from './complaints';
import { contractsRoutes } from './contracts';
import { coordinatorsRoutes } from './coordinators';
import { leadsRoutes } from './leads';
import { paymentsRoutes } from './payments';
import { propertiesRoutes } from './properties';
import { ruleSetsRoutes } from './rule-sets';
import { templatesRoutes } from './templates';
import { tenantsRoutes } from './tenants';
import { visitsRoutes } from './visits';

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {
  await botSettingsRoutes(fastify);
  await leadsRoutes(fastify);
  await propertiesRoutes(fastify);
  await tenantsRoutes(fastify);
  await ruleSetsRoutes(fastify);
  await coordinatorsRoutes(fastify);
  await complaintsRoutes(fastify);
  await templatesRoutes(fastify);
  await contractsRoutes(fastify);
  await paymentsRoutes(fastify);
  await visitsRoutes(fastify);
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/bot && bun run typecheck && bun run lint`
Expected: both pass. (No dedicated route test — this codebase has no Fastify-level route tests for any `/admin/*` endpoint today; consistent with that, and with design §8's testing strategy which doesn't call for one either.)

- [ ] **Step 4: Commit**

```bash
git add apps/bot/src/routes/admin/complaints.ts apps/bot/src/routes/admin/index.ts
git commit -m "feat(admin): add PATCH /admin/complaints/:id"
```

---

### Task 6: Web — "Chamados & Reclamações" section on the tenant detail page

**Files:**
- Modify: `apps/web/src/lib/queries.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/complaints-section.tsx`
- Test: `apps/web/src/__tests__/complaints-section.test.tsx`
- Modify: `apps/web/src/routes/_dashboard/tenants/$tenantId.tsx`

**Interfaces:**
- Consumes: `Complaint`, `ComplaintStatus` (Task 1), `PATCH /admin/complaints/:id` (Task 5).
- Produces: `fetchTenantComplaints(tenantId): Promise<Complaint[]>`, `adminApi.updateComplaintStatus(id, status)`, `<ComplaintsSection complaints isLoading isAdvancing onAdvanceStatus />` (presentational — no internal `useMutation`, so it's testable without a `QueryClientProvider`, matching how `ContractsSection` is built).

- [ ] **Step 1: Add `fetchTenantComplaints` to `apps/web/src/lib/queries.ts`**

Add `Complaint` to the existing `import type { ... } from '@kit-manager/types'` block, in alphabetical position (right before `ContractDetail`):

```ts
import type {
  Complaint,
  ContractDetail,
  ContractSummary,
  ...
```

Add the function near `fetchTenantContracts` / `fetchTenantDocuments`:

```ts
export async function fetchTenantComplaints(tenantId: string): Promise<Complaint[]> {
  const { data, error } = await supabase
    .from('Complaint')
    .select('*')
    .eq('tenantId', tenantId)
    .order('createdAt', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Complaint[];
}
```

- [ ] **Step 2: Add `updateComplaintStatus` to `apps/web/src/lib/api.ts`**

Add to the `adminApi` object, near `updateCoordinatorProperty`:

```ts
  updateComplaintStatus: (id: string, status: 'open' | 'acknowledged' | 'resolved') =>
    botApi.patch(`/admin/complaints/${id}`, { status }),
```

- [ ] **Step 3: Write the failing component test**

Create `apps/web/src/__tests__/complaints-section.test.tsx`:

```tsx
import type { Complaint } from '@kit-manager/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { ComplaintsSection } from '@/components/complaints-section';

function makeComplaint(overrides: Partial<Complaint> = {}): Complaint {
  return {
    id: 'complaint-1',
    ownerId: 'owner-1',
    tenantId: 'tenant-1',
    summary: 'Barulho excessivo do vizinho',
    content: 'Relato completo do inquilino sobre o barulho.',
    status: 'open',
    createdAt: '2026-07-29T00:00:00Z',
    ...overrides,
  };
}

describe('ComplaintsSection', () => {
  test('renders nothing when there are no complaints and it is not loading', () => {
    const { container } = render(
      <ComplaintsSection complaints={[]} isLoading={false} isAdvancing={false} onAdvanceStatus={vi.fn()} />,
    );
    expect(container.querySelector('[data-slot="complaints-section"]')).not.toBeInTheDocument();
  });

  test('renders summary, content and status pill', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint()]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
      />,
    );
    expect(screen.getByText('Barulho excessivo do vizinho')).toBeInTheDocument();
    expect(screen.getByText('Relato completo do inquilino sobre o barulho.')).toBeInTheDocument();
    expect(screen.getByText('Aberta')).toBeInTheDocument();
  });

  test('advance button calls onAdvanceStatus with the next status', () => {
    const onAdvanceStatus = vi.fn();
    render(
      <ComplaintsSection
        complaints={[makeComplaint({ status: 'open' })]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={onAdvanceStatus}
      />,
    );
    fireEvent.click(screen.getByText(/marcar como reconhecida/i));
    expect(onAdvanceStatus).toHaveBeenCalledWith('complaint-1', 'acknowledged');
  });

  test('resolved complaints show no advance button', () => {
    render(
      <ComplaintsSection
        complaints={[makeComplaint({ status: 'resolved' })]}
        isLoading={false}
        isAdvancing={false}
        onAdvanceStatus={vi.fn()}
      />,
    );
    expect(screen.queryByText(/marcar como/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/web && bunx vitest run src/__tests__/complaints-section.test.tsx`
Expected: FAIL — cannot find module `@/components/complaints-section`.

- [ ] **Step 5: Create `apps/web/src/components/complaints-section.tsx`**

```tsx
import type { Complaint, ComplaintStatus } from '@kit-manager/types';
import { Pill } from '@/components/ui/pill';

const STATUS_TONE: Record<ComplaintStatus, 'warn' | 'accent' | 'ok'> = {
  open: 'warn',
  acknowledged: 'accent',
  resolved: 'ok',
};

const STATUS_LABEL: Record<ComplaintStatus, string> = {
  open: 'Aberta',
  acknowledged: 'Reconhecida',
  resolved: 'Resolvida',
};

const NEXT_STATUS: Record<ComplaintStatus, ComplaintStatus | null> = {
  open: 'acknowledged',
  acknowledged: 'resolved',
  resolved: null,
};

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

export function ComplaintsSection({
  complaints,
  isLoading,
  isAdvancing,
  onAdvanceStatus,
}: {
  complaints: Complaint[];
  isLoading: boolean;
  isAdvancing: boolean;
  onAdvanceStatus: (id: string, status: ComplaintStatus) => void;
}) {
  if (!isLoading && complaints.length === 0) return null;

  return (
    <div data-slot="complaints-section" className="rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="mb-4 text-sm font-medium text-foreground">Chamados & Reclamações</h2>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
          <div className="h-14 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-2">
          {complaints.map((c) => {
            const next = NEXT_STATUS[c.status];
            return (
              <div key={c.id} className="rounded-lg border border-border bg-surface px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{c.summary}</p>
                  <Pill tone={STATUS_TONE[c.status]} dot>
                    {STATUS_LABEL[c.status]}
                  </Pill>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{c.content}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {dateFmt.format(new Date(c.createdAt))}
                  </span>
                  {next && (
                    <button
                      type="button"
                      onClick={() => onAdvanceStatus(c.id, next)}
                      disabled={isAdvancing}
                      className="text-xs font-medium text-accent-ink hover:underline disabled:opacity-50"
                    >
                      Marcar como {STATUS_LABEL[next].toLowerCase()}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && bunx vitest run src/__tests__/complaints-section.test.tsx`
Expected: PASS, all 4 tests green.

- [ ] **Step 7: Wire the section into `apps/web/src/routes/_dashboard/tenants/$tenantId.tsx`**

Add imports (merge into existing import lines, keep alphabetical where the file already sorts):

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
```

(replaces the existing `import { useQuery } from '@tanstack/react-query';`)

```tsx
import { toast } from 'sonner';
import { ComplaintsSection } from '@/components/complaints-section';
```

```tsx
import { adminApi, apiErrorMessage } from '@/lib/api';
import { fetchTenant, fetchTenantComplaints, fetchTenantContracts, fetchTenantDocuments } from '@/lib/queries';
```

Inside `TenantDetailPage`, after the `documents` query and before the `if (isLoading)` guard, add:

```tsx
  const qc = useQueryClient();

  const { data: complaints = [], isLoading: complaintsLoading } = useQuery({
    queryKey: ['tenant-complaints', tenantId],
    queryFn: () => fetchTenantComplaints(tenantId),
    enabled: !!data,
  });

  const advanceComplaintStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'acknowledged' | 'resolved' }) =>
      adminApi.updateComplaintStatus(id, status),
    onSuccess: () => {
      toast.success('Status atualizado.');
      void qc.invalidateQueries({ queryKey: ['tenant-complaints', tenantId] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao atualizar status.')),
  });
```

After the `<ContractsSection ... />` line, add:

```tsx
      <ComplaintsSection
        complaints={complaints}
        isLoading={complaintsLoading}
        isAdvancing={advanceComplaintStatus.isPending}
        onAdvanceStatus={(id, status) => advanceComplaintStatus.mutate({ id, status })}
      />
```

- [ ] **Step 8: Typecheck, lint and run the full web suite**

Run: `cd apps/web && bunx tsc --noEmit && bun run lint && bunx vitest run`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/queries.ts apps/web/src/lib/api.ts apps/web/src/components/complaints-section.tsx apps/web/src/__tests__/complaints-section.test.tsx apps/web/src/routes/_dashboard/tenants/\$tenantId.tsx
git commit -m "feat(web): show Chamados & Reclamações on tenant detail page"
```

---

### Task 7: Final verification, docs, and simplify handoff

**Files:**
- Modify: `PRD-FASE2.md` (T2 tracking checkboxes)

- [ ] **Step 1: Run the full bot suite**

Run: `cd apps/bot && bun run check`
Expected: typecheck + lint + `bun test src` all green.

- [ ] **Step 2: Run the full web suite**

Run: `cd apps/web && bunx tsc --noEmit && bun run lint && bunx vitest run`
Expected: all green.

- [ ] **Step 3: Manual smoke check (optional but recommended before PR)**

Start the bot locally (`docker compose up -d --build bot`) and, with a test tenant conversation, send a message like "quero registrar uma reclamação: o vizinho faz muito barulho à noite" — confirm the bot calls `registrar_reclamacao`, the `Complaint` row appears in the DB, and the owner notification fires. Then open the tenant's detail page in the web panel and confirm the complaint shows up in "Chamados & Reclamações" with a working "Marcar como reconhecida" → "Marcar como resolvida" progression.

- [ ] **Step 4: Update `PRD-FASE2.md` T2 tracking**

Mark the 4 build checkboxes for T2 as done (migration+types, tool+notif+confirmação, endpoint+leitura web, seção no detalhe do tenant), with a one-line note on what was verified (mirroring the style used in the T1 section).

- [ ] **Step 5: Commit**

```bash
git add PRD-FASE2.md
git commit -m "docs: mark T2 build tasks done in PRD-FASE2"
```

**Next steps after this plan:** etapa 5 (`agent-skills:code-simplification`) then etapa 6 (`agent-skills:code-review-and-quality` local → `gh pr create` → CodeRabbit loop → merge by Fred), per `PRD-FASE2.md` §Pipeline.
