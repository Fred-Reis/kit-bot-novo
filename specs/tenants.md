# Spec: Inquilinos (`/tenants`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header
- Add **Filtros** button (stub → toast "Em breve")

### Table Columns
Design column order differs from current:

| Design | Current | Gap |
|---|---|---|
| NOME (avatar + name + ID) | ✓ present | — |
| IMÓVEL | missing | show property name, not propertyId |
| DIA DE VENCIMENTO | ✓ present | — |
| PAGAMENTOS EM DIA | ✓ present (progress bar) | — |
| PONTUAÇÃO | ✓ present (ScoreBar) | — |
| STATUS | **missing** | "Em dia" (green) / "Atenção" (amber) pill |

### STATUS Column Logic
- **Em dia**: `onTimeRate >= 80` or no overdue payments
- **Atenção**: `onTimeRate < 80` or has overdue payment this month

### Tenant ID
- Design shows tenant code (`IQ-102`) next to name in muted mono
- Map to `externalId` field or generate from sequence

### Cards View
- Show IMÓVEL name (not propertyId)
- Add STATUS pill

---

## Missing Features

- Tenant status classification (Em dia / Atenção) — computed from payment history
- Tenant external ID (`IQ-XXX` format) for display

---

## Backend Requirements

### Schema
```sql
alter table tenants
  add column external_id text unique,   -- IQ-{sequence}
  add column status text generated always as (
    case when on_time_rate >= 80 then 'ok' else 'attention' end
  ) stored;                              -- or compute in query
```

### Queries (`lib/queries.ts`)
- Update `fetchTenants()` to join `properties` and return `propertyName`
- Include `externalId` and computed `status` in projection
- `fetchTenant(id)` — already returns real data; add `propertyName` join

### Bot API (`apps/bot`)
- `POST /admin/tenants` — auto-generate `externalId` as `IQ-{sequence}` on create
- Add `externalId` to tenant response payload
