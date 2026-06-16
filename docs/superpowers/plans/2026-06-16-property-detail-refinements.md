# Property Detail Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 issues in the property detail page — replace noisy activity log with financial summary, add rent due date, hide visit schedule when rented, fix seed data, status-aware sidebar, and broaden query invalidation.

**Architecture:** All changes are in `apps/web` (except seed). New Supabase query functions in `queries.ts` feed new React components in `$propertyId/index.tsx`. The "Histórico" tab becomes "Financeiro" with a contract card + payment list. The sidebar becomes status-aware: `rented` → tenant + due date, `available` → active leads (or nothing if no leads), `maintenance` → hidden.

**Tech Stack:** React 19, TanStack Query v5, supabase-js v2, Tailwind CSS v4, shadcn/ui (`Pill`), `formatCurrency` from `@/lib/utils`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/web/src/lib/queries.ts` | Modify | Add 3 new query functions + update `fetchPropertyTenant` and `PropertyTenantSummary` |
| `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx` | Modify | New `PropertyFinancialTab`, updated `TenantSidebar`, new `LeadsSidebar`, status-aware sidebar render, conditional `visitSchedule`, broader invalidation |
| `apps/web/src/routes/_dashboard/properties/$propertyId/edit.tsx` | Modify | Add 4 query invalidations on save success |
| `apps/bot/prisma/seed.ts` | Modify | Add `visitSchedule` to `update` path for KIT-01 and KIT-02 |

---

### Task 1: Add query functions to `queries.ts`

**Files:**
- Modify: `apps/web/src/lib/queries.ts`

- [ ] **Step 1: Add `LeadStage` to existing imports**

At the top of `queries.ts`, the `@kit-manager/types` import is:
```ts
import type {
  ContractDetail,
  ContractSummary,
  ContractTemplate,
  ContractTemplateSummary,
  Conversation,
  Lead,
  LeadDocument,
  Payment,
  Property,
  PropertyMedia,
  RuleSetDetail,
  RuleSetSummary,
  Tenant,
} from '@kit-manager/types';
```

Replace with (adds `LeadStage`):
```ts
import type {
  ContractDetail,
  ContractSummary,
  ContractTemplate,
  ContractTemplateSummary,
  Conversation,
  Lead,
  LeadDocument,
  LeadStage,
  Payment,
  Property,
  PropertyMedia,
  RuleSetDetail,
  RuleSetSummary,
  Tenant,
} from '@kit-manager/types';
```

- [ ] **Step 2: Update `PropertyTenantSummary` — add `dueDay`**

Find:
```ts
export interface PropertyTenantSummary {
  id: string;
  name: string | null;
  phone: string;
  onTimeRate: number | null;
}
```

Replace with:
```ts
export interface PropertyTenantSummary {
  id: string;
  name: string | null;
  phone: string;
  onTimeRate: number | null;
  dueDay: number | null;
}
```

- [ ] **Step 3: Update `fetchPropertyTenant` — select `dueDay`**

Find the select string `.select('id, name, phone, onTimeRate')` in `fetchPropertyTenant` and replace the entire function:

```ts
export async function fetchPropertyTenant(
  propertyId: string,
): Promise<PropertyTenantSummary | null> {
  const { data, error } = await supabase
    .from('Tenant')
    .select('id, name, phone, onTimeRate, dueDay')
    .eq('propertyId', propertyId)
    .maybeSingle();
  if (error) throw error;
  return data as PropertyTenantSummary | null;
}
```

- [ ] **Step 4: Add `PropertyContractSummary` and `fetchPropertyContract`**

Append after the updated `fetchPropertyTenant`:

```ts
export interface PropertyContractSummary {
  id: string;
  code: string;
  endDate: string | null;
  monthlyRent: number;
  tenantName: string | null;
}

type PropertyContractRow = {
  id: string;
  code: string;
  endDate: string | null;
  monthlyRent: number;
  tenant: { name: string | null }[];
};

export async function fetchPropertyContract(
  propertyId: string,
): Promise<PropertyContractSummary | null> {
  const { data, error } = await supabase
    .from('Contract')
    .select('id, code, endDate, monthlyRent, tenant:Tenant(name)')
    .eq('propertyId', propertyId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as unknown as PropertyContractRow;
  return {
    id: row.id,
    code: row.code,
    endDate: row.endDate,
    monthlyRent: row.monthlyRent,
    tenantName: row.tenant[0]?.name ?? null,
  };
}
```

- [ ] **Step 5: Add `fetchPropertyPayments`**

Append after `fetchPropertyContract`:

```ts
export async function fetchPropertyPayments(propertyId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('Payment')
    .select('*')
    .eq('propertyId', propertyId)
    .order('month', { ascending: false })
    .limit(12);
  if (error) throw error;
  return (data ?? []) as Payment[];
}
```

- [ ] **Step 6: Add `PropertyLeadSummary` and `fetchPropertyLeads`**

Append after `fetchPropertyPayments`:

```ts
export interface PropertyLeadSummary {
  id: string;
  name: string | null;
  phone: string;
  stage: LeadStage;
}

export async function fetchPropertyLeads(propertyId: string): Promise<PropertyLeadSummary[]> {
  const { data, error } = await supabase
    .from('Lead')
    .select('id, name, phone, stage')
    .eq('propertyId', propertyId)
    .neq('stage', 'converted')
    .order('updatedAt', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PropertyLeadSummary[];
}
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/queries.ts
git commit -m "feat(web): add property financial + leads query functions, add dueDay to tenant summary"
```

---

### Task 2: Update `$propertyId/index.tsx`

**Files:**
- Modify: `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx`

Apply all 6 sub-steps in order — they all touch the same file.

- [ ] **Step 1: Update imports**

Replace the `@/lib/queries` import:
```ts
// Before:
import {
  type ActivityLogEntry,
  fetchProperty,
  fetchPropertyActivityLog,
  fetchPropertyTenant,
} from '@/lib/queries';

// After:
import {
  fetchProperty,
  fetchPropertyContract,
  fetchPropertyLeads,
  fetchPropertyPayments,
  fetchPropertyTenant,
} from '@/lib/queries';
```

Remove `formatActivityLabel` import (entire line):
```ts
// Remove:
import { formatActivityLabel } from '@/lib/activity-labels';
```

Remove `relativeTime` from utils import (no longer used):
```ts
// Before:
import { cn, formatCurrency, relativeTime } from '@/lib/utils';

// After:
import { cn, formatCurrency } from '@/lib/utils';
```

- [ ] **Step 2: Rename `Tab` type — `history` → `financial`**

```ts
// Before:
type Tab = 'details' | 'rules' | 'gallery' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Detalhes' },
  { id: 'rules', label: 'Regras' },
  { id: 'gallery', label: 'Galeria' },
  { id: 'history', label: 'Histórico' },
];

// After:
type Tab = 'details' | 'rules' | 'gallery' | 'financial';

const TABS: { id: Tab; label: string }[] = [
  { id: 'details', label: 'Detalhes' },
  { id: 'rules', label: 'Regras' },
  { id: 'gallery', label: 'Galeria' },
  { id: 'financial', label: 'Financeiro' },
];
```

- [ ] **Step 3: Replace `PropertyHistoryTab` with `PropertyFinancialTab`**

Delete the entire `PropertyHistoryTab` function and replace it with:

```tsx
const PAYMENT_STATUS_TONE = {
  paid: 'ok',
  pending: 'warn',
  overdue: 'bad',
} as const;

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  overdue: 'Atrasado',
};

const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

function PropertyFinancialTab({ propertyId }: { propertyId: string }) {
  const { data: contract, isLoading: contractLoading } = useQuery({
    queryKey: ['property-contract', propertyId],
    queryFn: () => fetchPropertyContract(propertyId),
    staleTime: 60_000,
  });

  const { data: payments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ['property-payments', propertyId],
    queryFn: () => fetchPropertyPayments(propertyId),
    staleTime: 60_000,
  });

  if (contractLoading || paymentsLoading)
    return <div className="h-24 animate-pulse rounded-lg bg-muted" />;

  const daysLeft = contract?.endDate
    ? Math.ceil((new Date(contract.endDate).getTime() - Date.now()) / 86_400_000)
    : null;
  const contractTone =
    daysLeft === null ? 'ok' : daysLeft < 0 ? 'bad' : daysLeft <= 60 ? 'warn' : 'ok';
  const contractLabel =
    daysLeft === null
      ? 'Ativo'
      : daysLeft < 0
        ? 'Vencido'
        : daysLeft <= 60
          ? `Vence em ${daysLeft}d`
          : 'Ativo';

  return (
    <div className="space-y-5">
      {contract ? (
        <div className="rounded-lg bg-muted/40 px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Contrato {contract.code}</p>
            <p className="text-sm font-medium text-foreground">
              {contract.tenantName ?? '—'} · {formatCurrency(contract.monthlyRent)}
            </p>
            {contract.endDate && (
              <p className="text-xs text-muted-foreground">
                Término: {dateFmt.format(new Date(contract.endDate))}
              </p>
            )}
          </div>
          <Pill tone={contractTone} dot>
            {contractLabel}
          </Pill>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum contrato ativo.</p>
      )}

      <div>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Últimos pagamentos
        </h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-2.5"
              >
                <span className="text-sm text-foreground">
                  {monthFmt.format(new Date(`${p.month}-01`))}
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-foreground">
                    {formatCurrency(p.amount)}
                  </span>
                  <Pill
                    tone={
                      PAYMENT_STATUS_TONE[p.status as keyof typeof PAYMENT_STATUS_TONE] ?? 'default'
                    }
                    dot
                  >
                    {PAYMENT_STATUS_LABEL[p.status] ?? p.status}
                  </Pill>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `TenantSidebar` — display `dueDay`**

In `TenantSidebar`, after the status badge line, add the due day:

```tsx
// Before (last two lines of the return):
{status && <span className={cn('text-xs font-medium', status.color)}>{status.label}</span>}
<Link ...>Ver inquilino →</Link>

// After:
{status && <span className={cn('text-xs font-medium', status.color)}>{status.label}</span>}
{tenant.dueDay != null && (
  <p className="text-xs text-muted-foreground">Vencimento: dia {tenant.dueDay}</p>
)}
<Link ...>Ver inquilino →</Link>
```

- [ ] **Step 5: Add `LeadsSidebar` component**

Insert the following after the closing brace of `TenantSidebar`:

```tsx
const LEAD_STAGE_LABELS: Record<string, string> = {
  interest: 'Interesse',
  collection: 'Docs',
  review_submitted: 'Em análise',
  visiting: 'Visitando',
  kyc_pending: 'KYC',
  kyc_approved: 'Aprovado',
  residents_docs_complete: 'Docs OK',
  contract_pending: 'Contrato',
  contract_signed: 'Assinado',
};

function LeadsSidebar({ propertyId }: { propertyId: string }) {
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['property-leads', propertyId],
    queryFn: () => fetchPropertyLeads(propertyId),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;
  if (leads.length === 0) return null;

  return (
    <div data-slot="leads-summary" className="space-y-2">
      {leads.map((lead) => (
        <div key={lead.id} className="flex items-center justify-between gap-2">
          <p className="text-sm text-foreground truncate">{lead.name ?? lead.phone}</p>
          <Pill tone="default">{LEAD_STAGE_LABELS[lead.stage] ?? lead.stage}</Pill>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Wire everything in `PropertyDetailPage`**

**a) Broaden invalidation in the `invalidate` mutation `onSuccess`:**

```ts
// Before:
onSuccess: () => {
  toast.success('Cache limpo com sucesso.');
  void qc.invalidateQueries({ queryKey: ['property', propertyId] });
},

// After:
onSuccess: () => {
  toast.success('Cache limpo com sucesso.');
  void qc.invalidateQueries({ queryKey: ['property', propertyId] });
  void qc.invalidateQueries({ queryKey: ['property-tenant', propertyId] });
  void qc.invalidateQueries({ queryKey: ['property-payments', propertyId] });
  void qc.invalidateQueries({ queryKey: ['property-contract', propertyId] });
  void qc.invalidateQueries({ queryKey: ['property-leads', propertyId] });
},
```

**b) Make `visitSchedule` conditional on `property.status === 'available'`:**

```tsx
// Before:
{property.visitSchedule && (
  <InfoRow label="Visita" value={property.visitSchedule} />
)}

// After:
{property.status === 'available' && property.visitSchedule && (
  <InfoRow label="Visita" value={property.visitSchedule} />
)}
```

**c) Replace the `history` tab render with `financial`:**

```tsx
// Before:
{tab === 'history' && (
  <div ...>
    <h2 className="mb-4 text-sm font-medium text-foreground">Histórico</h2>
    <PropertyHistoryTab propertyId={propertyId} />
  </div>
)}

// After:
{tab === 'financial' && (
  <div
    className="rounded-[10px] bg-surface-raised p-5"
    style={{ boxShadow: 'var(--shadow-sm)' }}
  >
    <h2 className="mb-4 text-sm font-medium text-foreground">Financeiro</h2>
    <PropertyFinancialTab propertyId={propertyId} />
  </div>
)}
```

**d) Replace the sidebar with a status-aware block:**

```tsx
// Before:
<div
  className="rounded-[10px] bg-surface-raised p-5 self-start"
  style={{ boxShadow: 'var(--shadow-sm)' }}
>
  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
    Inquilino
  </h3>
  <TenantSidebar propertyId={propertyId} />
</div>

// After:
{property.status !== 'maintenance' && (
  <div
    className="rounded-[10px] bg-surface-raised p-5 self-start"
    style={{ boxShadow: 'var(--shadow-sm)' }}
  >
    {property.status === 'rented' ? (
      <>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Inquilino
        </h3>
        <TenantSidebar propertyId={propertyId} />
      </>
    ) : (
      <>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Leads ativos
        </h3>
        <LeadsSidebar propertyId={propertyId} />
      </>
    )}
  </div>
)}
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx
git commit -m "feat(web): property detail — financial tab, status-aware sidebar, conditional visit schedule"
```

---

### Task 3: Broaden invalidation in `edit.tsx`

**Files:**
- Modify: `apps/web/src/routes/_dashboard/properties/$propertyId/edit.tsx`

- [ ] **Step 1: Update `onSuccess` in the save mutation**

Find (around line 110):
```ts
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['properties'] });
  toast.success('Imóvel atualizado');
  navigate({ to: '/properties/$propertyId', params: { propertyId } });
},
```

Replace with:
```ts
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['properties'] });
  queryClient.invalidateQueries({ queryKey: ['property-tenant', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['property-payments', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['property-contract', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['property-leads', propertyId] });
  toast.success('Imóvel atualizado');
  navigate({ to: '/properties/$propertyId', params: { propertyId } });
},
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/_dashboard/properties/$propertyId/edit.tsx
git commit -m "fix(web): invalidate all property-related queries on edit save"
```

---

### Task 4: Fix seed — `visitSchedule` in update paths

**Files:**
- Modify: `apps/bot/prisma/seed.ts`

- [ ] **Step 1: Update KIT-01 `update` path**

Find:
```ts
update: { status: 'available', name: 'Kitnet no Retiro – Unid. 01' },
```

Replace with:
```ts
update: { status: 'available', name: 'Kitnet no Retiro – Unid. 01', visitSchedule: 'Segunda a sexta, 9h–17h.' },
```

- [ ] **Step 2: Update KIT-02 `update` path**

Find:
```ts
update: { status: 'available', name: 'Kitnet no Retiro – Unid. 02' },
```

Replace with:
```ts
update: { status: 'available', name: 'Kitnet no Retiro – Unid. 02', visitSchedule: 'Segunda a sexta, 9h–17h.' },
```

- [ ] **Step 3: Re-run seed**

```bash
cd apps/bot && bun run prisma db seed
```

Expected: output includes `Properties: KIT-01, KIT-02, KIT-03, KIT-04, KIT-05`

- [ ] **Step 4: Commit**

```bash
git add apps/bot/prisma/seed.ts
git commit -m "fix(seed): include visitSchedule in update paths for KIT-01 and KIT-02"
```
