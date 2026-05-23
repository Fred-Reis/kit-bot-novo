# Spec: Dashboard (`/`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header Controls
- Add month date chip ("abr - 2026") — display current month
- Add **Exportar** button (stub → toast "Em breve")

### KPI Cards
- Labels differ from design — change to: **A RECEBER (MÊS)** / **RECEBIDO** / **EM ATRASO** / **LEADS ATIVOS**
- Add delta % under value (e.g. `+4% vs mar`) from previous-month comparison
- Add subtext line: "14 boletos", "84.5% do previsto", "3 inquilinos"
- Add functional graph and charts with real data

### Ocupação por empreendimento
- Add time filter toggle: **30d / 90d / 12m** (UI-only initially)
- Show unit count per row ("12 unidades", "8 unidades")
- Property name must not truncate — allow wrap or tooltip

### Próximos vencimentos
- Show tenant **name**, not raw `tenantId` slice
- Add status pill: `prio` (due ≤ 3 days) or `atraso` (overdue)
- Sub-text: "vence em 2 dias" / "em atraso · 4 dias"

### Atividade recente
- Current feed shows only leads. Design shows actor + action + subject:
  - "Clara aprovou proposta de Daniela Reis"
  - "Sistema gerou boleto para IQ-102 - Tiago Bernardes"
  - "Clara publicou imóvel IM-0413"
- Requires `activity_log` table (see backend)

---

## Missing Features

- Month-over-month KPI delta calculation
- Time-filtered occupancy view (30d / 90d / 12m)
- Rich activity feed with actor, action type, and linked subject

---

## Backend Requirements

### Schema
```sql
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  actor text,           -- user display name or "Sistema"
  action text,          -- "aprovou proposta", "publicou imóvel", "gerou boleto"
  subject text,         -- display label e.g. "Daniela Reis", "IM-0413"
  subject_id uuid,
  subject_type text,    -- "lead" | "property" | "tenant" | "payment"
  created_at timestamptz default now()
);
```

### Queries (`lib/queries.ts`)
- `fetchActivityLog(limit?: number)` — ordered by `created_at desc`
- `fetchPaymentsSummary()` — returns `{ monthRevenue, prevMonthRevenue, overdueAmount, overdueCount, pendingCount, receivedAmount }` for KPI deltas

### Bot API (`apps/bot`)
- Write to `activity_log` on: KYC approved, contract generated, payment confirmed, property published
- `GET /admin/dashboard/summary` — single aggregated endpoint to avoid N frontend queries
