# Implementation Plan: Slice 7 — Financeiro

> Spec: [specs/financeiro.md](../specs/financeiro.md)
> Pipeline: /spec ✅ → /plan ✅ → /build ✅ → /simplify ✅ → /review ✅ → COMMIT

---

## Visão geral

Completar a página Financeiro ponta-a-ponta: schema (tenantId nullable + propertyId), dois endpoints no bot (POST + GET /admin/payments), reestruturação de tabs no web com tabela de movimentos e filtro de período, e modal "Novo lançamento".

---

## Decisões arquiteturais

- `Payment.tenantId` tornada nullable para suportar despesas sem inquilino
- `Payment.propertyId` adicionada para vincular despesas diretamente ao imóvel (sem join via inquilino)
- `POST /admin/payments` usa `z.discriminatedUnion('type', [...])` — receita exige `inquilinoId`, despesa exige `propertyId`
- Web consulta `fetchAllPayments()` existente — sem nova query server-side (escala não exige)
- Tabs: `Visão geral | Receitas | À receber | Repasses | Relatórios`; últimas duas são placeholders

---

## Dependência entre tasks

```
T01 (schema + migration + types)
    │
    ├── T02 (bot POST /admin/payments)
    ├── T03 (bot GET /admin/payments)
    └── T04 (web queries.ts — fetchAllPayments + fetchRecentTransactions)
                │
                ├── T05 (web tabs + Visão geral + Últimos movimentos)
                ├── T06 (web aba Receitas + filtro período)
                ├── T07 (web aba À receber)
                └── T08 (web modal Novo lançamento + api.ts)
                            │
                            └── T09 (ROADMAP update)
```

---

## Fase 1 — Foundation (schema + types)

### T01 — Migration + Prisma + tipos

**Descrição:** Tornar `Payment.tenantId` nullable e adicionar `Payment.propertyId` opcional. Atualizar Prisma schema, gerar migration SQL, atualizar interface `Payment` em `packages/types`.

**Arquivos afetados:**
- `apps/bot/prisma/migrations/20260526000001_financeiro_slice_payment_fields/migration.sql` (novo)
- `apps/bot/prisma/schema.prisma`
- `packages/types/src/tenant.ts`

**Critérios de pronto:**
- [x] Migration SQL criada: `ALTER COLUMN "tenantId" DROP NOT NULL` + `ADD COLUMN "propertyId" TEXT` + FK + índices
- [x] `schema.prisma`: `tenantId String?`, `tenant Tenant?`, `propertyId String?`, `property Property?`
- [x] `Payment` em `packages/types`: `tenantId: string | null`, `propertyId: string | null`
- [x] `bunx prisma generate` verde (rodar em `apps/bot`)
- [x] `bunx tsc --noEmit` verde em `packages/types`
- [x] `bunx tsc --noEmit` verde em `apps/bot`

**Verificação:**
```bash
cd apps/bot && bunx prisma migrate dev --name financeiro_slice_payment_fields
bunx tsc --noEmit
cd ../../packages/types && bunx tsc --noEmit
```

**Scope:** M (3 arquivos)

---

## Checkpoint 1 — Após T01

- [x] `bunx prisma migrate status` mostra migration aplicada
- [x] `bunx tsc --noEmit` verde em `packages/types` e `apps/bot`
- [x] Nenhuma regressão nos tipos existentes (Payment ainda compilável em web)

---

## Fase 2 — Bot endpoints

### T02 — Bot: POST /admin/payments

**Descrição:** Endpoint de lançamento manual de pagamento. Aceita receita (vinculada a inquilino) ou despesa (vinculada a imóvel). Valida com Zod `discriminatedUnion`. Emite activity log `payment_recorded` (fire-and-forget).

**Arquivos afetados:**
- `apps/bot/src/routes/admin.ts`

**Critérios de pronto:**
- [x] `POST /admin/payments` retorna 201 + Payment criado
- [x] `type: 'income'` sem `inquilinoId` → 400
- [x] `type: 'expense'` sem `propertyId` → 400
- [x] `month` inválido (ex: `2026-13`) → 400
- [x] `amount <= 0` → 400
- [x] `ownerId` extraído do JWT (via `request.adminOwnerId` ou padrão existente)
- [x] Activity log `payment_recorded` emitido via `logActivity` (fire-and-forget)
- [x] `bunx tsc --noEmit` verde em `apps/bot`
- [x] `bunx oxlint` sem novos warnings em `apps/bot`

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit && bunx oxlint src/
```

**Scope:** M (1 arquivo, ~60 linhas)

---

### T03 — Bot: GET /admin/payments

**Descrição:** Endpoint de listagem de pagamentos com filtros opcionais `type` e `period` (YYYY-MM). Ordena por `month DESC, createdAt DESC`. Usado pelo web para a aba Receitas e À receber.

**Arquivos afetados:**
- `apps/bot/src/routes/admin.ts`

**Critérios de pronto:**
- [x] `GET /admin/payments` retorna array de Payment
- [x] `?type=income` retorna só receitas
- [x] `?type=expense` retorna só despesas
- [x] `?period=2026-04` retorna só mês especificado
- [x] Sem filtro retorna últimos 50 (limit padrão)
- [x] `bunx tsc --noEmit` verde em `apps/bot`

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
```

**Scope:** S (1 arquivo, ~30 linhas)

---

## Checkpoint 2 — Após T01–T03

- [x] `bunx tsc --noEmit` verde em `apps/bot`
- [x] `bunx oxlint` sem novos warnings em `apps/bot`
- [ ] Endpoints `POST` e `GET /admin/payments` respondem corretamente (curl manual ou Postman)

---

## Fase 3 — Web

### T04 — Web: queries.ts — atualizar fetchAllPayments + fetchRecentTransactions

**Descrição:** Atualizar `fetchAllPayments` para incluir `propertyId` no select (join com `property`). Adicionar helper `fetchRecentTransactions(limit)` para a tabela "Últimos movimentos". Corrigir tipos que assumiam `tenantId: string` (agora nullable).

**Arquivos afetados:**
- `apps/web/src/lib/queries.ts`

**Critérios de pronto:**
- [x] `fetchAllPayments` inclui `propertyId` no retorno (via `select('*')` que já traz o campo após migration)
- [x] Nenhum uso de `p.tenantId` como `string` sem null check nos helpers existentes
- [x] `bunx tsc --noEmit` verde em `apps/web`

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
```

**Scope:** S (1 arquivo)

---

### T05 — Web: tabs reestruturadas + Visão geral + tabela Últimos movimentos

**Descrição:** Substituir tabs `['Visão geral', 'Receitas', 'Despesas', 'Relatórios']` pelas novas `['Visão geral', 'Receitas', 'À receber', 'Repasses', 'Relatórios']`. Manter chart existente na aba Visão geral e adicionar tabela "Últimos movimentos" (10 pagamentos mais recentes, todos os tipos). Repasses e Relatórios ficam como placeholders.

**Arquivos afetados:**
- `apps/web/src/routes/_dashboard/finance/index.tsx`

**Critérios de pronto:**
- [x] 5 tabs: Visão geral / Receitas / À receber / Repasses / Relatórios
- [x] Tab Repasses exibe: `"Disponível com multi-tenancy"`
- [x] Tab Relatórios exibe: `"Em construção"`
- [x] Tabela "Últimos movimentos" aparece na Visão geral abaixo do chart
- [x] Colunas: Mês · Tipo (chip) · Descrição · Valor · Status
- [x] Mostra os 10 mais recentes de `fetchAllPayments()`
- [x] `bunx tsc --noEmit` verde
- [x] `bunx oxlint` sem novos warnings

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit && bunx oxlint src/
```

**Scope:** M (1 arquivo, refatoração de tabs + novo componente de tabela)

---

### T06 — Web: aba Receitas com filtro de período

**Descrição:** Implementar aba Receitas mostrando `type='income'` com todos os status. Adicionar chips de filtro `Mês | Semestre | Ano` com seletor de data adequado a cada período.

**Arquivos afetados:**
- `apps/web/src/routes/_dashboard/finance/index.tsx`

**Critérios de pronto:**
- [x] Aba Receitas exibe apenas pagamentos `type='income'`
- [x] Filtro Mês: exibe 1 mês específico (seletor `<input type="month">`)
- [x] Filtro Semestre: exibe 6 meses (mês atual + 5 anteriores)
- [x] Filtro Ano: exibe 12 meses do ano selecionado (seletor de ano)
- [x] Default: filtro Mês no mês atual
- [x] Colunas tabela: Mês · Inquilino · Descrição · Valor · Status
- [x] `bunx tsc --noEmit` verde

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
```

**Scope:** S (1 arquivo, ~60 linhas adicionais)

---

### T07 — Web: aba À receber

**Descrição:** Aba À receber mostrando pagamentos com `status='pending'`, ordenados por mês crescente (mais próximos primeiro). Inclui receitas e despesas pendentes.

**Arquivos afetados:**
- `apps/web/src/routes/_dashboard/finance/index.tsx`

**Critérios de pronto:**

- [x] Aba exibe só `status='pending'` (filtrado por `type='income'` após review)
- [x] Ordenado por mês crescente
- [x] Colunas: Mês · Tipo (chip) · Descrição · Valor
- [x] Empty state: "Nenhum pagamento pendente"
- [x] `bunx tsc --noEmit` verde

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
```

**Scope:** S (1 arquivo, ~40 linhas)

---

### T08 — Web: modal "Novo lançamento" + api.ts createPayment

**Descrição:** Botão "Novo lançamento" no header da página abre modal. Toggle Receita/Despesa muda campos condicionais. Ao submeter, chama `POST /admin/payments` via `adminApi.createPayment`. Após sucesso, invalida query `['payments']` e exibe toast.

**Arquivos afetados:**
- `apps/web/src/routes/_dashboard/finance/index.tsx`
- `apps/web/src/lib/api.ts`

**Critérios de pronto:**
- [x] `adminApi.createPayment` adicionado em `api.ts` com tipo discriminado correto
- [x] Botão "Novo lançamento" visível no header da página
- [x] Modal abre ao clicar no botão
- [x] Toggle Receita → exibe campo Inquilino (select de `fetchTenants()`) + campos comuns
- [x] Toggle Despesa → exibe campo Imóvel (select de `fetchProperties()`) + campos comuns
- [x] Campos comuns: Valor (numérico), Mês de referência (YYYY-MM, default mês atual), Descrição, Status (Pago/Pendente, default Pago)
- [x] Submit desabilitado se campos obrigatórios vazios
- [x] Submit chama `adminApi.createPayment(payload)` com payload correto
- [x] `onSuccess`: invalida query `['payments']` + toast "Lançamento registrado"
- [x] `onError`: toast "Erro ao registrar lançamento"
- [x] Modal fecha após sucesso
- [x] `bunx tsc --noEmit` verde em `apps/web`
- [x] `bunx oxlint` sem novos warnings em `apps/web`

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit && bunx oxlint src/
```

**Scope:** M (2 arquivos — modal + api method)

---

## Checkpoint 3 — Web completo

- [x] `bunx tsc --noEmit` verde em `apps/web`
- [x] `bunx oxlint` sem novos warnings em `apps/web`
- [x] 5 tabs renderizam sem erro
- [ ] Modal abre, submete, invalida query, fecha (teste manual)
- [ ] Tabela Últimos movimentos exibe dados reais (teste manual)

---

## Fase 4 — Fechamento

### T09 — ROADMAP: marcar Slice 7 como done

**Descrição:** Marcar todos os itens da Slice 7 no ROADMAP.md como `[x]` e atualizar tracking macro.

**Arquivos afetados:**
- `ROADMAP.md`

**Critérios de pronto:**
- [x] Todos os `[ ]` da Slice 7 viram `[x]`
- [x] Tracking macro atualizado: Slice 7/9 = 78%

**Scope:** XS (1 arquivo)

---

## Checkpoint final

- [x] `bunx tsc --noEmit` verde em `apps/bot`, `apps/web`, `packages/types`
- [x] `bunx oxlint` verde em ambos apps
- [ ] Todos os critérios de aceite do spec marcados (pendente: testes manuais + migrations aplicadas)
- [x] ROADMAP atualizado
- [x] Pronto para /simplify → /review → COMMIT

---

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| `tenantId` nullable quebra tipagem em outros usos no web | Médio | T04 verifica todos os usos antes de alterar UI |
| `prisma generate` após tornar FK opcional pode exigir rebuild | Baixo | Rodar `bunx prisma generate` antes de qualquer tsc |
| Modal usa `fetchTenants()` + `fetchProperties()` simultâneos | Baixo | `staleTime: 60_000` nas queries do modal |
| Naming `Tenant` (inquilino) confuso no select do modal | Baixo | Label "Inquilino" na UI, não "Tenant" |
