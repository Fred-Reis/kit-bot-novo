# Spec: Leads (`/leads`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header
- Add **Filtros** button (stub → toast "Em breve")
- Add **+ Novo lead** button (stub → toast "Em breve" — leads arrive via WhatsApp only)
- Toggle label: "Kanban / Tabela" (current: "Kanban / Tabela" ✓ — verify label matches design "Kanban" not "Kanban")

### Kanban Column Labels
Current labels differ from design:

| Current | Target |
|---|---|
| Novo | Novo |
| Qualificando | Qualificação |
| Visitando | Visita agendada |
| Proposta | Proposta |
| Convertido | Ganho |

### Kanban Card
Design shows much richer card than current (phone + stage label):

- Lead **name** (not phone number) — fallback to phone if name absent
- Lead external ID (`LD-2301`) in muted mono
- Property reference (`IM-0413`) — the property the lead is interested in
- Lead **source** chip (ZAP / Site / Instagram / Indicação)
- Relative time right-aligned

### Table View
- Add lead name column (fallback to phone)
- Add source column
- Add property column

---

## Missing Features

- Lead source tracking (how lead arrived: ZAP, Site, Instagram, Indicação)
- Lead name capture (currently only phone)
- Link between lead and a specific property of interest

---

## Backend Requirements

### Schema
```sql
alter table leads
  add column name text,
  add column source text check (source in ('whatsapp', 'site', 'instagram', 'indicacao', 'zap', 'other')),
  add column property_id uuid references properties(id);
```

### Queries (`lib/queries.ts`)
- Update `fetchLeads()` to include `name`, `source`, `propertyId` in select

### Bot API (`apps/bot`)
- Capture `source` at lead creation (infer from Evolution API instance or first message context)
- Expose `name` once collected during qualification flow
- `PATCH /admin/leads/:id` — allow updating `name`, `source`, `propertyId` from admin panel
