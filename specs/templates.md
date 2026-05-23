# Spec: Templates de contrato (`/templates`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Header
- Add **Importar .docx** button (stub → toast "Em breve")
- Rename "Novo template" CTA — already present ✓

### Template List (left panel)
Current list shows WhatsApp message templates. Design shows **contract templates**:

- Status pill: **Publ.** (green) / **Rasc.** (amber) per template
- Template code: `CT-AA-01`, `CT-AA-02` etc.
- Metadata line: "em uso · 24 · atualizado 08 abr"
- Current: no status pill, no code, no metadata

### Editor Panel (right panel)
- Template **code** shown next to name (`CT-AA-01`)
- **Pré-visualizar** button next to Salvar
- **Variables chips row** at top of editor: `{{locador}}` `{{locatario}}` `{{imovel.endereco}}` `{{aluguel}}` `{{prazo}}` `{{reajuste}}` `{{vencimento}}` — clickable to insert at cursor
- Editor area: editable rich text (not readonly preview) with `{{variable}}` highlighted in accent color
- Contract body: clause structure (Cláusula 1ª — Do objeto, Cláusula 2ª — Do valor e prazo, etc.)

### Concept Change
Current templates are **WhatsApp bot message templates**. Design shows **contract document templates** (legal text with variables). These are different entities — both may be needed but this page should show contract templates.

---

## Missing Features

- Contract template concept distinct from WhatsApp message templates
- Template status (published / draft)
- Template code (`CT-AA-01`) auto-generated
- Variable chips as interactive insert buttons
- "em uso" count — how many active contracts use each template
- Importar .docx — parse a Word document and extract text + variables

---

## Backend Requirements

### Schema
```sql
create table contract_templates (
  id uuid primary key default gen_random_uuid(),
  code text unique,                -- CT-AA-01, CT-AA-02 etc.
  name text not null,
  body text not null,              -- full contract text with {{variable}} placeholders
  status text check (status in ('draft', 'published')) default 'draft',
  usage_count int default 0,       -- how many contracts reference this template
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Queries (`lib/queries.ts`)
- `fetchContractTemplates()` — list with `id, code, name, status, usageCount, updatedAt`
- `fetchContractTemplate(id)` — full template including `body`

### Bot API (`apps/bot`)
- `GET /admin/contract-templates` — list all
- `POST /admin/contract-templates` — create (auto-generate `code`)
- `PATCH /admin/contract-templates/:id` — update body, name, status
- `DELETE /admin/contract-templates/:id` — only if `usageCount === 0`
