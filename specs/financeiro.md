# Spec: Financeiro (`/finance`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header
- Add month date chip ("abr - 2026")
- Add **Exportar** button (stub → toast "Em breve")
- Add **+ Novo lançamento** button (stub → toast "Em breve")

### KPI Cards
Current labels are wrong. Target:

| Target Label | Subtext | Current |
|---|---|---|
| A RECEBER (MÊS) | "14 boletos" | "Receita mensal" |
| RECEBIDO | "84.5% do previsto" | "Inadimplência" |
| EM ATRASO | "3 inquilinos" | "A receber (30d)" |
| A REPASSAR | "para 16 proprietários" | "Média por imóvel" |

- KPI cards in finance page should NOT use the sparkline `KpiCard` component — design shows plain metric cards with subtext only

### Tab Labels
Current tabs are wrong:

| Current | Target |
|---|---|
| Visão geral | Visão geral |
| Receitas | À receber |
| Despesas | Repasses |
| Relatórios | Relatórios |

### Visão Geral Tab — Chart
- Chart title: "Receita x Inadimplência" with subtitle "últimos 6 meses"
- Design shows **dual-series bar chart**: tall orange bars (Receita) + small red bars (Inadimplência) side by side per month
- Current: single-series bars, static heights, no legend
- Add legend: "■ Receita  ■ Inadimplência"

### Visão Geral Tab — Últimos movimentos Table
- **Missing entirely** — design shows a transactions table below the chart:
  - Columns: DATA | DESCRIÇÃO | INQUILINO | TIPO | VALOR | STATUS
  - TIPO: "entrada" (green chip) / "saída" (red chip)
  - STATUS: "Pago" / "Enviado" / "Atraso"
  - Example rows: "Aluguel abr/26 · Tiago Bernardes · entrada · R$9.800 · Pago"

### À receber Tab
- Currently "Em construção." — implement list of pending/overdue payments with tenant + due date + amount

### Repasses Tab
- Currently "Em construção." — implement list of owner disbursements (future feature)

---

## Missing Features

- Real payment data driving all KPI cards
- Dual-series chart from real Payment rows grouped by month
- "Últimos movimentos" transactions table from Payment rows
- À receber tab: filterable list of pending payments
- Repasses tab: owner disbursement tracking (requires new concept in schema)

---

## Backend Requirements

### Schema
- `payments` table already exists with `status`, `amount`, `month`, `tenantId`
- Add `description text` column to `payments` for movement label ("Aluguel abr/26")
- Add `type text check (type in ('income', 'expense'))` — most are income; expenses (vistoria fee etc.) need to be trackable

### Queries (`lib/queries.ts`)
- `fetchFinanceSummary()` — returns `{ toReceiveMonth, toReceiveCount, received, receivedPct, overdueAmount, overdueCount, toDisburse }`
- `fetchMonthlyTotals(months: number)` — returns `[{ month, revenue, overdue }]` for chart
- `fetchRecentTransactions(limit?: number)` — ordered by payment date, includes tenant name + description

### Bot API (`apps/bot`)
- No new endpoints needed immediately — all data from Payment table via Supabase direct reads
- Future: `POST /admin/payments` — manual payment entry for "Novo lançamento"
