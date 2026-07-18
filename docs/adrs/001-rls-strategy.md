# ADR 001 — Row Level Security Strategy

**Status:** Policies implementadas e verificadas (`20260717000001_rls_policies`) — desativadas até ativação em produção
**Data:** 2026-06-16

---

## Contexto

O sistema opera hoje em modo single-owner (um único `Owner` por instalação). O banco é acessado por dois clientes:

- **Bot** (`apps/bot`): conecta ao Postgres via `DATABASE_URL` (role dona das tabelas, `apps/bot/src/db/client.ts`) — bypassa RLS por ser table owner, não por usar `service_role`. `SUPABASE_SERVICE_KEY` é usado só para Supabase Storage (`apps/bot/src/services/storage.ts`), sem relação com RLS. Responsável por todas as escritas críticas.
- **Painel** (`apps/web`): usa `VITE_SUPABASE_ANON_KEY` com sessão autenticada (role `authenticated`) — leituras diretas via `supabase-js`.

RLS está atualmente **desabilitado** em todas as tabelas. Isso é seguro em single-owner com auth Supabase ativa (apenas o owner autenticado acessa o painel), mas precisa ser ativado antes de qualquer expansão de acesso.

---

## Decisão

Implementar policies de RLS baseadas em `ownerId` em todas as tabelas que possuem essa coluna. As políticas serão:

- **SELECT**: `auth.uid() = ownerId` (ou join via tabela com ownerId)
- **INSERT/UPDATE/DELETE**: bloqueados para role `authenticated` — todas as mutações passam pelo bot, que conecta como table owner (bypassa RLS independente da service_role)

O bot conecta ao Postgres como table owner (via `DATABASE_URL`), que bypassa RLS por padrão — não usa `service_role` para isso. Nenhuma alteração é necessária no código do bot.

**Nota (2026-07-17):** a policy `auth.uid()::text = "ownerId"` só funciona porque `Owner.id` já é idêntico ao `auth.users.id` do Supabase Auth correspondente (verificado em produção: `50ebce4b-e386-41aa-8b9f-bc2d8bb5996e` bate nos dois lados). Isso não é garantido pelo código de criação de Owner (`apps/bot/prisma/seed.ts` gera `Owner.id` via `@default(uuid())`, independente de qualquer auth UUID) — é o estado atual, não um invariante garantido. Ao criar owners futuros (fase 5, multi-tenant), o fluxo de signup precisa setar `Owner.id` = `auth.uid()` explicitamente, ou as policies deixam de bater silenciosamente.

As policies serão **criadas mas mantidas desativadas** até o início de f2b, quando serão habilitadas e testadas antes do deploy.

---

## Policies por tabela

### Tabelas com `ownerId` direto

| Tabela | SELECT policy |
|---|---|
| `Property` | `auth.uid()::text = "ownerId"` |
| `PropertyMedia` | `auth.uid()::text = "ownerId"` |
| `Lead` | `auth.uid()::text = "ownerId"` |
| `LeadResident` | `auth.uid()::text = "ownerId"` |
| `LeadDocument` | `auth.uid()::text = "ownerId"` |
| `Tenant` | `auth.uid()::text = "ownerId"` |
| `Payment` | `auth.uid()::text = "ownerId"` |
| `ActivityLog` | `auth.uid()::text = "ownerId"` |
| `Event` | `auth.uid()::text = "ownerId"` |
| `Conversation` | `auth.uid()::text = "ownerId"` |
| `RuleSet` | `auth.uid()::text = "ownerId"` |
| `ContractTemplate` | `auth.uid()::text = "ownerId"` |
| `Contract` | `auth.uid()::text = "ownerId"` |

### Tabelas sem `ownerId` direto (join necessário)

| Tabela | SELECT policy |
|---|---|
| `RuleSetPolicy` | `EXISTS (SELECT 1 FROM "RuleSet" r WHERE r.id = "ruleSetId" AND auth.uid()::text = r."ownerId")` |
| `PropertyRuleSet` | `EXISTS (SELECT 1 FROM "Property" p WHERE p.id = "propertyId" AND auth.uid()::text = p."ownerId")` |

### Tabela `Owner`

| Operação | Policy |
|---|---|
| SELECT | `auth.uid()::text = id` (owner só vê a si mesmo) |
| INSERT/UPDATE/DELETE | Bloqueado para `authenticated` |

---

## Mutations (INSERT/UPDATE/DELETE)

Todas as mutações do painel passam pelo bot via `POST/PATCH/DELETE /admin/...` com JWT no header. O bot conecta como table owner — bypassa RLS, sem depender de `service_role`. **Nenhuma policy de escrita é necessária para o painel.**

Se no futuro o painel passar a escrever diretamente (sem passar pelo bot), será necessário adicionar policies de INSERT/UPDATE com `auth.uid()::text = ownerId`.

---

## Consequências

### Antes de ativar RLS

As queries de leitura no web (`supabase-js`) **não precisam** de `.eq('ownerId', userId)` enquanto RLS estiver desabilitado. Mas para consistência e preparo, as queries críticas devem ser auditadas.

### Após ativar RLS (f2b)

1. Verificar que todas as queries do painel retornam dados corretamente (sem rows filtrados indesejadamente)
2. Testar com `anon` key e sessão autenticada
3. Testar que bot (table owner via `DATABASE_URL`) não é afetado
4. **Usar `ENABLE ROW LEVEL SECURITY`, nunca `FORCE ROW LEVEL SECURITY`** — `FORCE` também restringe o table owner, o que quebraria toda escrita do bot silenciosamente. `ENABLE` (usado neste projeto) preserva o bypass do owner.

### Multi-tenancy futuro (Fase 5)

Quando multi-tenancy for implementado, `ownerId` será substituído por `orgId`. As policies seguirão o mesmo padrão com `org_id` em vez de `ownerId`, via tabela `organization_members`.

---

## Alternativas consideradas

**Não ativar RLS** — rejeitado. Single-owner hoje não é garantia de amanhã. RLS é a camada de defesa em profundidade correta para um SaaS.

**RLS no bot também** — rejeitado. Bot conecta como table owner por design (precisa escrever em nome de qualquer owner) — não usa `service_role` para isso. Adicionar `FORCE ROW LEVEL SECURITY` ao bot quebraria a arquitetura sem benefício de segurança.
