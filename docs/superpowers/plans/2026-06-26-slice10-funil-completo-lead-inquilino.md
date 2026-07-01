# Slice 10 — Funil Completo Lead → Inquilino — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the lead-to-tenant conversion funnel end-to-end so a lead can be converted to a tenant without any manual action outside the admin panel.

**Architecture:** Nine sequential tasks. Tasks 1–4 are foundational (schema, types, CPF utility, notifications, FSM). Tasks 5–6 extend the bot flow. Tasks 7–8 rewrite the two critical admin endpoints. Task 9 updates the web UI. Each task has clear file boundaries and explicit interfaces.

**Tech Stack:** Bun + TypeScript, Prisma (PostgreSQL), Fastify, PDFKit, Evolution API, Supabase Storage, Resend (email, optional), React 19 + TanStack Query, Tailwind v4 + shadcn/ui.

## Global Constraints

- `bun` only — no npm, no yarn
- `bun test src/__tests__` to run bot tests
- `bunx tsc --noEmit` to verify types (run in each app independently)
- No default exports in React components — named exports only
- CSS variables for colors — no hardcoded Tailwind color values (e.g., no `bg-blue-500`)
- `data-slot`, `tv()`, `{...props}` spread in components — see `CLAUDE.md`
- Prisma singleton at `@/db/client`
- Evolution API wrapper at `@/services/evolution` (`sendText`, `sendMedia`)
- `paymentDayOfMonth` clamped to 1–28 everywhere
- Log errors with `logger.error({ err }, '[scope] message')`
- Every endpoint guarded with `{ preHandler: verifyAdminJwt }`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `apps/bot/prisma/migrations/20260626000001_contract_lead_relation/migration.sql` | Modify | Add missing `ALTER TABLE "Contract" ALTER COLUMN "startDate" DROP NOT NULL` |
| `apps/bot/prisma/schema.prisma` | Modify | `Contract.tenantId?`, `Contract.startDate?`, `Contract.leadId?` FK, `Lead.contracts` inverse |
| `packages/types/src/contract.ts` | Modify | `tenantId: string \| null`, `startDate: string \| null`, `leadId?: string \| null`, add `'draft'` status |
| `packages/types/src/lead.ts` | Modify | Add `'data_confirmation'` to `LeadStage` |
| `apps/bot/src/services/cpf.ts` | Create | `extractCpfFromDocs()` utility |
| `apps/bot/src/__tests__/cpf.test.ts` | Create | Tests for `extractCpfFromDocs` |
| `apps/bot/src/config.ts` | Modify | Add `RESEND_API_KEY: z.string().optional()` |
| `apps/bot/src/services/notify.ts` | Modify | CPF in `kyc_pending` payload; Resend email channel; new `contract_signed` payload shape |
| `apps/bot/src/flows/lead/context.ts` | Modify | Add `dataConfirmed?`, `dataConfirmationSent?`, `visitConfirmationSent?` to `LeadContext`; update `deriveState()`, `STATE_GUIDANCE`, `currentProcessStep()` |
| `apps/bot/src/flows/lead/kyc.ts` | Modify | Split into `KYC_BLOCKER_STAGES` + `TERMINAL_STAGES`; add `dataConfirmed` param to `shouldTransitionToKyc` |
| `apps/bot/src/flows/lead/stage-map.ts` | Modify | Add `'lead.data_confirmation': 'data_confirmation'` |
| `apps/bot/src/__tests__/kycTransition.test.ts` | Modify | Update all `shouldTransitionToKyc` calls to 5 args |
| `apps/bot/src/flows/lead/__tests__/data-confirmation.test.ts` | Create | Tests for `data_confirmation` FSM behavior |
| `apps/bot/src/flows/lead/index.ts` | Modify | Visit confirmation + data_confirmation flow + CPF loading helper |
| `apps/bot/src/routes/admin.ts` | Modify | New `GET /admin/leads/:id/contract-variables`; rewrite `approve-kyc`; rewrite `mark-signed` |
| `apps/web/src/lib/leads.ts` | Modify | 6-step `STAGES`; `stageToStepKey()` helper; update `STAGE_LABELS`, `STAGE_TONE` |
| `apps/web/src/lib/api.ts` | Modify | Update `approveKyc` signature; add `getContractVariables`; remove `generateContract`, `confirmPayment` |
| `apps/web/src/routes/_dashboard/leads/$leadId.tsx` | Modify | Replace `GenerateContractModal` with `ApproveKycModal`; update stepper; simplify action buttons |

---

### Task 1: Migration SQL + Prisma schema + Shared types

**Files:**
- Modify: `apps/bot/prisma/migrations/20260626000001_contract_lead_relation/migration.sql`
- Modify: `apps/bot/prisma/schema.prisma`
- Modify: `packages/types/src/contract.ts`
- Modify: `packages/types/src/lead.ts`

**Interfaces:**
- Produces: `Contract.tenantId: string | null`, `Contract.startDate: string | null`, `Contract.leadId?: string | null` — used by Tasks 7, 8
- Produces: `LeadStage` includes `'data_confirmation'` — used by Tasks 3, 4, 6, 7, 8, 9

- [ ] **Step 1: Fix migration SQL — add missing `startDate` nullable**

Current content of `apps/bot/prisma/migrations/20260626000001_contract_lead_relation/migration.sql`:
```sql
ALTER TABLE "Contract" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "Contract" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Contract_leadId_idx" ON "Contract"("leadId");
```

Replace with:
```sql
-- Make Contract.tenantId nullable (contract exists before tenant is created)
ALTER TABLE "Contract" ALTER COLUMN "tenantId" DROP NOT NULL;

-- Make Contract.startDate nullable (set at signing time, not at creation)
ALTER TABLE "Contract" ALTER COLUMN "startDate" DROP NOT NULL;

-- Add Contract.leadId to track which lead originated the contract
ALTER TABLE "Contract" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Contract_leadId_idx" ON "Contract"("leadId");
```

- [ ] **Step 2: Update `apps/bot/prisma/schema.prisma`**

Find the `Contract` model. Locate these fields:
```prisma
tenantId  String
tenant    Tenant    @relation(fields: [tenantId], references: [id])
startDate DateTime
```

Replace with:
```prisma
tenantId  String?
tenant    Tenant?   @relation(fields: [tenantId], references: [id])
startDate DateTime?
leadId    String?
lead      Lead?     @relation(fields: [leadId], references: [id], onDelete: SetNull)
```

Add `@@index([leadId])` to the Contract model's index block.

In the `Lead` model, add the inverse relation (if not already present):
```prisma
contracts  Contract[]
```

Also add `'draft'` to `Contract.status` if it uses an enum (check schema — if `status` is a plain `String`, no change needed; if it's a Prisma enum, add `draft` to the enum values).

- [ ] **Step 3: Update `packages/types/src/contract.ts`**

Current:
```ts
export interface Contract {
  id: string;
  ownerId: string;
  code: string;
  templateId: string;
  tenantId: string;
  propertyId: string;
  body: string;
  status: 'active' | 'terminated' | 'renewal';
  pdfUrl: string | null;
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  createdAt: string;
  updatedAt: string;
}
```

Replace with:
```ts
export interface Contract {
  id: string;
  ownerId: string;
  code: string;
  templateId: string;
  tenantId: string | null;
  leadId?: string | null;
  propertyId: string;
  body: string;
  status: 'active' | 'terminated' | 'renewal' | 'draft';
  pdfUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRent: number;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Update `packages/types/src/lead.ts`**

Find `LeadStage`. Add `'data_confirmation'` between `'collection'` and `'review_submitted'`:
```ts
export type LeadStage =
  | 'interest'
  | 'visiting'
  | 'collection'
  | 'data_confirmation'
  | 'review_submitted'
  | 'kyc_pending'
  | 'kyc_approved'
  | 'residents_docs_complete'
  | 'contract_pending'
  | 'contract_signed'
  | 'converted';
```

- [ ] **Step 5: Validate types compile**

```bash
cd packages/types && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Apply migration (skip if no dev DB access)**

```bash
cd apps/bot && bunx prisma validate
```

Expected: "Prisma schema validated successfully."

If connected to dev DB: `bunx prisma migrate dev --name contract_lead_relation`

- [ ] **Step 7: Commit**

```bash
git add apps/bot/prisma/migrations/20260626000001_contract_lead_relation/migration.sql \
        apps/bot/prisma/schema.prisma \
        packages/types/src/contract.ts \
        packages/types/src/lead.ts
git commit -m "feat(schema): make Contract.tenantId+startDate nullable, add leadId FK, data_confirmation stage"
```

---

### Task 2: CPF extraction utility

**Files:**
- Create: `apps/bot/src/services/cpf.ts`
- Create: `apps/bot/src/__tests__/cpf.test.ts`

**Interfaces:**
- Produces: `extractCpfFromDocs(docs: { ocrText: string | null }[]): string | null` — used by Tasks 6, 7, 8

- [ ] **Step 1: Write the failing test**

Create `apps/bot/src/__tests__/cpf.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { extractCpfFromDocs } from '@/services/cpf';

describe('extractCpfFromDocs', () => {
  test('returns null for empty docs array', () => {
    expect(extractCpfFromDocs([])).toBeNull();
  });

  test('returns null when no CPF in text', () => {
    expect(extractCpfFromDocs([{ ocrText: 'João da Silva RG 12345' }])).toBeNull();
  });

  test('extracts formatted CPF 000.000.000-00', () => {
    expect(extractCpfFromDocs([{ ocrText: 'CPF: 123.456.789-09' }])).toBe('123.456.789-09');
  });

  test('extracts and normalizes unformatted CPF', () => {
    expect(extractCpfFromDocs([{ ocrText: 'cpf 12345678909' }])).toBe('123.456.789-09');
  });

  test('finds CPF in second doc when first has none', () => {
    expect(
      extractCpfFromDocs([
        { ocrText: 'RG: 12.345.678-9' },
        { ocrText: 'CPF 321.654.987-00' },
      ]),
    ).toBe('321.654.987-00');
  });

  test('returns null when ocrText is null', () => {
    expect(extractCpfFromDocs([{ ocrText: null }])).toBeNull();
  });

  test('normalizes partial-formatted CPF', () => {
    expect(extractCpfFromDocs([{ ocrText: '456.789.123-45' }])).toBe('456.789.123-45');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/bot && bun test src/__tests__/cpf.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/bot/src/services/cpf.ts`**

```ts
const CPF_RAW_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;

function normalizeCpf(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

export function extractCpfFromDocs(docs: { ocrText: string | null }[]): string | null {
  const allText = docs.map((d) => d.ocrText ?? '').join(' ');
  CPF_RAW_REGEX.lastIndex = 0;
  const match = CPF_RAW_REGEX.exec(allText);
  if (!match) return null;
  return normalizeCpf(match[0]);
}
```

Note: `CPF_RAW_REGEX.lastIndex = 0` is required because the regex uses the `g` flag and is module-level — resetting prevents stale state between calls.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/bot && bun test src/__tests__/cpf.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/services/cpf.ts apps/bot/src/__tests__/cpf.test.ts
git commit -m "feat(bot): add extractCpfFromDocs utility"
```

---

### Task 3: Config + notify.ts + Resend

**Files:**
- Modify: `apps/bot/src/config.ts`
- Modify: `apps/bot/src/services/notify.ts`

**Interfaces:**
- Produces: `notifyOwner(ownerId, 'kyc_pending', { leadName, leadPhone, cpf: string | null })` — used by Task 6
- Produces: `notifyOwner(ownerId, 'contract_signed', { leadName, tenantExternalId: string })` — used by Task 8

- [ ] **Step 1: Install resend**

```bash
cd apps/bot && bun add resend
```

Expected: `resend` appears in `apps/bot/package.json` dependencies.

- [ ] **Step 2: Add `RESEND_API_KEY` to `apps/bot/src/config.ts`**

Find the Sentry section at the end of the schema:
```ts
  // Sentry — optional
  SENTRY_DSN: z.string().url().optional(),
});
```

Add after `SENTRY_DSN`:
```ts
  // Resend (email notifications) — optional
  RESEND_API_KEY: z.string().optional(),
```

- [ ] **Step 3: Rewrite `apps/bot/src/services/notify.ts`**

Replace entire file:
```ts
import { Resend } from 'resend';
import { config } from '@/config';
import { prisma } from '@/db/client';
import { logger } from '@/lib/logger';
import { sendText } from '@/services/evolution';

type NotifyPayloadMap = {
  kyc_pending: { leadName: string; leadPhone: string; cpf: string | null };
  contract_signed: { leadName: string; tenantExternalId: string };
  payment_overdue: { tenantName: string; propertyName: string; daysOverdue: number };
};

type NotifyOwnerEventType = keyof NotifyPayloadMap;

type NotifyArgs =
  | { eventType: 'kyc_pending'; payload: NotifyPayloadMap['kyc_pending'] }
  | { eventType: 'contract_signed'; payload: NotifyPayloadMap['contract_signed'] }
  | { eventType: 'payment_overdue'; payload: NotifyPayloadMap['payment_overdue'] };

function buildWhatsAppMessage(args: NotifyArgs): string {
  switch (args.eventType) {
    case 'kyc_pending': {
      const cpfStr = args.payload.cpf ? ` — CPF: ${args.payload.cpf}` : '';
      return `KYC pendente: ${args.payload.leadName} (${args.payload.leadPhone})${cpfStr}. Acesse o painel para revisar e aprovar.`;
    }
    case 'contract_signed':
      return `✅ Contrato assinado por ${args.payload.leadName}. Inquilino criado: ${args.payload.tenantExternalId}.`;
    case 'payment_overdue':
      return `Pagamento em atraso ha ${args.payload.daysOverdue} dias: ${args.payload.tenantName} - ${args.payload.propertyName}.`;
  }
}

function buildEmailContent(args: NotifyArgs): { subject: string; html: string } | null {
  switch (args.eventType) {
    case 'kyc_pending': {
      const cpfLine = args.payload.cpf ? `<p>CPF: ${args.payload.cpf}</p>` : '';
      return {
        subject: `KYC pendente — ${args.payload.leadName}`,
        html: `<p>Lead: ${args.payload.leadName}</p><p>Telefone: ${args.payload.leadPhone}</p>${cpfLine}<p>Acesse o painel para revisar os documentos e aprovar o KYC.</p>`,
      };
    }
    case 'contract_signed':
      return {
        subject: `Contrato assinado — ${args.payload.leadName}`,
        html: `<p>Contrato assinado por ${args.payload.leadName}.</p><p>Inquilino criado: ${args.payload.tenantExternalId}.</p>`,
      };
    default:
      return null;
  }
}

type OwnerInfo = {
  phone: string;
  notificationPhone: string | null;
  notificationEmail: string | null;
};
const ownerCache = new Map<string, OwnerInfo>();

async function getOwnerInfo(ownerId: string): Promise<OwnerInfo | null> {
  const cached = ownerCache.get(ownerId);
  if (cached) return cached;
  const owner = await prisma.owner.findUnique({
    where: { id: ownerId },
    select: { phone: true, notificationPhone: true, notificationEmail: true },
  });
  if (!owner) return null;
  ownerCache.set(ownerId, owner);
  return owner;
}

export async function notifyOwner<T extends NotifyOwnerEventType>(
  ownerId: string,
  eventType: T,
  payload: NotifyPayloadMap[T],
): Promise<void> {
  try {
    const owner = await getOwnerInfo(ownerId);
    if (!owner) {
      logger.error({ ownerId }, 'notifyOwner: owner not found');
      return;
    }

    const args = { eventType, payload } as NotifyArgs;
    const phone = owner.notificationPhone ?? owner.phone;
    await sendText(`${phone}@s.whatsapp.net`, buildWhatsAppMessage(args));

    if (config.RESEND_API_KEY && owner.notificationEmail) {
      const emailContent = buildEmailContent(args);
      if (emailContent) {
        const resend = new Resend(config.RESEND_API_KEY);
        await resend.emails.send({
          from: 'kit-manager <notificacoes@kit-manager.app>',
          to: owner.notificationEmail,
          subject: emailContent.subject,
          html: emailContent.html,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'notifyOwner failed (non-blocking)');
  }
}
```

- [ ] **Step 4: Verify types compile**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/bot/src/config.ts apps/bot/src/services/notify.ts
git commit -m "feat(bot): add Resend email channel to notifyOwner; CPF in kyc_pending payload"
```

---

### Task 4: FSM data_confirmation state

**Files:**
- Modify: `apps/bot/src/flows/lead/context.ts`
- Modify: `apps/bot/src/flows/lead/kyc.ts`
- Modify: `apps/bot/src/flows/lead/stage-map.ts`
- Modify: `apps/bot/src/__tests__/kycTransition.test.ts`
- Create: `apps/bot/src/flows/lead/__tests__/data-confirmation.test.ts`

**Interfaces:**
- Produces: `shouldTransitionToKyc(docsStage, residentsCount, residentsComplete, leadStage, dataConfirmed): boolean` — 5 args, used by Task 6
- Produces: `LeadContext.dataConfirmed?: boolean`, `LeadContext.dataConfirmationSent?: boolean`, `LeadContext.visitConfirmationSent?: boolean` — used by Tasks 5, 6
- Produces: `deriveState()` returns `'lead.data_confirmation'` when docs+residents complete but `!context.dataConfirmed`

- [ ] **Step 1: Write failing tests for the new `shouldTransitionToKyc` signature**

Open `apps/bot/src/__tests__/kycTransition.test.ts`. Add these 3 tests at the end of the `describe` block:
```ts
test('does not transition when dataConfirmed is false', () => {
  expect(shouldTransitionToKyc('complete', 1, true, 'interest', false)).toBe(false);
});

test('transitions from data_confirmation when dataConfirmed is true', () => {
  expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', true)).toBe(true);
});

test('does not transition from data_confirmation when dataConfirmed is false', () => {
  expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', false)).toBe(false);
});
```

Run:
```bash
cd apps/bot && bun test src/__tests__/kycTransition.test.ts
```

Expected: FAIL — TypeScript error (wrong arg count) or assertion failures.

- [ ] **Step 2: Rewrite `apps/bot/src/flows/lead/kyc.ts`**

```ts
const KYC_BLOCKER_STAGES = new Set([
  'kyc_pending',
  'kyc_approved',
  'residents_docs_complete',
  'contract_pending',
  'contract_signed',
  'converted',
]);

// TERMINAL_STAGES includes data_confirmation to prevent FSM stage regression.
// KYC_BLOCKER_STAGES excludes data_confirmation so KYC transition can fire once dataConfirmed=true.
export const TERMINAL_STAGES = new Set([...KYC_BLOCKER_STAGES, 'data_confirmation']);

export function shouldTransitionToKyc(
  docsStage: string,
  residentsCount: number,
  residentsComplete: boolean,
  leadStage: string,
  dataConfirmed: boolean,
): boolean {
  return (
    docsStage === 'complete' &&
    residentsCount > 0 &&
    residentsComplete &&
    dataConfirmed &&
    !KYC_BLOCKER_STAGES.has(leadStage)
  );
}

export function shouldUpdateLeadSource(
  currentSource: string | null | undefined,
  extractedSource: string | null,
): boolean {
  if (!extractedSource || extractedSource === 'desconhecido') return false;
  return !currentSource || currentSource === 'whatsapp';
}
```

- [ ] **Step 3: Update all existing calls in `kycTransition.test.ts`**

All 4-arg calls to `shouldTransitionToKyc` need a 5th argument. Pattern: add `, true` to calls that test non-dataConfirmed failure modes (so those tests still prove docs/residents are the blockers, not dataConfirmed):

Find every `shouldTransitionToKyc(` call in the file and add `, true` before the closing `)`:
- `shouldTransitionToKyc('complete', 1, true, 'interest')` → `shouldTransitionToKyc('complete', 1, true, 'interest', true)`
- `shouldTransitionToKyc('complete', 1, true, 'collection')` → `shouldTransitionToKyc('complete', 1, true, 'collection', true)`
- `shouldTransitionToKyc('complete', 0, true, 'interest')` → `shouldTransitionToKyc('complete', 0, true, 'interest', true)`
- `shouldTransitionToKyc('cnh_images', 1, true, 'interest')` → `shouldTransitionToKyc('cnh_images', 1, true, 'interest', true)`

Etc. — update every existing call.

- [ ] **Step 4: Run updated tests**

```bash
cd apps/bot && bun test src/__tests__/kycTransition.test.ts
```

Expected: all tests PASS including the 3 new ones.

- [ ] **Step 5: Update `apps/bot/src/flows/lead/context.ts`**

**5a. Add new fields to `LeadContext` interface** (add after `docsReceivedCount`):
```ts
  visitConfirmationSent?: boolean;
  dataConfirmed?: boolean;
  dataConfirmationSent?: boolean;
```

**5b. Add `data_confirmation` to `STATE_GUIDANCE`:**
```ts
  'lead.data_confirmation':
    'Confirme com o lead o nome e CPF extraídos dos documentos antes de enviar para análise.',
```

**5c. Update `currentProcessStep()`** — add before the `'lead.review_submitted'` line:
```ts
  if (state === 'lead.data_confirmation')
    return 'confirmacao de dados antes da analise';
```

**5d. Update `deriveState()`** — find the end of the function:
```ts
  if (applicationMissingItems.length > 0) return 'lead.collect_application';
  if (docsStage !== 'complete') return 'lead.collect_application';
  if (!residentsComplete) return 'lead.collect_application';

  return 'lead.review_submitted';
```

Replace with:
```ts
  if (applicationMissingItems.length > 0) return 'lead.collect_application';
  if (docsStage !== 'complete') return 'lead.collect_application';
  if (!residentsComplete) return 'lead.collect_application';
  if (!context.dataConfirmed) return 'lead.data_confirmation';

  return 'lead.review_submitted';
```

- [ ] **Step 6: Update `apps/bot/src/flows/lead/stage-map.ts`**

Add `'lead.data_confirmation': 'data_confirmation'` to `FSM_TO_STAGE`:
```ts
const FSM_TO_STAGE: Partial<Record<string, LeadStage>> = {
  'lead.start': 'interest',
  'lead.offer_options': 'interest',
  'lead.property_info': 'interest',
  'lead.objection_handling': 'interest',
  'lead.visit_scheduling': 'visiting',
  'lead.visit_requested': 'visiting',
  'lead.post_visit_decision': 'collection',
  'lead.collect_application': 'collection',
  'lead.data_confirmation': 'data_confirmation',
  'lead.review_submitted': 'review_submitted',
};
```

Note: `TERMINAL_STAGES` in `kyc.ts` now includes `'data_confirmation'`. Because `fsmStateToLeadStage` returns `null` when `TERMINAL_STAGES.has(currentStage)`, a lead already at `data_confirmation` stage won't have their stage regressed by subsequent messages.

- [ ] **Step 7: Create `apps/bot/src/flows/lead/__tests__/data-confirmation.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { shouldTransitionToKyc, TERMINAL_STAGES } from '@/flows/lead/kyc';

describe('data_confirmation FSM behavior', () => {
  test('data_confirmation is in TERMINAL_STAGES (prevents regression)', () => {
    expect(TERMINAL_STAGES.has('data_confirmation')).toBe(true);
  });

  test('allows KYC transition from data_confirmation when confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', true)).toBe(true);
  });

  test('blocks KYC transition from data_confirmation when not confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'data_confirmation', false)).toBe(false);
  });

  test('blocks KYC from kyc_pending even when confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'kyc_pending', true)).toBe(false);
  });

  test('blocks KYC from contract_pending even when confirmed', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'contract_pending', true)).toBe(false);
  });

  test('blocks KYC from converted', () => {
    expect(shouldTransitionToKyc('complete', 1, true, 'converted', true)).toBe(false);
  });
});
```

- [ ] **Step 8: Run all tests**

```bash
cd apps/bot && bun test src/__tests__ && bun test src/flows/lead/__tests__/data-confirmation.test.ts
```

Expected: all tests PASS.

- [ ] **Step 9: Verify types compile**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/bot/src/flows/lead/context.ts \
        apps/bot/src/flows/lead/kyc.ts \
        apps/bot/src/flows/lead/stage-map.ts \
        apps/bot/src/__tests__/kycTransition.test.ts \
        apps/bot/src/flows/lead/__tests__/data-confirmation.test.ts
git commit -m "feat(bot): add data_confirmation FSM state; gate KYC on dataConfirmed flag"
```

---

### Task 5: Visit confirmation message

**Files:**
- Modify: `apps/bot/src/flows/lead/index.ts`

**Interfaces:**
- Consumes: `LeadContext.visitConfirmationSent?: boolean` (added in Task 4)
- Consumes: `leadPatch.scheduledVisitAt: Date | undefined`, `lead.scheduledVisitAt: Date | null`

- [ ] **Step 1: Insert visit confirmation block in `handleLeadMessage`**

In `apps/bot/src/flows/lead/index.ts`, find:
```ts
    if (kycTransition) {
      notifyOwner(lead.ownerId, 'kyc_pending', {
        leadName: lead.name ?? chatId,
        leadPhone: chatId,
      }).catch((err) => logger.error({ err }, '[lead.flow] notifyOwner kyc_pending failed'));
    }
```

Replace that `notifyOwner` call with (also update the payload to include cpf — done in Task 6; for now keep a placeholder):
```ts
    if (kycTransition) {
      notifyOwner(lead.ownerId, 'kyc_pending', {
        leadName: lead.name ?? chatId,
        leadPhone: chatId,
        cpf: null,
      }).catch((err) => logger.error({ err }, '[lead.flow] notifyOwner kyc_pending failed'));
    }
```

Then immediately after that block, add:
```ts
    // Visit confirmation: send once per scheduled visit date
    const newVisitAt = leadPatch.scheduledVisitAt as Date | undefined;
    const prevVisitAt = lead.scheduledVisitAt;
    const visitDateChanged =
      newVisitAt != null &&
      (prevVisitAt == null || newVisitAt.getTime() !== prevVisitAt.getTime());

    if (visitDateChanged && !context.visitConfirmationSent) {
      const dateStr = newVisitAt.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const timeStr = newVisitAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      });
      const propertyName = snapshot.propertyInFocus?.name ?? 'o imóvel';
      sendText(
        chatId,
        `✅ Visita confirmada! Aguardamos você no dia ${dateStr} às ${timeStr} no ${propertyName}. Qualquer dúvida, é só chamar!`,
      ).catch((err) => logger.error({ err }, '[lead.flow] Failed to send visit confirmation'));
      context.visitConfirmationSent = true;
    } else if (visitDateChanged) {
      // Re-scheduled — reset so confirmation fires again next turn
      context.visitConfirmationSent = false;
    }
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/bot/src/flows/lead/index.ts
git commit -m "feat(bot): send WhatsApp visit confirmation on visit scheduling"
```

---

### Task 6: Data confirmation bot flow

**Files:**
- Modify: `apps/bot/src/flows/lead/index.ts`

**Interfaces:**
- Consumes: `extractCpfFromDocs` from Task 2
- Consumes: `shouldTransitionToKyc(5 args)` from Task 4
- Consumes: `LeadContext.dataConfirmed`, `LeadContext.dataConfirmationSent` from Task 4
- Consumes: `notifyOwner(ownerId, 'kyc_pending', { leadName, leadPhone, cpf })` from Task 3

- [ ] **Step 1: Add imports to index.ts**

Add to the imports at the top:
```ts
import { extractCpfFromDocs } from '@/services/cpf';
```

- [ ] **Step 2: Add `loadLeadDocuments` helper**

Add after `loadOrCreateConversation`:
```ts
async function loadLeadDocuments(leadId: string): Promise<Array<{ ocrText: string | null }>> {
  return prisma.leadDocument.findMany({
    where: { leadId },
    select: { ocrText: true },
  });
}
```

- [ ] **Step 3: Reset confirmation flags when new docs are submitted**

After the `await persistLeadDocuments(...)` call in step 7 of `handleLeadMessage`, add:
```ts
    // Reset data confirmation if new documents were submitted this turn
    const hasNewDocs = mediaItems.filter((m) => !isAudioMedia(m) && m.url).length > 0;
    if (hasNewDocs && context.dataConfirmed) {
      context.dataConfirmed = false;
      context.dataConfirmationSent = false;
    }
```

- [ ] **Step 4: Update `shouldTransitionToKyc` call to 5 args**

Find:
```ts
    const kycTransition = shouldTransitionToKyc(
      snapshot.docsStage,
      (context.residents ?? []).length,
      snapshot.residentsComplete,
      lead.stage,
    );
```

Replace with:
```ts
    const kycTransition = shouldTransitionToKyc(
      snapshot.docsStage,
      (context.residents ?? []).length,
      snapshot.residentsComplete,
      lead.stage,
      context.dataConfirmed ?? false,
    );
```

- [ ] **Step 5: Update the `notifyOwner` call for kycTransition to include CPF**

Find the `notifyOwner` call added in Task 5 (with `cpf: null`):
```ts
      notifyOwner(lead.ownerId, 'kyc_pending', {
        leadName: lead.name ?? chatId,
        leadPhone: chatId,
        cpf: null,
      }).catch(...)
```

Replace with:
```ts
      const kycDocs = await loadLeadDocuments(lead.id);
      notifyOwner(lead.ownerId, 'kyc_pending', {
        leadName: lead.name ?? chatId,
        leadPhone: chatId,
        cpf: extractCpfFromDocs(kycDocs),
      }).catch((err) => logger.error({ err }, '[lead.flow] notifyOwner kyc_pending failed'));
```

- [ ] **Step 6: Add the data_confirmation handler**

After the visit confirmation block (end of Task 5), add:
```ts
    // Data confirmation gate — deterministic flow, always returns early
    if (snapshot.state === 'lead.data_confirmation') {
      if (!context.dataConfirmationSent) {
        // First entry: extract CPF and send confirmation or ask for better image
        const docs = await loadLeadDocuments(lead.id);
        const cpf = extractCpfFromDocs(docs);

        if (!cpf) {
          // CPF not found — ask lead for better photo, stay in collect_application
          const noKycMsg =
            'Não consegui ler o CPF no documento. Pode enviar uma foto mais nítida, com boa iluminação e sem reflexo?';
          context.state = snapshot.state;
          context.lastUserMessage = messageText;
          context.lastRoutedAgent = 'deterministic_data_confirmation';
          await persistConversation(chatId, context, messageText || null, noKycMsg, ownerId);
          await sendText(chatId, noKycMsg);
          return;
        }

        // CPF found — send data confirmation message
        const confirmName = context.name ?? lead.name ?? 'não informado';
        const confirmMsg =
          'Por favor, confirme seus dados:\n\n' +
          `Nome: ${confirmName}\n` +
          `CPF: ${cpf}\n\n` +
          'Está correto? Responda *sim* para confirmar ou *não* para corrigir.';

        context.dataConfirmationSent = true;
        context.state = snapshot.state;
        context.lastUserMessage = messageText;
        context.lastRoutedAgent = 'deterministic_data_confirmation';
        await persistConversation(chatId, context, messageText || null, confirmMsg, ownerId);
        await sendText(chatId, confirmMsg);
        return;
      }

      // Lead received confirmation message — check their response
      const CONFIRMATION_WORDS = [
        'sim', 'correto', 'certo', 'ok', 'isso', 'exato', 'perfeito',
        'confirmo', 'pode', 'está certo', 'tá certo', 'está ok', 'tudo certo', 'tá ok',
      ];
      const lower = messageText.toLowerCase().trim();
      const isConfirmed = CONFIRMATION_WORDS.some((w) => lower.includes(w));

      if (isConfirmed) {
        context.dataConfirmed = true;
        const confirmedMsg =
          '✅ Dados confirmados! Seus documentos foram enviados para análise. Em breve entraremos em contato.';

        // Move stage to kyc_pending (separate update since leadPatch already ran)
        await prisma.lead.update({ where: { phone: chatId }, data: { stage: 'kyc_pending' } });

        const docs = await loadLeadDocuments(lead.id);
        notifyOwner(lead.ownerId, 'kyc_pending', {
          leadName: lead.name ?? chatId,
          leadPhone: chatId,
          cpf: extractCpfFromDocs(docs),
        }).catch((err) => logger.error({ err }, '[lead.flow] notifyOwner kyc_pending failed'));

        context.state = snapshot.state;
        context.lastUserMessage = messageText;
        context.lastRoutedAgent = 'deterministic_data_confirmation';
        await persistConversation(chatId, context, messageText || null, confirmedMsg, ownerId);
        await sendText(chatId, confirmedMsg);
        return;
      }
      // Not confirmed — fall through to agent (collection agent handles correction)
    }
```

- [ ] **Step 7: Verify types compile**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run all bot tests**

```bash
cd apps/bot && bun test src/__tests__
```

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/bot/src/flows/lead/index.ts
git commit -m "feat(bot): add data_confirmation flow — CPF extraction, lead data confirmation gate"
```

---

### Task 7: approve-KYC endpoint rewrite

**Files:**
- Modify: `apps/bot/src/routes/admin.ts`

**Interfaces:**
- Consumes: `extractCpfFromDocs` from Task 2
- Consumes: `generateAndUploadPdf(contractId, body, code): Promise<string>` from `@/services/pdf`
- Consumes: `sendMedia(chatId, type, url, caption)` from `@/services/evolution`
- Consumes: `nextExternalId('contract')` from `@/services/external-id`
- Consumes: `normalizeLookupText` from `@/services/catalog`
- Request body: `{ paymentDayOfMonth: number, manualVariables?: Record<string, string | null> }`
- Response: `{ success: true, contractId: string, stage: 'contract_pending' }`

Note: `lead.documents` is available via the `documents LeadDocument[]` relation already present on the `Lead` model in `schema.prisma` (verified at line 114).

- [x] **Step 1: Add missing imports to `admin.ts`**

Find the imports at the top of `apps/bot/src/routes/admin.ts`. Ensure these are present:
```ts
import { extractCpfFromDocs } from '@/services/cpf';
import { sendMedia, sendText } from '@/services/evolution';  // add sendMedia
```

(`sendText` is already imported — just add `sendMedia` to the same import.)

- [x] **Step 2: Add `GET /admin/leads/:id/contract-variables` endpoint**

Insert this NEW endpoint BEFORE the `// ─── approve-kyc` block (around line 272):

```ts
  // ─── contract-variables preview ──────────────────────────────────────────
  fastify.get<{
    Params: { id: string };
    Querystring: { paymentDayOfMonth?: string };
  }>('/admin/leads/:id/contract-variables', { preHandler: verifyAdminJwt }, async (request, reply) => {
    const { id } = request.params;
    const paymentDayOfMonth = Math.min(28, Math.max(1, Number(request.query.paymentDayOfMonth ?? 10)));

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { phone: true, name: true, propertyId: true, documents: { select: { ocrText: true } } },
    });
    if (!lead) return reply.status(404).send({ error: 'Lead not found' });
    if (!lead.propertyId) return reply.send({ unresolved: [], hasTemplate: false });

    const [property, template] = await Promise.all([
      prisma.property.findUnique({
        where: { id: lead.propertyId },
        include: { owner: true },
      }),
      prisma.contractTemplate.findFirst({
        where: { status: 'published' },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    if (!template) return reply.send({ unresolved: [], hasTemplate: false });
    if (!property) return reply.send({ unresolved: [], hasTemplate: true });

    const cpf = extractCpfFromDocs(lead.documents);
    const autoMap: Record<string, string> = {
      locatario: lead.name ?? lead.phone,
      cpf_locatario: cpf ?? '',
      telefone_locatario: lead.phone,
      locador: property.owner?.name ?? '',
      imovel: property.name,
      endereco: [property.address, property.complement].filter(Boolean).join(', '),
      bairro: property.neighborhood,
      aluguel: Number(property.rent).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      deposito: Number(property.deposit).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      data_hoje: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      data_assinatura: 'A ser preenchida na assinatura',
      vencimento: String(paymentDayOfMonth),
    };

    const varRegex = /\{\{([^}]+)\}\}/g;
    const allVars = [...new Set([...template.body.matchAll(varRegex)].map((m) => m[0]))];
    const unresolved: string[] = [];
    for (const placeholder of allVars) {
      const key = normalizeLookupText(placeholder.slice(2, -2));
      if (!(key in autoMap)) unresolved.push(placeholder);
    }

    return reply.send({ unresolved, hasTemplate: true });
  });
```

- [x] **Step 3: Rewrite the `approve-kyc` endpoint**

Find the block starting at `// ─── approve-kyc` (approx line 272) through the closing `);` of that `fastify.post(...)` call (approx line 323). Replace it entirely:

```ts
  // ─── approve-kyc ──────────────────────────────────────────────────────────
  fastify.post<{
    Params: { id: string };
    Body: { paymentDayOfMonth: number; manualVariables?: Record<string, string | null> };
  }>(
    '/admin/leads/:id/approve-kyc',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;
      const { paymentDayOfMonth, manualVariables = {} } = request.body;

      if (!Number.isInteger(paymentDayOfMonth) || paymentDayOfMonth < 1 || paymentDayOfMonth > 28) {
        return reply.status(400).send({ error: 'paymentDayOfMonth must be an integer between 1 and 28' });
      }

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: {
          phone: true, name: true, stage: true, ownerId: true, propertyId: true,
          documents: { select: { ocrText: true } },
        },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
      if (lead.stage !== 'kyc_pending') {
        return reply.status(409).send({ error: `Lead is in stage '${lead.stage}', expected 'kyc_pending'` });
      }
      if (!lead.propertyId) {
        return reply.status(409).send({ error: 'Lead has no associated property' });
      }

      const [property, template] = await Promise.all([
        prisma.property.findUnique({ where: { id: lead.propertyId }, include: { owner: true } }),
        prisma.contractTemplate.findFirst({ where: { status: 'published' }, orderBy: { updatedAt: 'desc' } }),
      ]);
      if (!property) return reply.status(404).send({ error: 'Property not found' });
      if (!template) {
        return reply.status(409).send({
          error: 'No published contract template found. Publish a template before approving KYC.',
        });
      }

      const cpf = extractCpfFromDocs(lead.documents);

      const formatBRL = (n: number | { toNumber(): number }) =>
        Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const formatDate = (d: Date) =>
        d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      const today = new Date();
      const autoMap: Record<string, string> = {
        locatario: lead.name ?? lead.phone,
        cpf_locatario: cpf ?? '',
        telefone_locatario: lead.phone,
        locador: property.owner?.name ?? '',
        imovel: property.name,
        endereco: [property.address, property.complement].filter(Boolean).join(', '),
        bairro: property.neighborhood,
        aluguel: formatBRL(property.rent),
        deposito: formatBRL(Number(property.deposit)),
        data_hoje: formatDate(today),
        data_assinatura: 'A ser preenchida na assinatura',
        vencimento: String(paymentDayOfMonth),
      };

      const varRegex = /\{\{([^}]+)\}\}/g;
      let body = template.body;

      // 1. Auto-resolve known variables
      for (const placeholder of [...new Set([...template.body.matchAll(varRegex)].map((m) => m[0]))]) {
        const key = normalizeLookupText(placeholder.slice(2, -2));
        if (key in autoMap) body = body.replaceAll(placeholder, autoMap[key]);
      }

      // 2. Apply manual overrides — null = remove, string = replace
      for (const [placeholder, value] of Object.entries(manualVariables)) {
        body = body.replaceAll(placeholder, value === null ? '' : value);
      }

      // 3. Replace any remaining unresolved placeholders with N/A
      body = body.replace(/\{\{[^}]+\}\}/g, 'N/A');

      const contractCode = await nextExternalId('contract');

      const contract = await prisma.contract.create({
        data: {
          code: contractCode,
          ownerId: lead.ownerId,
          templateId: template.id,
          leadId: id,
          tenantId: null,
          propertyId: lead.propertyId,
          body,
          status: 'draft',
          startDate: null,
          monthlyRent: property.rent,
        },
      });

      const pdfPath = await generateAndUploadPdf(contract.id, body, contractCode);
      await prisma.contract.update({ where: { id: contract.id }, data: { pdfUrl: pdfPath } });

      const { data: signedUrlData } = await supabase.storage
        .from('contracts')
        .createSignedUrl(pdfPath, 3600);

      await prisma.lead.update({ where: { id }, data: { stage: 'contract_pending' } });

      const pdfUrl = signedUrlData?.signedUrl ?? null;
      if (pdfUrl) {
        sendMedia(lead.phone, 'document', pdfUrl,
          'Segue seu contrato para revisão. Qualquer dúvida, é só chamar!',
        ).catch((err) => fastify.log.warn({ err }, 'Failed to send contract PDF to lead'));
      } else {
        sendText(lead.phone,
          '✅ Contrato gerado! Em breve você receberá o arquivo. Qualquer dúvida, é só chamar.',
        ).catch((err) => fastify.log.warn({ err }, 'Failed to notify lead after KYC approval'));
      }

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'kyc_approved',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'contract_auto_created',
        subject: contractCode,
        subjectId: contract.id,
        subjectType: 'contract',
      }).catch(fastify.log.warn.bind(fastify.log));

      return reply.send({ success: true, contractId: contract.id, stage: 'contract_pending' });
    },
  );
```

- [x] **Step 4: Verify types compile**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add apps/bot/src/routes/admin.ts
git commit -m "feat(bot): approve-kyc auto-generates contract from template and sends PDF to lead"
```

---

### Task 8: mark-signed endpoint rewrite

**Files:**
- Modify: `apps/bot/src/routes/admin.ts`

**Interfaces:**
- Consumes: `extractCpfFromDocs` from Task 2
- Consumes: `generateAndUploadPdf` from `@/services/pdf`
- Consumes: `sendMedia` from `@/services/evolution`
- Consumes: `nextExternalId('tenant')` from `@/services/external-id`
- Consumes: `notifyOwner(ownerId, 'contract_signed', { leadName, tenantExternalId })` from Task 3
- No request body change — `POST /admin/leads/:id/mark-signed` with no body

- [x] **Step 1: Rewrite the `mark-signed` endpoint**

Find the `// ─── mark-contract-signed` block (approx lines 385–424). Replace it entirely:

```ts
  // ─── mark-contract-signed ────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/admin/leads/:id/mark-signed',
    { preHandler: verifyAdminJwt },
    async (request, reply) => {
      const { id } = request.params;

      const lead = await prisma.lead.findUnique({
        where: { id },
        select: {
          name: true, phone: true, ownerId: true, stage: true, propertyId: true,
          documents: { select: { ocrText: true } },
        },
      });
      if (!lead) return reply.status(404).send({ error: 'Lead not found' });
      if (lead.stage !== 'contract_pending') {
        return reply.status(409).send({
          error: `Lead is in stage '${lead.stage}', expected 'contract_pending'`,
        });
      }
      if (!lead.propertyId) {
        return reply.status(409).send({ error: 'Lead has no associated property' });
      }

      const contract = await prisma.contract.findFirst({
        where: { leadId: id, status: 'draft' },
        orderBy: { createdAt: 'desc' },
      });
      if (!contract) {
        return reply.status(404).send({ error: 'No draft contract found for this lead' });
      }

      const cpf = extractCpfFromDocs(lead.documents);
      const tenantExternalId = await nextExternalId('tenant');
      const today = new Date();

      const tenant = await prisma.tenant.create({
        data: {
          phone: lead.phone,
          name: lead.name,
          cpf,
          propertyId: lead.propertyId,
          contractStart: today,
          externalId: tenantExternalId,
          ownerId: lead.ownerId,
        },
      });

      const formatDate = (d: Date) =>
        d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      // Replace the draft placeholder with the actual signing date
      const finalBody = contract.body.replace(
        /A ser preenchida na assinatura/g,
        formatDate(today),
      );

      const pdfPath = await generateAndUploadPdf(contract.id, finalBody, contract.code);

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          tenantId: tenant.id,
          startDate: today,
          status: 'active',
          body: finalBody,
          pdfUrl: pdfPath,
        },
      });

      await prisma.property.update({ where: { id: lead.propertyId }, data: { active: false } });

      await prisma.lead.update({ where: { id }, data: { stage: 'converted' } });

      const { data: signedUrlData } = await supabase.storage
        .from('contracts')
        .createSignedUrl(pdfPath, 3600);

      const pdfUrl = signedUrlData?.signedUrl ?? null;
      if (pdfUrl) {
        sendMedia(lead.phone, 'document', pdfUrl,
          '✅ Contrato assinado! Aqui está sua cópia com a data de início preenchida.',
        ).catch((err) => fastify.log.warn({ err }, 'Failed to send signed contract to lead'));
      }

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'contract_signed',
        subject: lead.name ?? lead.phone,
        subjectId: id,
        subjectType: 'lead',
      }).catch(fastify.log.warn.bind(fastify.log));

      logActivityHelper({
        actorType: 'user',
        actorLabel: request.adminUserId ?? 'admin',
        ownerId: lead.ownerId,
        action: 'tenant_auto_created',
        subject: tenantExternalId,
        subjectId: tenant.id,
        subjectType: 'tenant',
      }).catch(fastify.log.warn.bind(fastify.log));

      notifyOwner(lead.ownerId, 'contract_signed', {
        leadName: lead.name ?? lead.phone,
        tenantExternalId,
      }).catch((err: unknown) =>
        fastify.log.warn({ err }, 'Failed to notify owner on contract_signed'),
      );

      return reply.send({ success: true, tenantId: tenant.id, stage: 'converted' });
    },
  );
```

- [x] **Step 2: Verify types compile**

```bash
cd apps/bot && bunx tsc --noEmit
```

Expected: no errors.

- [x] **Step 3: Commit**

```bash
git add apps/bot/src/routes/admin.ts
git commit -m "feat(bot): mark-signed auto-creates tenant, regenerates PDF, moves lead to converted"
```

---

### Task 9: Web UI — stepper + ApproveKycModal

**Files:**
- Modify: `apps/web/src/lib/leads.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/routes/_dashboard/leads/$leadId.tsx`

**Interfaces:**
- Consumes: `adminApi.approveKyc(leadId, { paymentDayOfMonth, manualVariables? })` (new signature)
- Consumes: `adminApi.getContractVariables(leadId, paymentDayOfMonth)` → `{ unresolved: string[], hasTemplate: boolean }`
- Consumes: `adminApi.markContractSigned(leadId)` (unchanged)
- Consumes: `stageToStepKey(stage: string): string` from `@/lib/leads`

- [x] **Step 1: Update `apps/web/src/lib/leads.ts`**

Replace the entire file:
```ts
import type { LeadSource } from '@kit-manager/types';

export type StageTone = 'ok' | 'warn' | 'bad' | 'accent' | 'default';

export function formatPhone(phone: string): string {
  return phone.replace(/@.*$/, '');
}

export const SOURCE_LABELS: Record<LeadSource, string> = {
  whatsapp: 'WhatsApp',
  olx: 'OLX',
  zap: 'ZAP',
  site: 'Site',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  outro: 'Outro',
  desconhecido: '?',
  other: 'Outro',
};

// 6-step funnel stepper (hidden stages map to nearest visible step via stageToStepKey)
export const STAGES = [
  { key: 'interest', label: 'Interesse' },
  { key: 'visiting', label: 'Visita' },
  { key: 'collection', label: 'Documentos' },
  { key: 'kyc_pending', label: 'KYC' },
  { key: 'contract_pending', label: 'Contrato' },
  { key: 'converted', label: 'Convertido' },
] as const;

const STAGE_TO_STEP_KEY: Record<string, string> = {
  interest: 'interest',
  visiting: 'visiting',
  collection: 'collection',
  data_confirmation: 'collection',
  review_submitted: 'collection',
  kyc_pending: 'kyc_pending',
  kyc_approved: 'kyc_pending',
  residents_docs_complete: 'kyc_pending',
  contract_pending: 'contract_pending',
  contract_signed: 'contract_pending',
  converted: 'converted',
};

export function stageToStepKey(stage: string): string {
  return STAGE_TO_STEP_KEY[stage] ?? 'interest';
}

export const STAGE_LABELS: Record<string, string> = {
  interest: 'Interesse',
  visiting: 'Visita',
  collection: 'Coletando docs',
  data_confirmation: 'Confirmando dados',
  review_submitted: 'Docs enviados',
  kyc_pending: 'KYC pendente',
  kyc_approved: 'KYC aprovado',
  residents_docs_complete: 'Docs completos',
  contract_pending: 'Contrato pendente',
  contract_signed: 'Contrato assinado',
  converted: 'Convertido',
};

export const STAGE_TONE: Record<string, StageTone> = {
  interest: 'default',
  visiting: 'accent',
  collection: 'default',
  data_confirmation: 'accent',
  review_submitted: 'accent',
  kyc_pending: 'warn',
  kyc_approved: 'ok',
  residents_docs_complete: 'accent',
  contract_pending: 'warn',
  contract_signed: 'ok',
  converted: 'ok',
};
```

- [x] **Step 2: Update `apps/web/src/lib/api.ts`**

Replace:
```ts
  approveKyc: (leadId: string) => botApi.post(`/admin/leads/${leadId}/approve-kyc`),
  generateContract: (leadId: string, paymentDayOfMonth: number) =>
    botApi.post(`/admin/leads/${leadId}/generate-contract`, { paymentDayOfMonth }),
  confirmPayment: (leadId: string) => botApi.post(`/admin/leads/${leadId}/confirm-payment`),
```

With:
```ts
  approveKyc: (
    leadId: string,
    body: { paymentDayOfMonth: number; manualVariables?: Record<string, string | null> },
  ) => botApi.post(`/admin/leads/${leadId}/approve-kyc`, body),
  getContractVariables: (leadId: string, paymentDayOfMonth: number) =>
    botApi.get<{ unresolved: string[]; hasTemplate: boolean }>(
      `/admin/leads/${leadId}/contract-variables?paymentDayOfMonth=${paymentDayOfMonth}`,
    ),
```

- [x] **Step 3: Update `$leadId.tsx` — imports**

Add `stageToStepKey` to the import from `@/lib/leads`:
```ts
import { SOURCE_LABELS, STAGES, stageToStepKey } from '@/lib/leads';
```

Remove the `fetchPublishedTemplates` import from `@/lib/queries` (no longer needed — replaced by `getContractVariables`).

- [x] **Step 4: Update `StageStepper` to use `stageToStepKey`**

Find:
```ts
function StageStepper({ current }: { current: string }) {
  const currentIdx = STAGES.findIndex((s) => s.key === current);
```

Replace with:
```ts
function StageStepper({ current }: { current: string }) {
  const stepKey = stageToStepKey(current);
  const currentIdx = STAGES.findIndex((s) => s.key === stepKey);
```

- [x] **Step 5: Replace `GenerateContractModal` with `ApproveKycModal`**

Delete the entire `GenerateContractModal` function (lines 76–157). Replace with:

```tsx
type ManualVarAction = 'fill' | 'remove' | 'ignore';

interface ManualVarState {
  action: ManualVarAction;
  value: string;
}

function ApproveKycModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [day, setDay] = useState(10);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [varStates, setVarStates] = useState<Record<string, ManualVarState>>({});
  const [loadingVars, setLoadingVars] = useState(false);
  const [hasTemplate, setHasTemplate] = useState(true);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      const manualVariables: Record<string, string | null> = {};
      for (const [placeholder, state] of Object.entries(varStates)) {
        if (state.action === 'fill') manualVariables[placeholder] = state.value;
        else if (state.action === 'remove') manualVariables[placeholder] = null;
        // 'ignore' → omit from map; backend replaces with N/A
      }
      return adminApi.approveKyc(leadId, {
        paymentDayOfMonth: Math.min(28, Math.max(1, day)),
        manualVariables,
      });
    },
    onSuccess: () => {
      toast.success('KYC aprovado. Contrato gerado e enviado ao lead.');
      void qc.invalidateQueries({ queryKey: ['lead', leadId] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Erro ao aprovar KYC.')),
  });

  async function goToStep2() {
    setLoadingVars(true);
    try {
      const { data } = await adminApi.getContractVariables(leadId, Math.min(28, Math.max(1, day)));
      setHasTemplate(data.hasTemplate);
      if (!data.hasTemplate) return;
      if (data.unresolved.length === 0) {
        mutation.mutate();
        return;
      }
      const initial: Record<string, ManualVarState> = {};
      for (const p of data.unresolved) initial[p] = { action: 'ignore', value: '' };
      setVarStates(initial);
      setUnresolved(data.unresolved);
      setStep(2);
    } catch {
      toast.error('Erro ao verificar variáveis do contrato.');
    } finally {
      setLoadingVars(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20">
      <div
        data-slot="modal"
        className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-6 shadow-lg"
      >
        {step === 1 ? (
          <>
            <h2 className="text-base font-semibold text-foreground">Aprovar KYC</h2>
            <p className="mt-1 text-sm text-muted-foreground">Dia de vencimento do aluguel</p>
            <input
              type="number"
              min={1}
              max={28}
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              className="mt-3 w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {!hasTemplate && (
              <p className="mt-2 text-sm text-destructive">
                Nenhum template publicado.{' '}
                <Link to="/templates" onClick={onClose} className="font-medium underline">
                  Publicar template →
                </Link>
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <CustomButton variant="secondary" onClick={onClose}>
                Cancelar
              </CustomButton>
              <CustomButton
                variant="primary"
                onClick={() => void goToStep2()}
                disabled={loadingVars || !hasTemplate}
              >
                {loadingVars ? 'Verificando...' : 'Próximo →'}
              </CustomButton>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-foreground">Variáveis pendentes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              As seguintes variáveis não foram preenchidas automaticamente:
            </p>
            <div className="mt-3 space-y-4">
              {unresolved.map((placeholder) => {
                const state = varStates[placeholder] ?? { action: 'ignore' as ManualVarAction, value: '' };
                return (
                  <div key={placeholder} className="space-y-1.5">
                    <p className="font-mono text-sm text-foreground">{placeholder}</p>
                    <div className="flex gap-2">
                      <CustomButton
                        variant={state.action === 'fill' ? 'primary' : 'secondary'}
                        onClick={() =>
                          setVarStates((prev) => ({
                            ...prev,
                            [placeholder]: { action: 'fill', value: state.value },
                          }))
                        }
                      >
                        Preencher
                      </CustomButton>
                      <CustomButton
                        variant={state.action === 'remove' ? 'primary' : 'secondary'}
                        onClick={() =>
                          setVarStates((prev) => ({
                            ...prev,
                            [placeholder]: { action: 'remove', value: '' },
                          }))
                        }
                      >
                        Remover
                      </CustomButton>
                    </div>
                    {state.action === 'fill' && (
                      <input
                        type="text"
                        placeholder="Valor"
                        value={state.value}
                        onChange={(e) =>
                          setVarStates((prev) => ({
                            ...prev,
                            [placeholder]: { action: 'fill', value: e.target.value },
                          }))
                        }
                        className="w-full rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <CustomButton
                variant="secondary"
                onClick={() => {
                  const all: Record<string, ManualVarState> = {};
                  for (const p of unresolved) all[p] = { action: 'ignore', value: '' };
                  setVarStates(all);
                  mutation.mutate();
                }}
                disabled={mutation.isPending}
              >
                Ignorar todas
              </CustomButton>
              <div className="flex gap-2">
                <CustomButton variant="secondary" onClick={() => setStep(1)}>
                  ← Voltar
                </CustomButton>
                <CustomButton
                  variant="primary"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending}
                >
                  {mutation.isPending ? 'Aprovando...' : 'Confirmar e aprovar'}
                </CustomButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [x] **Step 6: Update `LeadDetailPage` state + mutations**

Find:
```ts
const [showContractModal, setShowContractModal] = useState(false);
```

Replace with:
```ts
const [showApproveKycModal, setShowApproveKycModal] = useState(false);
```

Remove the `approveKyc` and `confirmPayment` mutations (lines ~187–203). Keep `markSigned` as-is.

- [x] **Step 7: Update the action buttons section**

Find the action buttons block (from `{/* Action buttons */}` to the end of the modal render). Replace all stage-conditional buttons with:

```tsx
{/* Action buttons */}
{lead.stage === 'kyc_pending' && (
  <div className="flex gap-2">
    <CustomButton variant="primary" onClick={() => setShowApproveKycModal(true)}>
      <CheckCircle className="size-4" />
      Aprovar KYC
    </CustomButton>
  </div>
)}
{lead.stage === 'contract_pending' && (
  <div className="flex gap-2">
    <CustomButton
      variant="primary"
      disabled={markSigned.isPending}
      onClick={() => markSigned.mutate()}
    >
      <CheckCircle className="size-4" />
      {markSigned.isPending ? 'Salvando…' : 'Marcar contrato assinado'}
    </CustomButton>
  </div>
)}

{showApproveKycModal && (
  <ApproveKycModal leadId={leadId} onClose={() => setShowApproveKycModal(false)} />
)}
```

Also remove the old modal render `{showContractModal && <GenerateContractModal ... />}`.

- [x] **Step 8: Verify types compile**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [x] **Step 9: Commit**

```bash
git add apps/web/src/lib/leads.ts apps/web/src/lib/api.ts \
        "apps/web/src/routes/_dashboard/leads/\$leadId.tsx" \
        apps/bot/src/routes/admin.ts
git commit -m "feat(web): 6-step funnel stepper, ApproveKycModal with variable resolution"
```

---

## Self-Review

### 1. Spec coverage

| Spec section | Task | Notes |
|---|---|---|
| §3 Migration: `tenantId` nullable + `startDate` nullable + `leadId` FK | Task 1 | ✅ |
| §4 CPF regex extraction + retry (better image message) | Tasks 2, 6 | ✅ |
| §5 Visit confirmation message + `visitConfirmationSent` flag | Tasks 4, 5 | ✅ |
| §6 `RESEND_API_KEY` + email channel + CPF in `kyc_pending` | Task 3 | ✅ |
| §7 approve-KYC modal 2-step + auto-contract + variable resolution | Tasks 7, 9 | ✅ |
| §7 `GET /admin/leads/:id/contract-variables` for unresolved list | Tasks 7, 9 | ✅ |
| §8 mark-signed auto-tenant + Contract update + property rented + PDF regen + notify | Task 8 | ✅ |
| §9 Stepper 6 steps + `data_confirmation`→Documentos + action buttons | Task 9 | ✅ |
| `data_confirmation` FSM state in `deriveState()` | Task 4 | ✅ |
| `dataConfirmed` gate on `shouldTransitionToKyc` | Task 4 | ✅ |
| `'data_confirmation'` added to `LeadStage` type | Task 1 | ✅ |
| `'draft'` added to `Contract.status` type | Task 1 | ✅ |

### 2. Placeholder scan

No TBD / TODO / "implement later" in the plan. All code blocks are complete and compilable.

### 3. Type consistency cross-check

- `extractCpfFromDocs(docs: { ocrText: string | null }[]): string | null` — defined Task 2, used in Tasks 6 (index.ts), 7 (approve-kyc), 8 (mark-signed), and Task 7 (contract-variables endpoint)
- `shouldTransitionToKyc(docsStage, residentsCount, residentsComplete, leadStage, dataConfirmed)` — 5 args, defined Task 4, used Task 6
- `notifyOwner(ownerId, 'kyc_pending', { leadName, leadPhone, cpf })` — Task 3 defines, Tasks 5/6 use
- `notifyOwner(ownerId, 'contract_signed', { leadName, tenantExternalId })` — Task 3 defines, Task 8 uses
- `adminApi.approveKyc(leadId, body)` — Task 9 api.ts defines, `ApproveKycModal` consumes
- `adminApi.getContractVariables(leadId, paymentDayOfMonth)` — Task 9 api.ts defines, `ApproveKycModal` consumes
- `STAGES` — now 6-element const array, `StageStepper` uses `stageToStepKey()` to map current stage

### 4. Key invariants

- `data_confirmation` ∈ `TERMINAL_STAGES` → no FSM stage regression after lead reaches it
- `data_confirmation` ∉ `KYC_BLOCKER_STAGES` → `shouldTransitionToKyc` fires when `dataConfirmed=true`
- Two separate `prisma.lead.update` calls in `index.ts` when lead confirms data: first sets `data_confirmation` (via `leadPatch`), second sets `kyc_pending` (in confirmation handler). Intentional — both are sequential.
- CPF regex `lastIndex` reset on each call because module-level `g` flag regex retains state.

---

**Plan saved to `docs/superpowers/plans/2026-06-26-slice10-funil-completo-lead-inquilino.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, review between tasks, fast iteration. Use skill `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session. Use skill `superpowers:executing-plans`.

**Which approach?**
