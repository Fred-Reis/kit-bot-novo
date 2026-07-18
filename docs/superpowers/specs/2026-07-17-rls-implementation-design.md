# RLS — implementar policies (F0.3)

> Data: 2026-07-17
> Origem: ROADMAP.md F0.3 / "Próximas prioridades" #1 — único item bloqueante antes de operar com dados reais de terceiros
> Contexto: `docs/adrs/001-rls-strategy.md` (2026-06-16) já documenta a estratégia; falta implementação SQL.

## Problema

RLS está desabilitado em todas as tabelas. Hoje isso é seguro (single-owner, único acesso autenticado é o próprio Fred), mas antes de operar com dados reais de terceiros (outros owners/tenants no painel) precisa haver defesa em profundidade: se o painel (`apps/web`, via `supabase-js` com sessão `authenticated`) tiver algum bug de filtro por `ownerId`, RLS impede vazamento cross-owner no nível do banco.

## Descoberta que invalidava a premissa do ADR (resolvida)

O ADR assume policies `auth.uid()::text = "ownerId"`. Isso só funciona se `Owner.id` (Postgres) for literalmente igual ao `auth.users.id` do Supabase Auth correspondente. Investigação inicial (seed script `apps/bot/prisma/seed.ts` gera `Owner.id` via `@default(uuid())` independente; guard de login em `apps/web/src/routes/__root.tsx` casa por **email**, não por id) sugeria que os dois UUIDs eram independentes — o que quebraria toda leitura `authenticated` assim que RLS fosse ligado.

Verificação direta no banco (`prisma.owner.findMany`) mostrou que o `Owner.id` de produção já é `50ebce4b-e386-41aa-8b9f-bc2d8bb5996e` — idêntico ao UUID do usuário `fred.rlopes@gmail.com` no Supabase Auth (confirmado pelo usuário via Dashboard). Ou seja, **já estão alinhados** na prática, por algum caminho anterior não capturado no seed script. Não há necessidade de migration de realinhamento de PK/FK.

**Implicação:** nenhuma mudança de dado é necessária. O trabalho se resume a criar as policies SQL e testar.

## Escopo

1. Migration Prisma criando as policies de SELECT (ADR + correção abaixo), **sem habilitar RLS** (`ENABLE ROW LEVEL SECURITY` fica fora desta entrega).
2. Correção de gap do ADR: tabela `LeadResident` (adicionada em jul/2026, depois do ADR) tem `ownerId` direto e não está na lista original — entra nesta migration.
3. Roteiro de teste manual (SQL, no mesmo banco — não há Supabase staging separado hoje): leitura como `authenticated`, escrita via bot/Prisma.
4. Atualizar `docs/adrs/001-rls-strategy.md` (status, tabela `LeadResident`, nota sobre `Owner.id` já alinhado) e `ROADMAP.md` F0.3.

**Fora de escopo:**
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` — ativação real. Fica para quando Fred autorizar ir a produção com dados de terceiros (mesmo espírito do cutover gated do `LEAD_FLOW_V2`). Feito como PR/migration separada, curta, quando chegar a hora.
- Mudanças de código no bot — confirmado que Prisma conecta via `DATABASE_URL`/role `postgres` (não `service_role`), que é owner das tabelas e bypassa RLS por padrão independente do estado das policies.
- INSERT/UPDATE/DELETE policies para `authenticated` — ADR já decidiu que o painel nunca escreve direto no banco (sempre via bot `/admin/...`), então ausência de policy de escrita = bloqueio total para `authenticated`, que é o comportamento desejado.

## Migration — policies (RLS desligado)

Nova migration `apps/bot/prisma/migrations/20260717000001_rls_policies/migration.sql`.

Padrão por tabela com `ownerId` direto:

```sql
CREATE POLICY "select_own_rows" ON "Property"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = "ownerId");
```

Tabelas: `Property`, `PropertyMedia`, `Lead`, `LeadDocument`, `LeadResident`, `Tenant`, `Payment`, `ActivityLog`, `Event`, `Conversation`, `RuleSet`, `ContractTemplate`, `Contract`.

Tabelas sem `ownerId` direto (join via EXISTS):

```sql
CREATE POLICY "select_own_rows" ON "RuleSetPolicy"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "RuleSet" r WHERE r.id = "ruleSetId" AND auth.uid()::text = r."ownerId"
  ));

CREATE POLICY "select_own_rows" ON "PropertyRuleSet"
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "Property" p WHERE p.id = "propertyId" AND auth.uid()::text = p."ownerId"
  ));
```

`Owner` (self apenas):

```sql
CREATE POLICY "select_self" ON "Owner"
  FOR SELECT TO authenticated
  USING (auth.uid()::text = id);
```

Nenhum `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nesta migration — `CREATE POLICY` não tem efeito em tabela sem RLS habilitado, então isso é seguro de aplicar em produção imediatamente (zero mudança de comportamento observável).

## Teste

Sem Supabase staging separado — mesmo banco de dev/prod. Testes rodam em transação com `ROLLBACK`, sem persistir nada:

**1. Leitura como `authenticated` (antes de habilitar RLS, valida só a sintaxe/lógica das policies):**

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"50ebce4b-e386-41aa-8b9f-bc2d8bb5996e"}';
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY temporário, só dentro desta transação
SELECT count(*) FROM "Property";  -- deve bater com total real (Fred é o único owner)
ROLLBACK;
```

Repetir para as tabelas com join (`RuleSetPolicy`, `PropertyRuleSet`) e para `Owner`.

**2. Escrita via bot/Prisma continua funcionando com RLS habilitado (dentro da mesma transação de teste):**

Confirmar que `INSERT`/`UPDATE` via role `postgres` (a role real do `DATABASE_URL`) não é afetado por `ENABLE ROW LEVEL SECURITY` — validação de que o bot bypassa como table owner, não como `service_role` (que é usado só pelo Storage, não pelo Prisma).

## Docs a atualizar

- `docs/adrs/001-rls-strategy.md`: status → "Policies criadas (desativadas) — ativação pendente"; adicionar `LeadResident` à tabela; nota sobre `Owner.id` já alinhado com `auth.uid()` (achado desta sessão, não fruto de migration).
- `ROADMAP.md` F0.3: marcar "Implementar policies" e "Testar leitura/escrita" como feitos; manter "ativar antes de produção" pendente, com nota apontando a migration de ativação futura.
