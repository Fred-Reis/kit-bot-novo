# Property Detail Refinements

**Date:** 2026-06-16  
**Status:** Approved  
**Scope:** `apps/web` — property detail page, tenant sidebar, seed

---

## Problem Summary

Six issues found in the property detail page (`$propertyId/index.tsx`):

| # | Issue | Root Cause |
|---|---|---|
| 1 | "Histórico" tab shows noisy ActivityLog | Wrong data source — should show payments + contract |
| 2 | Rent due date missing from property detail | `dueDay` not selected in `fetchPropertyTenant` |
| 3 | `visitSchedule` shown on rented properties | No `property.status` conditional |
| 4 | `visitSchedule` null on existing properties | Seed `update` path omits the field |
| 5 | Sidebar shows generic "Sem inquilino" on available | No leads context for available properties |
| 6 | Query invalidation too narrow | Tenant/payment/lead queries not invalidated on property change |

---

## Design

### 1. Aba "Financeiro" (replaces "Histórico")

**Tab renamed:** `history` → `financial`, label "Histórico" → "Financeiro"

**Remove:**
- `PropertyHistoryTab` component
- `fetchPropertyActivityLog` query function
- `queryKey: ['property-activity', propertyId]`

**Add:**
- `fetchPropertyContract(propertyId: string)` — queries `Contract` where `propertyId = id` and `status = 'active'`, returns single or null
- `fetchPropertyPayments(propertyId: string)` — queries `Payment` where `propertyId = id`, ordered by `month desc`, limit 12
- `PropertyFinancialTab` component:
  - **Contract card** (top): tenant name, monthly rent, contract end date, status badge: green "Ativo" when >60 days remaining, yellow "Vence em X dias" when ≤60 days, red "Vencido" when past end date. Hidden when no active contract.
  - **Payment list**: one row per payment — month, amount (mono), status pill (Pago/Pendente/Atrasado). EmptyState when no payments.
  - Query keys: `['property-contract', propertyId]` and `['property-payments', propertyId]`

### 2. Property Sidebar — status-aware

**When `status === 'rented'`:**
- Keep existing `TenantSidebar`
- Add `dueDay` to `fetchPropertyTenant` select: `id, name, phone, onTimeRate, dueDay`
- Update `PropertyTenantSummary` interface in `queries.ts` to add `dueDay: number | null`
- Display "Vencimento: dia X" below the pontualidade status

**When `status === 'available'`:**
- New `LeadsSidebar` component
- `fetchPropertyLeads(propertyId)` — queries `Lead` where `propertyId = id` and `stage NOT IN ('lost', 'converted')`, ordered by `updatedAt desc`
- Displays compact list: lead name + stage pill
- If no leads: hide sidebar entirely (no empty block)

**When `status === 'maintenance'`:**
- Hide sidebar entirely

### 3. `visitSchedule` — conditional display

In the Details tab `InfoRow`, wrap the `visitSchedule` row:
```tsx
{property.status === 'available' && property.visitSchedule && (
  <InfoRow label="Visita" value={property.visitSchedule} />
)}
```

### 4. Seed fix

For `p1` and `p2` (KIT-01, KIT-02 — available), add `visitSchedule` to the `update` path:
```ts
update: { status: 'available', name: '...', visitSchedule: 'Segunda a sexta, 9h–17h.' }
```

### 5. Query invalidation

Anywhere a property mutation succeeds (cache invalidation button in `$propertyId/index.tsx`, save in `edit.tsx`), invalidate:
```ts
void qc.invalidateQueries({ queryKey: ['property', propertyId] });
void qc.invalidateQueries({ queryKey: ['property-tenant', propertyId] });
void qc.invalidateQueries({ queryKey: ['property-payments', propertyId] });
void qc.invalidateQueries({ queryKey: ['property-contract', propertyId] });
void qc.invalidateQueries({ queryKey: ['property-leads', propertyId] });
```

---

## Files Affected

| File | Change |
|---|---|
| `apps/web/src/routes/_dashboard/properties/$propertyId/index.tsx` | Main page — all changes |
| `apps/web/src/lib/queries.ts` | Add `fetchPropertyContract`, `fetchPropertyPayments`, `fetchPropertyLeads`; update `fetchPropertyTenant` to include `dueDay` |
| `apps/web/src/routes/_dashboard/properties/$propertyId/edit.tsx` | Add query invalidation on save |
| `apps/bot/prisma/seed.ts` | Add `visitSchedule` to `update` paths for KIT-01 and KIT-02 |

---

## Out of Scope

- Timeline unifying ActivityLog + payments + lead events (Approach C — deferred)
- ActivityLog on property page removed entirely (not replaced, not reused elsewhere)
- No schema changes
