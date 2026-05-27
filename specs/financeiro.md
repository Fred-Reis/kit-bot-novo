# Spec: Slice 7 — Financeiro (KPIs + movimentos + lançamento manual)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 7.
> Depende de: Slices 1–6, Foundation F0.2 (logActivity helper), F0.4 (notifyOwner helper).
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Completar a feature Financeiro ponta-a-ponta em três frentes:

1. **KPIs e chart reais** — página já tem estrutura; ajustar labels, tabs e adicionar tabela "Últimos movimentos" na aba Visão geral.
2. **Tabs corretas** — reestruturar navegação para `Visão geral | Receitas | À receber | Repasses (placeholder) | Relatórios (placeholder)`.
3. **Lançamento manual** — modal "Novo lançamento" que grava `Payment` no banco via endpoint do bot; suporta receita (vinculada a inquilino) e despesa (vinculada a imóvel).

**Usuário alvo:** proprietário logado no admin.

**Sucesso:** owner abre Financeiro, vê KPIs reais, navega entre tabs com dados corretos, lança pagamento manual e vê o registro aparecer na lista imediatamente.

---

## 2. Escopo

### Dentro

- **Schema**: `Payment.tenantId String?` (tornar nullable) + adicionar `Payment.propertyId String?`
- **Prisma**: atualizar schema + migration
- **`packages/types`**: atualizar `Payment` interface — `tenantId: string | null`, adicionar `propertyId: string | null`
- **Bot**: endpoint `POST /admin/payments` — lançamento manual (receita ou despesa)
- **Bot**: endpoint `GET /admin/payments` — lista paginada/filtrada (receita/despesa/mês)
- **Web `lib/queries.ts`**: adicionar `fetchFinanceSummary()` e `fetchRecentTransactions(limit)` (podem usar `fetchAllPayments` + helpers existentes, ou queries diretas)
- **Web `lib/api.ts`**: adicionar `createPayment()`, atualizar `recordPayment()` se necessário
- **Web `finance/index.tsx`**: reestruturar tabs + adicionar tabela "Últimos movimentos" + modal "Novo lançamento"
- **Web `finance/index.tsx`**: filtro de período na aba Receitas (mês / semestre / ano — passado e futuro)
- **Activity log**: `payment_recorded` (lançamento manual via web), `payment_confirmed` (já existe no bot via confirm-payment)
- **Notif**: sem notificação nesta slice (cron de overdue → roadmap futuro)
- **ROADMAP**: marcar Slice 7 como `[x]`

### Fora

- Cron job para marcar pagamentos como `overdue` e notificar owner (`payment_overdue`) — roadmap futuro
- Conciliação bancária (Pluggy/Belvo)
- Repasses a proprietários terceiros (placeholder na UI)
- Relatórios exportáveis (placeholder na UI)
- Edição ou exclusão de pagamento já lançado
- Paginação server-side (escala de 5–50 imóveis não exige)
- RLS

---

## 3. Schema changes

### Migration: `financeiro_slice_payment_nullable_tenantid_add_propertyid`

```sql
-- tornar tenantId nullable
ALTER TABLE "Payment" ALTER COLUMN "tenantId" DROP NOT NULL;

-- adicionar propertyId opcional
ALTER TABLE "Payment" ADD COLUMN "propertyId" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL;
```

Sem backfill — rows existentes têm `tenantId` preenchido, `propertyId` fica NULL (aceitável; visão por imóvel ativa somente para novos lançamentos).

**Prisma schema (`apps/bot/prisma/schema.prisma`):**

```prisma
model Payment {
  id          String    @id @default(uuid())
  ownerId     String
  owner       Owner     @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  tenantId    String?                                           // nullable — obrigatório só para receitas
  tenant      Tenant?   @relation(fields: [tenantId], references: [id])
  propertyId  String?                                           // novo — obrigatório para despesas
  property    Property? @relation(fields: [propertyId], references: [id], onDelete: SetNull)
  month       String                                            // YYYY-MM
  amount      Decimal
  status      String                                            // 'paid' | 'pending' | 'overdue'
  description String?
  type        String    @default("income")                      // 'income' | 'expense'
  paidAt      DateTime?
  createdAt   DateTime  @default(now())

  @@index([ownerId])
  @@index([tenantId])
  @@index([propertyId])
}
```

---

## 4. Tipos compartilhados (`packages/types`)

**`packages/types/src/tenant.ts`** — atualizar `Payment`:

```ts
export interface Payment {
  id: string;
  ownerId: string;
  tenantId: string | null;      // era string, agora nullable
  propertyId: string | null;    // novo
  month: string;                // YYYY-MM
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
  description: string | null;
  type: 'income' | 'expense';
  paidAt: string | null;
  createdAt: string;
}
```

> **Nota de naming:** O model `Tenant` no banco refere-se ao **inquilino** (locatário). Em contexto SaaS futuro, "tenant" significará a organização/workspace do proprietário (multi-tenancy + RBAC + planos). Antes de implementar multi-tenancy, renomear `Tenant` → `Inquilino` no schema para evitar ambiguidade. Registrado como risco em §10.

---

## 5. Bot changes

### 5.1 — `POST /admin/payments` (novo endpoint)

Lança pagamento manual. Validação Zod diferencia receita (requer `inquilinoId`) de despesa (requer `propertyId`).

```
POST /admin/payments
Auth: JWT admin
Body (receita):  { type: 'income',  amount, month, description?, inquilinoId, status? }
Body (despesa):  { type: 'expense', amount, month, description, propertyId,   status? }
```

Regras:
- `type = 'income'`: `inquilinoId` obrigatório, `propertyId` ignorado (derivar via inquilino se necessário)
- `type = 'expense'`: `propertyId` obrigatório, `inquilinoId` null
- `status` default: `'paid'` (lançamento manual geralmente já ocorreu)
- `amount`: Decimal, positivo, > 0
- `month`: string `YYYY-MM`, validar formato
- `ownerId`: extraído do JWT admin

Response `201`: Payment criado.

```ts
// Zod schema
const createPaymentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('income'),
    amount: z.number().positive(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    description: z.string().optional(),
    inquilinoId: z.string().uuid(),
    status: z.enum(['paid', 'pending', 'overdue']).default('paid'),
  }),
  z.object({
    type: z.literal('expense'),
    amount: z.number().positive(),
    month: z.string().regex(/^\d{4}-\d{2}$/),
    description: z.string().min(1),
    propertyId: z.string().uuid(),
    status: z.enum(['paid', 'pending', 'overdue']).default('paid'),
  }),
]);
```

Activity log após criar (fire-and-forget):
```ts
logActivity('user', ownerId, 'payment_recorded',
  description ?? (type === 'income' ? 'Receita' : 'Despesa'),
  payment.id, 'payment', log.warn.bind(log));
```

### 5.2 — `GET /admin/payments` (novo endpoint)

Lista pagamentos com filtros opcionais.

```
GET /admin/payments?type=income&period=2026-04&limit=50
Auth: JWT admin
Query: type? ('income'|'expense'), period? (YYYY-MM), limit? (default 50)
```

Retorna array de `Payment` ordenado por `month DESC, createdAt DESC`.

---

## 6. Web changes

### 6.1 — Tabs reestruturadas (`finance/index.tsx`)

Substituir `['Visão geral', 'Receitas', 'Despesas', 'Relatórios']` por:

```ts
const TABS = ['Visão geral', 'Receitas', 'À receber', 'Repasses', 'Relatórios'];
```

| Tab | Conteúdo |
|---|---|
| **Visão geral** | KPI cards + chart Recebido/Em atraso + tabela "Últimos movimentos" |
| **Receitas** | Tabela de `type='income'`, filtro de período, todos os status |
| **À receber** | Tabela de `status='pending'` com vencimento presente/futuro |
| **Repasses** | Placeholder: "Disponível com multi-tenancy" |
| **Relatórios** | Placeholder: "Em construção" |

### 6.2 — Filtro de período na aba Receitas

Selector de período acima da tabela:

```tsx
type PeriodFilter = 'month' | 'semester' | 'year';
```

- **Mês**: `YYYY-MM` — exibe só o mês selecionado
- **Semestre**: 6 meses anteriores + mês atual
- **Ano**: 12 meses do ano selecionado

UI: chips horizontais `Mês | Semestre | Ano` + seletor de data (mês ou ano conforme escolha).

### 6.3 — Tabela "Últimos movimentos" na Visão geral

Abaixo do chart, exibir os 10 pagamentos mais recentes (todos os tipos):

Colunas: Mês · Tipo (chip income/expense) · Descrição · Valor · Status pill

Query: `fetchAllPayments()` + `.sort().slice(0, 10)` — sem nova query.

### 6.4 — Modal "Novo lançamento"

Botão no header da página (ao lado do título). Modal com campos:

**Tipo**: toggle `Receita | Despesa` (muda campos condicionais)

**Receita:**
- Inquilino: select de `fetchTenants()` — obrigatório
- Valor: input numérico — obrigatório
- Mês de referência: input `YYYY-MM` (default: mês atual) — obrigatório
- Descrição: texto livre — opcional
- Status: select `Pago | Pendente` (default Pago)

**Despesa:**
- Imóvel: select de `fetchProperties()` — obrigatório
- Valor: input numérico — obrigatório
- Mês de referência: input `YYYY-MM` (default: mês atual) — obrigatório
- Descrição: texto livre — obrigatório
- Status: select `Pago | Pendente` (default Pago)

Ao submeter: `adminApi.createPayment(payload)` → `onSuccess`: invalidar query `['payments']` + toast "Lançamento registrado".

### 6.5 — `lib/api.ts` — novo método

```ts
createPayment: (data:
  | { type: 'income';  amount: number; month: string; inquilinoId: string; description?: string; status?: string }
  | { type: 'expense'; amount: number; month: string; propertyId: string;  description: string;  status?: string }
) => botApi.post('/admin/payments', data),
```

### 6.6 — `lib/queries.ts` — atualizar `fetchAllPayments`

Incluir `propertyId` no select para viabilizar a visão por imóvel futura:

```ts
supabase.from('Payment').select('*, property:propertyId(name)').order('month', { ascending: false })
```

Tipo de retorno: `Payment & { property?: { name: string } | null }` — criar interface `PaymentWithRefs` em `packages/types` ou localmente.

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `payment_recorded` | `user` | `payment` | Bot: `POST /admin/payments` — após criar |
| `payment_confirmed` | `user` | `lead` | Bot: `POST /admin/leads/:id/confirm-payment` — já existe |

---

## 8. Notificações

Nenhuma nesta slice. Notificação de `payment_overdue` (atraso > 5 dias) fica no roadmap via cron job — F0.4 pendente.

---

## 9. Critérios de aceite

### Schema & migration
- [ ] Migration aplicada: `tenantId` nullable + `propertyId` adicionado em `Payment`
- [ ] `prisma generate` OK sem erros
- [ ] Rows existentes não quebram (tenantId preservado, propertyId = NULL)

### Bot — POST /admin/payments
- [ ] Endpoint `POST /admin/payments` retorna 201 com Payment criado
- [ ] Receita sem `inquilinoId` → 400
- [ ] Despesa sem `propertyId` → 400
- [ ] `month` inválido (ex: `2026-13`) → 400
- [ ] `amount` negativo ou zero → 400
- [ ] Activity log `payment_recorded` emitido (fire-and-forget)
- [ ] `bunx tsc --noEmit` verde em `apps/bot`

### Bot — GET /admin/payments
- [ ] Endpoint retorna lista ordenada por `month DESC`
- [ ] Filtro `?type=income` retorna só receitas
- [ ] Filtro `?period=2026-04` retorna só pagamentos do mês
- [ ] `bunx tsc --noEmit` verde em `apps/bot`

### Types
- [ ] `Payment.tenantId` é `string | null` em `packages/types`
- [ ] `Payment.propertyId` é `string | null` em `packages/types`
- [ ] `bunx tsc --noEmit` verde em `packages/types`

### Web — tabs
- [ ] 5 tabs: Visão geral / Receitas / À receber / Repasses / Relatórios
- [ ] Repasses exibe placeholder "Disponível com multi-tenancy"
- [ ] Relatórios exibe placeholder "Em construção"

### Web — Visão geral
- [ ] KPI cards exibem valores reais (fetchAllPayments)
- [ ] Chart dual-series Recebido/Em atraso funcional
- [ ] Tabela "Últimos movimentos" exibe últimos 10 pagamentos (todos os tipos)

### Web — Receitas
- [ ] Tabela exibe `type='income'` com todos os status
- [ ] Filtro Mês/Semestre/Ano filtra corretamente
- [ ] Seletor de data muda conforme filtro escolhido

### Web — À receber
- [ ] Tabela exibe `status='pending'` ordenada por mês
- [ ] Exibe colunas: Mês · Inquilino/Imóvel · Valor · Status

### Web — modal Novo lançamento
- [ ] Botão visível no header da página
- [ ] Toggle Receita/Despesa muda campos exibidos
- [ ] Receita: inquilino obrigatório, sem campo imóvel
- [ ] Despesa: imóvel obrigatório, sem campo inquilino
- [ ] Submit chama `POST /admin/payments` com payload correto
- [ ] Após sucesso: query `['payments']` invalidada + toast
- [ ] `bunx tsc --noEmit` verde em `apps/web`

### Lint
- [ ] `bunx oxlint` — 0 novos warnings em ambos apps

### ROADMAP
- [ ] Todos os itens da Slice 7 marcados `[x]` no ROADMAP

---

## 10. Riscos / edge cases

### R1 — Naming `Tenant` vs inquilino vs SaaS tenant
`Tenant` no banco = inquilino (locatário). Em multi-tenancy futuro, "tenant" será a organização do proprietário. Antes de implementar Fase 5, renomear model `Tenant` → `Inquilino` no schema para eliminar ambiguidade, junto com `ownerId` migration necessária de qualquer forma. **Esta slice NÃO renomeia** — escopo controlado.

### R2 — `Payment.tenantId` nullable quebra queries existentes
`fetchPayments(tenantId)` e `fetchAllPayments()` assumem `tenantId: string`. Após tornar nullable, `tenantId` pode ser `null` para despesas. Checkar todos os usos de `p.tenantId` no web.

### R3 — `fetchAllPayments` retorna sem `propertyId` hoje
A query atual usa `select('*')`. Após adicionar `propertyId` no schema, o campo virá automaticamente no `*`. Verificar se `Payment` type em `packages/types` está atualizado antes de usar no web.

### R4 — Modal usa `fetchTenants()` e `fetchProperties()` — latência no open
Ao abrir modal, dispara 2 queries (tenants + properties). Aceitável escala ~15 imóveis. Usar `staleTime: 60_000` nas queries do modal para não refetch a cada open.

### R5 — `month` como `YYYY-MM` vs Date
Campo `month` é string `YYYY-MM` — não é timestamp. Filtro de período no web compara string prefix (`'2026-04'`). Consistente com implementação existente em `computeMonthlyTotals`.

### R6 — Inquilino sem `propertyId` direto no Payment
Para receitas, `propertyId` no Payment fica `null`. Visão consolidada por imóvel para receitas requer join `Payment → tenantId → Tenant.propertyId`. Esta slice não implementa essa view consolidada — `propertyId` no Payment serve só para despesas por ora.

### R7 — Status default `paid` no modal
Lançamento manual geralmente registra algo que já ocorreu. Default `paid` é o mais comum. Owner pode mudar para `pending` se quiser pré-lançar vencimento futuro.

---

## 11. Dependências / pré-condições

- Foundation F0.2 aplicada: `logActivity` helper em `services/activity.ts`
- Slices 1–6 aplicadas (padrão de admin routes e web estabelecido)
- `fetchTenants()` e `fetchProperties()` existem em `lib/queries.ts`
- `adminApi` / `botApi` wrapper existe em `lib/api.ts`
