# Spec: Contratos (`/contracts`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header
- Add **+ Novo contrato** button (stub → modal or route)

### Table Columns
Design column order differs from current:

| Design | Current | Gap |
|---|---|---|
| CONTRATO (code) | ✓ Nº | — |
| IMÓVEL | ✓ present | show property name, not ID |
| INQUILINO | ✓ present | show full name |
| VIGÊNCIA | split as Início / Fim | merge as range: "03/2024 → 03/2027" |
| VALOR | **missing** | monthly rent amount |
| STATUS | ✓ present | add **Renovação** (amber) alongside Ativo / Encerrado |

### Status Values
- **Ativo** → green pill
- **Renovação** → amber pill (contract expiring within 60 days and not yet renewed)
- **Encerrado** → default/grey pill

### Data
- All rows are static mock data — replace with real DB data

### Download Action
- Download icon exists but calls `console.warn('TODO')` — wire to real PDF or stub toast

---

## Missing Features

- Real contract records from DB (currently all static mock)
- Contracts generated from contract templates (link to Templates page)
- "Novo contrato" flow — select tenant + property + template → generate contract
- Renovação status computed from contract end date proximity
- PDF download / preview

---

## Backend Requirements

### Schema
```sql
create table contracts (
  id uuid primary key default gen_random_uuid(),
  code text unique,                    -- CT-2024-0421
  tenant_id uuid references tenants(id),
  property_id uuid references properties(id),
  template_id uuid references contract_templates(id),
  body text,                           -- rendered contract text
  rent numeric not null,
  start_date date not null,
  end_date date,
  status text check (status in ('active', 'renewal', 'closed')) default 'active',
  signed_at timestamptz,
  created_at timestamptz default now()
);
```

### Queries (`lib/queries.ts`)
- `fetchContracts()` — join tenants + properties, return `{ id, code, tenantName, propertyName, propertyExternalId, rent, startDate, endDate, status }`
- `fetchContract(id)` — full contract with body text

### Bot API (`apps/bot`)
- `GET /admin/contracts` — list
- `POST /admin/contracts` — create from template (renders body with variable substitution)
- `PATCH /admin/contracts/:id/status` — update status (close, renew)
- `GET /admin/contracts/:id/pdf` — generate PDF (future; stub initially)
