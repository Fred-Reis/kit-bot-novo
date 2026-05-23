# Spec: Regras de locação (`/rules`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Tab Labels
Current tabs are completely wrong:

| Current | Target |
|---|---|
| Políticas | Políticas |
| Financeiro | Blocos reutilizáveis |
| Documentos | Templates completos |
| Visitas | Campos estruturados |

### Políticas Tab — Left Panel
Design shows a structured policy editor, not simple cards:

- Section title: "Políticas — Premium residencial" with subtitle description
- Each policy row has:
  - Policy name + description text
  - **Sim / Não / Cond.** button group (3-way toggle)
  - **"Aplica ao imóvel"** toggle switch
- Current: plain cards with title + detail text only

### Políticas Tab — Right Panel ("Reuso")
Current right sidebar shows policy reuse count. Design shows:

- Section title: **Reuso**
- Description text: "Controle quais políticas se propagam quando você duplica ou aplica esta regra em novos imóveis."
- Toggle rows: **Propagar políticas** / **Propagar cláusulas** / **Propagar campos**
- **Em uso** section: chips of property IDs using this rule set (`IM-0421`, `IM-0376`, `IM-0381`)

### Other Tabs (Blocos reutilizáveis, Templates completos, Campos estruturados)
- Currently show "Em construção." placeholder — acceptable for now

---

## Missing Features

- Policy rule sets (a named group of policies) — currently policies are global/flat
- 3-way policy value (Sim / Não / Cond.)
- Per-policy "Aplica ao imóvel" toggle
- Propagation settings per rule set
- "Em uso" — which properties use each rule set

---

## Backend Requirements

### Schema
```sql
create table rule_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  propagate_policies boolean default true,
  propagate_clauses boolean default true,
  propagate_fields boolean default false,
  created_at timestamptz default now()
);

create table rule_set_policies (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid references rule_sets(id) on delete cascade,
  name text not null,
  description text,
  value text check (value in ('yes', 'no', 'conditional')) default 'no',
  applies_to_property boolean default true
);

create table property_rule_sets (
  property_id uuid references properties(id) on delete cascade,
  rule_set_id uuid references rule_sets(id) on delete cascade,
  primary key (property_id, rule_set_id)
);
```

### Queries (`lib/queries.ts`)
- `fetchRuleSets()` — all rule sets with policy count
- `fetchRuleSet(id)` — rule set + policies + linked property IDs

### Bot API (`apps/bot`)
- `POST /admin/rule-sets` — create rule set
- `PATCH /admin/rule-sets/:id` — update propagation settings
- `POST /admin/rule-sets/:id/policies` — add policy
- `PATCH /admin/rule-sets/:id/policies/:policyId` — update value / applies toggle
- `POST /admin/rule-sets/:id/properties` — link property to rule set
