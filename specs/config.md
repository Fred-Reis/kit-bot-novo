# Spec: Configurações (`/config`)

> Tracks only what is missing or broken vs the target design.

---

## UI Gaps

### Layout
- Current: 2-column card grid
- Target: **left sidebar navigation** (fixed ~220px) + right content panel
- Sidebar items: Workspace | Equipe & permissões | Plano & cobrança | Integrações | Notificações | Aparência | Segurança

### Workspace Section (active by default)
Current page has no Workspace section. Design shows right panel with read-only fields:

- Nome da empresa
- CNPJ
- Domínio
- Idioma padrão
- Moeda
- Fuso horário

All editable eventually; display-only initially.

### Equipe & permissões Section
- **Missing entirely**
- List of users with access to the organization
- Roles: Admin / Gestor / Visualizador
- Invite by email
- Remove user

### Plano & cobrança Section
- **Missing entirely** — future/SaaS concern; stub with "Em breve"

### Integrações Section
- **Missing entirely**
- WhatsApp / Evolution API connection status + config fields
- Currently these fields live in "Bot WhatsApp" card — move here

### Notificações Section
- Current: two toggles (Notificações ativas / Atualização automática) inside a card
- Move to dedicated section in sidebar layout

### Aparência Section
- Current: dark mode toggle + language select inside a card
- Move to dedicated section; keep same functionality

### Segurança Section
- **Missing entirely** — stub with change password form (future)

### Sections to Remove
- Current "Conta" card (name + email form) — merge into Workspace section
- Current "Bot WhatsApp" card — move into Integrações section

---

## Missing Features

- Sidebar navigation with active section state
- Workspace data (org name, CNPJ, etc.) — persisted to DB
- Team management (invite, list, remove, assign role) — requires multi-tenancy schema
- Integrations management (Evolution API URL + instance)

---

## Backend Requirements

### Schema
```sql
-- Organization (foundation for multi-tenancy — in Roadmap, but referenced here)
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text,
  domain text,
  language text default 'pt-BR',
  currency text default 'BRL',
  timezone text default 'America/Sao_Paulo',
  created_at timestamptz default now()
);

create table organization_members (
  org_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text check (role in ('admin', 'manager', 'viewer')) default 'viewer',
  invited_at timestamptz default now(),
  primary key (org_id, user_id)
);
```

### Queries (`lib/queries.ts`)
- `fetchOrganization()` — current org settings
- `fetchOrgMembers()` — list of members with role

### Bot API (`apps/bot`)
- `PATCH /admin/organization` — update workspace settings (name, CNPJ, domain, language, currency, timezone)
- `POST /admin/organization/members` — invite user by email
- `DELETE /admin/organization/members/:userId` — remove member
- `PATCH /admin/organization/members/:userId` — update role
