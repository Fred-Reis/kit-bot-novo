# Lead Conversion Completeness & Login Notification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make lead→tenant conversion a single atomic, complete operation (lead auto-archives, tenant inherits the lead's documents, contract stays viewable from both sides), remove the now-dead "Ganho" kanban column, and stop non-owner logins from failing silently.

**Architecture:** Fold the lead-stage transition and document hand-off into `finalizeContractSigning`'s existing Prisma transaction (currently in `apps/bot/src/services/contract-signing.ts`) so tenant creation, lead archival, and document copy either all happen or none do. Add a `TenantDocument` table (mirrors `LeadDocument`) so tenants have their own document set instead of reaching back into the archived lead. Extract the lead detail page's contract-viewer and document-grid UI into shared components so the tenant detail page can reuse them verbatim. For login, keep the existing block-and-signout behavior (RLS is not active yet — see Global Constraints) but make the rejection visible instead of silent.

**Tech Stack:** Bun, Fastify, Prisma (Postgres), React 19, TanStack Router/Query, Supabase (`supabase-js` direct reads), Zod, sonner (toast).

## Global Constraints

- Bun only — no npm/yarn/Python, per `CLAUDE.md`.
- Named exports only, no `export default`, in `apps/web` components.
- No hardcoded Tailwind colors — use existing CSS variables (`text-foreground`, `border-border`, etc. — copy patterns from surrounding code).
- **RLS is not active in production.** Policies exist but `ENABLE ROW LEVEL SECURITY` has not run (`ROADMAP.md:58`, `ROADMAP.md:323`). Frontend Supabase reads are unfiltered by owner. Do not change the login flow to let unregistered accounts reach any data-bearing route until RLS is confirmed active — this plan's login fix keeps the existing block.
- Prisma migrations in this repo are generated via `bunx prisma migrate dev --name <name>` run from `apps/bot`, then committed. Don't hand-write migration SQL for the new table — let Prisma generate it.
- This is a solo-owner app today (one `Owner` row). Don't add multi-tenant scoping as part of this plan — out of scope.

---

## Task 1: `TenantDocument` Prisma model

**Files:**
- Modify: `apps/bot/prisma/schema.prisma`

**Interfaces:**
- Produces: `TenantDocument` Prisma model with fields `id, ownerId, tenantId, type, url, ocrText, createdAt`, mirroring `LeadDocument` (`apps/bot/prisma/schema.prisma:129-141`).

- [ ] **Step 1: Add the model**

In `apps/bot/prisma/schema.prisma`, right after the closing brace of `model Tenant` (currently ends at line 181, just before `model Payment`), insert:

```prisma
model TenantDocument {
  id        String   @id @default(uuid())
  ownerId   String
  owner     Owner    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  type      String
  url       String
  ocrText   String?
  createdAt DateTime @default(now())

  @@index([ownerId])
  @@index([tenantId])
}
```

- [ ] **Step 2: Wire the back-relations**

In `model Tenant`, add a `documents` field next to the existing `contracts` field (`apps/bot/prisma/schema.prisma:159-181`):

```prisma
  contracts     Contract[]
  documents     TenantDocument[]
```

In `model Owner` (`apps/bot/prisma/schema.prisma:9-24`), add `tenantDocuments TenantDocument[]` next to the existing `tenants Tenant[]` line so the reverse relation resolves.

- [ ] **Step 3: Generate and apply the migration**

Run from `apps/bot`:
```bash
bunx prisma migrate dev --name add_tenant_documents
```
Expected: a new folder under `apps/bot/prisma/migrations/` containing a `CREATE TABLE "TenantDocument"` + two `ALTER TABLE ... ADD CONSTRAINT` (owner FK, tenant FK) + two `CREATE INDEX` statements. Prisma Client regenerates automatically.

- [ ] **Step 4: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors (schema-only change, no consumers yet).

- [ ] **Step 5: Commit**

```bash
git add apps/bot/prisma/schema.prisma apps/bot/prisma/migrations
git commit -m "feat(db): add TenantDocument model for lead->tenant document hand-off"
```

---

## Task 2: Make `finalizeContractSigning` atomic — stage claim, archive, document copy

**Files:**
- Modify: `apps/bot/src/services/contract-signing.ts`
- Modify: `apps/bot/src/routes/admin.ts:638-712` (mark-signed route)
- Modify: `apps/bot/src/flows/lead/index.ts:213-280` (bot inbound-PDF handler)

**Context:** Today, `stage: 'contract_pending' → 'converted'` is claimed by each *caller* via a separate `prisma.lead.updateMany` before calling `finalizeContractSigning`, which then runs its own inner `prisma.$transaction` for tenant/contract/property. This plan folds the stage claim into that same transaction, and adds document copy + `archivedAt`. This also makes the lead disappear from the active leads list immediately (see Task 8) since `fetchLeads` already filters `.is('archivedAt', null)` (`apps/web/src/lib/queries.ts:36`).

**Interfaces:**
- Consumes: `TenantDocument` model from Task 1.
- Produces: `finalizeContractSigning(params: FinalizeSigningParams): Promise<FinalizeSigningResult>` — same public signature as today, but now throws `Error('Lead is not in contract_pending stage')` if the stage claim fails (instead of relying on callers to pre-claim).

- [ ] **Step 1: Widen the lead select to fetch full documents**

In `apps/bot/src/services/contract-signing.ts:37-40`, change:

```ts
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { phone: true, name: true, ownerId: true, propertyId: true, documents: { select: { ocrText: true } } },
  });
```

to:

```ts
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: {
      phone: true,
      name: true,
      ownerId: true,
      propertyId: true,
      documents: { select: { type: true, url: true, ocrText: true } },
    },
  });
```

- [ ] **Step 2: Fold the stage claim, tenant create, doc copy into one transaction**

In `apps/bot/src/services/contract-signing.ts:49-76`, replace:

```ts
  const tenant = await prisma.$transaction(async (tx) => {
    const newTenant = await tx.tenant.create({
      data: {
        phone: lead.phone,
        name: lead.name ?? undefined,
        cpf: cpf ?? undefined,
        propertyId,
        contractStart: today,
        externalId: tenantExternalId,
        ownerId: lead.ownerId,
      },
    });
    await Promise.all([
      tx.contract.update({
        where: { id: contractId },
        data: {
          tenantId: newTenant.id,
          startDate: today,
          status: 'active',
          ...(finalContractBody != null ? { body: finalContractBody } : {}),
          ...(finalPdfPath != null ? { pdfUrl: finalPdfPath } : {}),
          ...(signedPdfUrl != null ? { signedPdfUrl } : {}),
        },
      }),
      tx.property.update({ where: { id: propertyId }, data: { status: 'rented', active: false } }),
    ]);
    return newTenant;
  });
```

with:

```ts
  const tenant = await prisma.$transaction(async (tx) => {
    // Claim the lead atomically inside the same transaction as tenant creation —
    // a failure anywhere below rolls this back too, so the lead is never left
    // stranded in 'converted' with no tenant (see incident 2026-07-17).
    const { count } = await tx.lead.updateMany({
      where: { id: leadId, stage: 'contract_pending' },
      data: { stage: 'converted', archivedAt: today },
    });
    if (count === 0) {
      throw new Error('Lead is not in contract_pending stage');
    }

    const newTenant = await tx.tenant.create({
      data: {
        phone: lead.phone,
        name: lead.name ?? undefined,
        cpf: cpf ?? undefined,
        propertyId,
        contractStart: today,
        externalId: tenantExternalId,
        ownerId: lead.ownerId,
      },
    });

    if (lead.documents.length > 0) {
      await tx.tenantDocument.createMany({
        data: lead.documents.map((doc) => ({
          ownerId: lead.ownerId,
          tenantId: newTenant.id,
          type: doc.type,
          url: doc.url,
          ocrText: doc.ocrText,
        })),
      });
    }

    await Promise.all([
      tx.contract.update({
        where: { id: contractId },
        data: {
          tenantId: newTenant.id,
          startDate: today,
          status: 'active',
          ...(finalContractBody != null ? { body: finalContractBody } : {}),
          ...(finalPdfPath != null ? { pdfUrl: finalPdfPath } : {}),
          ...(signedPdfUrl != null ? { signedPdfUrl } : {}),
        },
      }),
      tx.property.update({ where: { id: propertyId }, data: { status: 'rented', active: false } }),
    ]);
    return newTenant;
  });
```

- [ ] **Step 3: Simplify the admin.ts mark-signed route**

In `apps/bot/src/routes/admin.ts`, the route currently (lines 638-712, after this session's earlier revert-patch) does: read lead → check stage → find draft contract → **claim stage via `updateMany`** → generate PDF → call `finalizeContractSigning` in a try/catch that reverts the stage claim on failure. The stage claim is now redundant (Task 2 Step 2 does it atomically inside `finalizeContractSigning`), so remove it and simplify the catch block.

Replace the block at `apps/bot/src/routes/admin.ts:668-676`:

```ts
      // Atomically claim the stage — prevents duplicate tenants on retries or concurrent requests
      const { count } = await prisma.lead.updateMany({
        where: { id, stage: 'contract_pending' },
        data: { stage: 'converted' },
      });
      if (count === 0) {
        return reply.status(409).send({ error: `Lead is already past 'contract_pending' stage` });
      }

      const today = new Date();
```

with:

```ts
      const today = new Date();
```

Then replace the `finalizeContractSigning` call (added earlier this session — the `try { ... } catch (err) { revert stage; ... }` block) with a plain try/catch that no longer needs to revert anything, since nothing is mutated until `finalizeContractSigning`'s own transaction commits:

```ts
      let tenantId: string;
      let tenantExternalId: string;
      try {
        ({ tenantId, tenantExternalId } = await finalizeContractSigning({
          leadId: id,
          contractId: contract.id,
          actorLabel: request.adminUserId ?? 'admin',
          signedPdfUrl: signedPdfUrl ?? null,
          finalContractBody: finalBody,
          finalPdfPath,
        }));
      } catch (err) {
        fastify.log.error({ err }, 'finalizeContractSigning failed');
        return reply.status(500).send({ error: 'Failed to finalize contract signing' });
      }
```

- [ ] **Step 4: Remove the redundant stage update in the bot flow**

In `apps/bot/src/flows/lead/index.ts:269-273`, delete:

```ts
          // Only mark lead as converted after successful finalization
          await prisma.lead.updateMany({
            where: { id: lead.id, stage: 'contract_pending' },
            data: { stage: 'converted' },
          });

```

(The comment and code are now dead — `finalizeContractSigning` already did this atomically at Step 254-259 above it.)

- [ ] **Step 5: Typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

This touches money-path logic with no existing test harness for `finalizeContractSigning` — verify by hand against a dev/staging DB:
1. Create a lead in `contract_pending` with a draft contract and at least one `LeadDocument` row.
2. Call `POST /admin/leads/:id/mark-signed`.
3. Confirm: `Lead.stage = 'converted'`, `Lead.archivedAt` is set, a new `Tenant` row exists, `TenantDocument` rows exist matching the lead's documents, `Contract.tenantId` is set and `Contract.status = 'active'`, `Property.status = 'rented'`.
4. Repeat with a duplicate call (simulate retry) — expect a clean error, not a second tenant.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/src/services/contract-signing.ts apps/bot/src/routes/admin.ts apps/bot/src/flows/lead/index.ts
git commit -m "fix(bot): atomically archive lead and copy documents on contract signing"
```

---

## Task 3: Shared `TenantDocument` type

**Files:**
- Modify: `packages/types/src/tenant.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `TenantDocument` interface, exported from `@kit-manager/types` (re-exported via `packages/types/src/index.ts:export * from './tenant'`, already present).

- [ ] **Step 1: Add the interface**

In `packages/types/src/tenant.ts`, after the `Tenant` interface (currently ends at line 18), add:

```ts
export interface TenantDocument {
  id: string;
  ownerId: string;
  tenantId: string;
  type: string;
  url: string;
  ocrText: string | null;
  createdAt: string;
}
```

- [ ] **Step 2: Typecheck the package**

Run: `cd packages/types && bunx tsc --noEmit` (or the workspace's equivalent build check if `types` has no standalone tsconfig — check `packages/types/package.json` for the `typecheck`/`build` script and use that instead if `tsc --noEmit` isn't wired directly).

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/tenant.ts
git commit -m "feat(types): add TenantDocument type"
```

---

## Task 4: Frontend queries — tenant documents & contracts, rename `LeadContract`

**Files:**
- Modify: `apps/web/src/lib/queries.ts`

**Context:** `fetchLeadContracts` (`apps/web/src/lib/queries.ts:410-418`) queries the `Contract` table by `leadId`. Since `Contract` also carries `tenantId` (set by Task 2's transaction), the same shape works filtered by `tenantId`. The type `LeadContract` (`apps/web/src/lib/queries.ts:399-408`) is only used in this file and in `apps/web/src/routes/_dashboard/leads/$leadId.tsx` — renaming it is safe.

**Interfaces:**
- Consumes: `TenantDocument` from Task 3.
- Produces: `ContractSummary` type (renamed from `LeadContract`), `fetchTenantContracts(tenantId: string): Promise<ContractSummary[]>`, `fetchTenantDocuments(tenantId: string): Promise<TenantDocument[]>`.

- [ ] **Step 1: Rename `LeadContract` → `ContractSummary`**

In `apps/web/src/lib/queries.ts:399-408`, rename the interface:

```ts
export interface ContractSummary {
  id: string;
  code: string;
  status: string;
  pdfUrl: string | null;
  signedPdfUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRent: number;
}
```

Update `fetchLeadContracts`'s return type (`apps/web/src/lib/queries.ts:410-418`) from `Promise<LeadContract[]>` to `Promise<ContractSummary[]>` and the internal cast from `as LeadContract[]` to `as ContractSummary[]`.

- [ ] **Step 2: Add `fetchTenantContracts`**

Immediately after `fetchLeadContracts`, add:

```ts
export async function fetchTenantContracts(tenantId: string): Promise<ContractSummary[]> {
  const { data, error } = await supabase
    .from('Contract')
    .select('id, code, status, pdfUrl, signedPdfUrl, startDate, endDate, monthlyRent')
    .eq('tenantId', tenantId)
    .order('createdAt', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContractSummary[];
}
```

- [ ] **Step 3: Add `fetchTenantDocuments`**

Add, importing `TenantDocument` at the top of the file from `@kit-manager/types` (alongside whatever is already imported there):

```ts
export async function fetchTenantDocuments(tenantId: string): Promise<TenantDocument[]> {
  const { data, error } = await supabase
    .from('TenantDocument')
    .select('*')
    .eq('tenantId', tenantId)
    .order('createdAt', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TenantDocument[];
}
```

- [ ] **Step 4: Fix the rename's call site**

In `apps/web/src/routes/_dashboard/leads/$leadId.tsx:12`, `fetchLeadContracts` is imported but not `LeadContract` directly (verified — the type isn't imported there, only used as the inferred return type of `useQuery`). No further change needed there for the rename, but confirm with a typecheck.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/queries.ts
git commit -m "feat(web): add tenant documents/contracts queries, rename LeadContract to ContractSummary"
```

---

## Task 5: Extract shared `ContractsSection` component

**Files:**
- Create: `apps/web/src/components/contracts-section.tsx`
- Modify: `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

**Context:** `LeadContractsSection` (`apps/web/src/routes/_dashboard/leads/$leadId.tsx:597-726`) is ~130 lines of PDF preview/download logic that has nothing lead-specific in it except which query function it calls. Extract it so the tenant page (Task 7) can reuse it without duplicating the preview/download logic.

**Interfaces:**
- Consumes: `ContractSummary` from Task 4.
- Produces: `ContractsSection({ contracts, isLoading }: { contracts: ContractSummary[]; isLoading: boolean }): JSX.Element` — a named export.

- [ ] **Step 1: Create the shared component**

Create `apps/web/src/components/contracts-section.tsx` with the full body currently in `LeadContractsSection` (`apps/web/src/routes/_dashboard/leads/$leadId.tsx:597-726`), converted to take `contracts`/`isLoading` as props instead of owning the `useQuery` call itself (so it stays agnostic to whether the caller fetched by `leadId` or `tenantId`):

```tsx
import { Download, Eye, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '@/lib/api';
import type { ContractSummary } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

function storagePath(urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    const match = u.pathname.match(/\/object\/(?:public\/|sign\/|authenticated\/)?contracts\/(.+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    /* already a relative path */
  }
  return urlOrPath;
}

async function getSignedUrl(contractId: string, signedPdfPath?: string): Promise<string | null> {
  if (signedPdfPath) {
    const { data, error } = await supabase.storage
      .from('contracts')
      .createSignedUrl(storagePath(signedPdfPath), 300);
    return error ? null : (data?.signedUrl ?? null);
  }
  try {
    const { data } = await adminApi.getContractPdf(contractId);
    return data.url;
  } catch {
    return null;
  }
}

async function previewPdf(contractId: string, signedPdfPath?: string) {
  const tab = window.open('', '_blank');
  const signedUrl = await getSignedUrl(contractId, signedPdfPath);
  if (!signedUrl) {
    tab?.close();
    toast.error('Não foi possível abrir o arquivo.');
    return;
  }
  try {
    const resp = await fetch(signedUrl);
    if (!resp.ok) throw new Error();
    const blob = await resp.blob();
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    tab?.close();
    toast.error('Não foi possível abrir o arquivo.');
  }
}

async function downloadPdf(contractId: string, filename: string, signedPdfPath?: string) {
  const toastId = toast.loading('Baixando arquivo...');
  const signedUrl = await getSignedUrl(contractId, signedPdfPath);
  if (!signedUrl) {
    toast.error('Não foi possível baixar o arquivo.', { id: toastId });
    return;
  }
  try {
    const resp = await fetch(signedUrl);
    if (!resp.ok) throw new Error();
    const blob = await resp.blob();
    toast.dismiss(toastId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    toast.error('Não foi possível baixar o arquivo.', { id: toastId });
  }
}

export function ContractsSection({
  contracts,
  isLoading,
}: {
  contracts: ContractSummary[];
  isLoading: boolean;
}) {
  if (!isLoading && contracts.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-5">
      <h2 className="mb-4 text-sm font-medium text-foreground">Contrato</h2>
      {isLoading ? (
        <div className="space-y-2">
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
          <div className="h-10 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : (
        <div className="space-y-3">
          {contracts.map((c) => (
            <div key={c.id} className="space-y-2">
              {c.pdfUrl && (
                <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <FileText className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{c.code}.pdf</p>
                    <p className="text-xs text-muted-foreground">Contrato emitido</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Visualizar contrato"
                      onClick={() => void previewPdf(c.id)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Baixar contrato"
                      onClick={() => void downloadPdf(c.id, `${c.code}.pdf`)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                </div>
              )}
              {c.signedPdfUrl ? (
                <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                  <FileText className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{c.code}-assinado.pdf</p>
                    <p className="text-xs text-muted-foreground">Contrato assinado</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Visualizar contrato assinado"
                      onClick={() => void previewPdf(c.id, c.signedPdfUrl!)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Eye className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="Baixar contrato assinado"
                      onClick={() => void downloadPdf(c.id, `${c.code}-assinado.pdf`, c.signedPdfUrl!)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                  <FileText className="size-5 shrink-0 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">Aguardando contrato assinado</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

`data-slot` note: this component doesn't have a single semantic root role beyond a generic panel — follow `COMPONENT_PATTERN.md` and add `data-slot="contracts-section"` on the outer `div` if the project's lint/review expects it on every component (check a couple of existing `src/components/*.tsx` files for whether plain section panels like this carry `data-slot`; if none of the non-primitive section components do, skip it — don't invent a convention this file doesn't already have).

- [ ] **Step 2: Replace the lead page's local copy**

In `apps/web/src/routes/_dashboard/leads/$leadId.tsx`:
- Delete `LeadContractsSection` entirely (lines 597-726).
- Delete now-unused imports that only `LeadContractsSection` used: `Eye`, `Download` from `lucide-react` (check the rest of the file still uses `FileText` elsewhere — it does, in the "Anexar contrato" button, so keep that one), `adminApi.getContractPdf`-related import stays since `adminApi` is used elsewhere in the file, `supabase` stays (used elsewhere for docs), `fetchLeadContracts` import stays.
- Add `import { ContractsSection } from '@/components/contracts-section';`
- Replace the render site `<LeadContractsSection leadId={leadId} />` (line 586) with:

```tsx
      <ContractsSection contracts={contracts} isLoading={contractsLoading} />
```

- Add the query that used to live inside `LeadContractsSection`, now at the top of `LeadDetailPage` component body (near the other `useQuery` calls):

```tsx
  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ['lead-contracts', leadId],
    queryFn: () => fetchLeadContracts(leadId),
  });
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors, no unused-import warnings (Oxlint will also catch these — run `bunx oxlint` if available as a script).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/contracts-section.tsx apps/web/src/routes/_dashboard/leads/\$leadId.tsx
git commit -m "refactor(web): extract ContractsSection so tenant page can reuse it"
```

---

## Task 6: Extract shared `DocGrid` component

**Files:**
- Create: `apps/web/src/components/doc-grid.tsx`
- Modify: `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

**Context:** `DocGrid` + `DocViewerModal` (`apps/web/src/routes/_dashboard/leads/$leadId.tsx:53-127`) currently take `LeadDocument[]`. `TenantDocument` (Task 3) has the identical shape (`id, type, url, ocrText`) plus a different foreign key (`tenantId` vs `leadId`), which `DocGrid` never reads — so a small structural type covers both without an import-time union.

**Interfaces:**
- Produces: `DocGrid({ docs }: { docs: DocItem[] }): JSX.Element`, `DocItem` type, both exported.

- [ ] **Step 1: Create the shared component**

Create `apps/web/src/components/doc-grid.tsx`:

```tsx
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface DocItem {
  id: string;
  type: string;
  url: string;
  ocrText: string | null;
}

function DocViewerModal({ doc, onClose }: { doc: DocItem; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Documento: ${doc.type}`}
    >
      <div
        className="relative flex max-h-[90vh] max-w-3xl w-full flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Fechar"
          onClick={onClose}
          className="mb-3 self-end rounded-full p-1 text-white/70 transition-colors hover:text-white"
        >
          <X className="size-6" />
        </button>
        <img
          src={doc.url}
          alt={doc.type}
          className="max-h-[80vh] w-full rounded-lg object-contain shadow-xl"
        />
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-white/60">{doc.type}</p>
      </div>
    </div>
  );
}

export function DocGrid({ docs }: { docs: DocItem[] }) {
  const [selected, setSelected] = useState<DocItem | null>(null);

  if (docs.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {docs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            data-slot="doc-card"
            onClick={() => setSelected(doc)}
            className="overflow-hidden rounded-lg border border-border bg-surface text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex h-36 items-center justify-center overflow-hidden bg-muted">
              <img src={doc.url} alt={doc.type} className="h-full w-full object-contain" />
            </div>
            <div className="p-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {doc.type}
              </p>
              {doc.ocrText && (
                <p className="mt-1 line-clamp-2 text-xs text-foreground-subtle">{doc.ocrText}</p>
              )}
            </div>
          </button>
        ))}
      </div>
      {selected && <DocViewerModal doc={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
```

- [ ] **Step 2: Replace the lead page's local copy**

In `apps/web/src/routes/_dashboard/leads/$leadId.tsx`:
- Delete `DocViewerModal` (lines 53-91) and `DocGrid` (lines 93-127).
- Remove the now-unused `LeadDocument` type import (line 1) if nothing else in the file references it directly (check — `fetchLead`'s return type carries `documents: LeadDocument[]` inferred from `@/lib/queries`, so the file itself may not need the direct import anymore; confirm via typecheck).
- Add `import { DocGrid } from '@/components/doc-grid';`
- The render site (line 591, `<DocGrid docs={lead.documents ?? []} />`) needs no change — `LeadDocument[]` structurally satisfies `DocItem[]`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/doc-grid.tsx apps/web/src/routes/_dashboard/leads/\$leadId.tsx
git commit -m "refactor(web): extract DocGrid so tenant page can reuse it"
```

---

## Task 7: Wire documents + contract into the tenant detail page

**Files:**
- Modify: `apps/web/src/routes/_dashboard/tenants/$tenantId.tsx`

**Context:** Today this page (148 lines) shows payments and contact info only — no documents, no contract. Add both using the components from Tasks 5-6 and the queries from Task 4.

**Interfaces:**
- Consumes: `ContractsSection` (Task 5), `DocGrid` (Task 6), `fetchTenantContracts`, `fetchTenantDocuments` (Task 4).

- [ ] **Step 1: Add the queries**

In `apps/web/src/routes/_dashboard/tenants/$tenantId.tsx`, add imports:

```tsx
import { useQuery } from '@tanstack/react-query';
import { ContractsSection } from '@/components/contracts-section';
import { DocGrid } from '@/components/doc-grid';
import { fetchTenant, fetchTenantContracts, fetchTenantDocuments } from '@/lib/queries';
```

(`useQuery` is already imported at line 1 — don't duplicate; merge with the existing `fetchTenant` import at line 8.)

Inside `TenantDetailPage`, after the existing `fetchTenant` query (lines 33-36), add:

```tsx
  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ['tenant-contracts', tenantId],
    queryFn: () => fetchTenantContracts(tenantId),
    enabled: !!data,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['tenant-documents', tenantId],
    queryFn: () => fetchTenantDocuments(tenantId),
    enabled: !!data,
  });
```

- [ ] **Step 2: Render the sections**

In the JSX, after the closing `</div>` of the `grid gap-4 lg:grid-cols-[1fr_280px]` block (the payments+contact grid, ending at line 145), add:

```tsx
      <ContractsSection contracts={contracts} isLoading={contractsLoading} />

      <div
        className="rounded-[10px] bg-surface-raised p-5"
        style={{ boxShadow: 'var(--shadow-sm)' }}
      >
        <h2 className="mb-4 text-sm font-medium text-foreground">Documentos</h2>
        <DocGrid docs={documents} />
      </div>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`

- [ ] **Step 4: Manual verification**

Start the web app (`bun run dev` in `apps/web`) against a dev DB with a converted tenant that has `TenantDocument` rows (from Task 2's verification) and an active `Contract` with `signedPdfUrl` set. Open `/tenants/:id` and confirm both the contract (view/download buttons work) and the document grid render.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/tenants/\$tenantId.tsx
git commit -m "feat(web): show contract and documents on tenant detail page"
```

---

## Task 8: Remove the dead "Ganho" kanban column

**Files:**
- Modify: `apps/web/src/routes/_dashboard/leads/index.tsx`

**Context:** `fetchLeads` already filters `.is('archivedAt', null)` (`apps/web/src/lib/queries.ts:36`). After Task 2, every lead that reaches `stage: 'converted'` gets `archivedAt` set in the same instant (same transaction) — so it's removed from the fetched list before it could ever render in the `'ganho'` column. That column is permanently empty going forward; delete it instead of relabeling it.

**Interfaces:** none (UI-only, no new exports).

- [ ] **Step 1: Remove the column definition**

In `apps/web/src/routes/_dashboard/leads/index.tsx:34-56`, delete the last entry from `KANBAN_COLUMNS`:

```ts
  { key: 'ganho', label: 'Ganho', stages: ['converted'], droppable: false },
```

- [ ] **Step 2: Adjust the grid column count**

In the same file, `KanbanView`'s wrapper (`apps/web/src/routes/_dashboard/leads/index.tsx:142`) is currently:

```tsx
      <div className="grid grid-cols-2 gap-3 overflow-x-auto pb-4 sm:grid-cols-3 lg:grid-cols-5">
```

Change `lg:grid-cols-5` to `lg:grid-cols-4` (4 remaining columns: `novo`, `qualificacao`, `visita`, `proposta`).

- [ ] **Step 3: Typecheck and lint**

Run: `cd apps/web && bunx tsc --noEmit && bunx oxlint` (use whatever the project's lint script is named in `apps/web/package.json` if `oxlint` isn't callable directly).

- [ ] **Step 4: Manual verification**

Run the web app, open `/leads`, confirm the kanban shows 4 columns and a lead that reaches `contract_pending` → mark-signed disappears from the board entirely (rather than landing in a fifth column).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_dashboard/leads/index.tsx
git commit -m "fix(web): remove dead Ganho kanban column now that converted leads auto-archive"
```

---

## Task 9: Visible rejection for non-owner logins

**Files:**
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/routes/_auth/login.tsx`

**Context:** Today, `__root.tsx`'s `beforeLoad` (`apps/web/src/routes/__root.tsx:25-35`) silently calls `supabase.auth.signOut()` and redirects to `/login` when the authenticated email has no matching `Owner` row — no message at all. Per the earlier decision, **keep the block** (RLS isn't active — see Global Constraints), but surface *why* the user landed back on the login screen. Fire the message from the login route itself (via a search param), not from `beforeLoad`, so it's guaranteed to render after `<Toaster />` has mounted.

**Interfaces:** none new (route-local behavior only).

- [ ] **Step 1: Add a typed search param to the login route**

In `apps/web/src/routes/_auth/login.tsx`, add to the top imports:

```ts
import { z } from 'zod';
```

Then change the route definition (currently line 7):

```ts
export const Route = createFileRoute('/_auth/login')({
  validateSearch: z.object({ reason: z.enum(['not_registered']).optional() }),
  component: LoginPage,
});
```

- [ ] **Step 2: Show the message on mount**

In `LoginPage` (`apps/web/src/routes/_auth/login.tsx:9-13`), read the search param and toast once:

```tsx
function LoginPage() {
  const { reason } = Route.useSearch();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { darkMode } = useUiStore();

  useEffect(() => {
    if (reason === 'not_registered') {
      toast.error('Essa conta ainda não tem acesso ao painel. Fale com o administrador.');
    }
  }, [reason]);
```

Add `useEffect` to the existing `import { useState } from 'react';` line, making it `import { useEffect, useState } from 'react';`.

- [ ] **Step 3: Redirect with the reason from `__root.tsx`**

In `apps/web/src/routes/__root.tsx:25-35`, change:

```ts
    if (data.session && !isAuthRoute) {
      const { data: owner } = await supabase
        .from('Owner')
        .select('id')
        .eq('email', data.session.user.email ?? '')
        .maybeSingle();
      if (!owner) {
        await supabase.auth.signOut();
        throw redirect({ to: '/login' });
      }
    }
```

to:

```ts
    if (data.session && !isAuthRoute) {
      const { data: owner } = await supabase
        .from('Owner')
        .select('id')
        .eq('email', data.session.user.email ?? '')
        .maybeSingle();
      if (!owner) {
        await supabase.auth.signOut();
        throw redirect({ to: '/login', search: { reason: 'not_registered' } });
      }
    }
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors. TanStack Router's generated route tree (`src/routeTree.gen.ts`) picks up the new `validateSearch` automatically on next dev-server/build run — if `tsc` complains about the `search` param type on `redirect(...)` in `__root.tsx`, run the dev server once (`bun run dev`) to force route-tree regeneration, then re-run the typecheck.

- [ ] **Step 5: Manual verification**

Log in with a Google account (or magic link email) that has no matching `Owner.email` row. Confirm: you land on `/login`, and a red toast reads "Essa conta ainda não tem acesso ao painel. Fale com o administrador." — not silence.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/__root.tsx apps/web/src/routes/_auth/login.tsx
git commit -m "fix(web): show a message when a non-owner account is rejected at login"
```

---

## Task 10: Full regression pass

**Files:** none (verification only).

- [ ] **Step 1: Backend typecheck**

Run: `cd apps/bot && bunx tsc --noEmit`

- [ ] **Step 2: Backend tests**

Run: `cd apps/bot && bun test`
Expected: all green — this plan didn't touch anything with existing test coverage, but confirm no regression (in particular around `src/__tests__/contract-variables.test.ts`, which references `contractStart`/tenant fixtures).

- [ ] **Step 3: Frontend typecheck**

Run: `cd apps/web && bunx tsc --noEmit`

- [ ] **Step 4: Frontend tests**

Run: `cd apps/web && bun test`

- [ ] **Step 5: End-to-end manual walkthrough**

1. Convert a lead through the full flow (KYC → contract_pending → mark-signed) in a dev/staging environment.
2. Confirm the lead vanishes from `/leads` (kanban and table view) immediately.
3. Open the new `Tenant` at `/tenants/:id` — confirm contract (view + download) and documents both render.
4. Log in with a non-owner account — confirm the toast from Task 9.
5. Confirm the leads kanban has 4 columns, none labeled "Ganho".

- [ ] **Step 6: Final commit / PR**

Once all of the above is green, follow this repo's normal PR flow (feature branch + `gh pr create`, per existing project convention — do not merge to `main` directly).
