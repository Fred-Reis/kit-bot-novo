# ADR 001 — Row Level Security Strategy

**Status:** Documentado — implementação SQL pendente (f2b)
**Data:** 2026-06-16

---

## Contexto

O sistema opera hoje em modo single-owner (um único `Owner` por instalação). O banco é acessado por dois clientes:

- **Bot** (`apps/bot`): usa `SUPABASE_SERVICE_KEY` (service role) — bypassa RLS por design. Responsável por todas as escritas críticas.
- **Painel** (`apps/web`): usa `VITE_SUPABASE_ANON_KEY` com sessão autenticada (role `authenticated`) — leituras diretas via `supabase-js`.

RLS está atualmente **desabilitado** em todas as tabelas. Isso é seguro em single-owner com auth Supabase ativa (apenas o owner autenticado acessa o painel), mas precisa ser ativado antes de qualquer expansão de acesso.

---

## Decisão

Implementar policies de RLS baseadas em `ownerId` em todas as tabelas que possuem essa coluna. As políticas serão:

- **SELECT**: `auth.uid() = ownerId` (ou join via tabela com ownerId)
- **INSERT/UPDATE/DELETE**: bloqueados para role `authenticated` — todas as mutações passam pelo bot via service role

O bot usa `service_role` que bypassa RLS, então nenhuma alteração é necessária no código do bot.

As policies serão **criadas mas mantidas desativadas** até o início de f2b, quando serão habilitadas e testadas antes do deploy.

---

## Policies por tabela

### Tabelas com `ownerId` direto

| Tabela | SELECT policy |
|---|---|
| `Property` | `auth.uid()::text = "ownerId"` |
| `PropertyMedia` | `auth.uid()::text = "ownerId"` |
| `Lead` | `auth.uid()::text = "ownerId"` |
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

Todas as mutações do painel passam pelo bot via `POST/PATCH/DELETE /admin/...` com JWT no header. O bot usa `service_role` — bypassa RLS. **Nenhuma policy de escrita é necessária para o painel.**

Se no futuro o painel passar a escrever diretamente (sem passar pelo bot), será necessário adicionar policies de INSERT/UPDATE com `auth.uid()::text = ownerId`.

---

## Consequências

### Antes de ativar RLS

As queries de leitura no web (`supabase-js`) **não precisam** de `.eq('ownerId', userId)` enquanto RLS estiver desabilitado. Mas para consistência e preparo, as queries críticas devem ser auditadas.

### Após ativar RLS (f2b)

1. Verificar que todas as queries do painel retornam dados corretamente (sem rows filtrados indesejadamente)
2. Testar com `anon` key e sessão autenticada
3. Testar que bot (service role) não é afetado

### Multi-tenancy futuro (Fase 5)

Quando multi-tenancy for implementado, `ownerId` será substituído por `orgId`. As policies seguirão o mesmo padrão com `org_id` em vez de `ownerId`, via tabela `organization_members`.

---

## Alternativas consideradas

**Não ativar RLS** — rejeitado. Single-owner hoje não é garantia de amanhã. RLS é a camada de defesa em profundidade correta para um SaaS.

**RLS no bot também** — rejeitado. Bot usa service role por design (precisa escrever em nome de qualquer owner). Adicionar RLS ao bot quebraria a arquitetura sem benefício de segurança.
