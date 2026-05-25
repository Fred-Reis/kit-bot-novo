# Spec: Slice 4 — Templates (refinement)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 4.
> Depende de: Slices 1–3, Foundation F0.2 (logActivity helper).
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Finalizar a feature de templates ponta-a-ponta: corrigir `usageCount` para ser computado via query (B9), proteger o delete na UI quando o template está em uso, e emitir activity log nos eventos `template_created` e `template_published`.

**Usuário alvo:** proprietário logado no admin (apps/web).

**Sucesso:** owner cria e publica templates, vê quantos contratos cada um tem, não consegue apagar template em uso, e todas as ações ficam registradas no log de atividade.

---

## 2. Escopo

### Dentro

**Schema & migration**
- Remover coluna `usageCount Int @default(0)` de `ContractTemplate`
- Atualizar Prisma schema para refletir ausência da coluna

**Bot (`apps/bot/src/routes/admin.ts`)**
- `GET /admin/contract-templates`: trocar `usageCount: true` por `_count: { select: { contracts: true } }` no select; mapear `_count.contracts` → `usageCount` na resposta
- `DELETE /admin/contract-templates/:id`: substituir `select: { usageCount: true }` por `_count: { select: { contracts: true } }`; checar `_count.contracts > 0`
- `POST /admin/contracts`: remover `tx.contractTemplate.update({ data: { usageCount: { increment: 1 } } })` da transaction
- `POST /admin/contract-templates`: adicionar `logActivityHelper` com `action: 'template_created'` (fire-and-forget)
- `PATCH /admin/contract-templates/:id`: buscar `status` atual antes de aplicar patch; se `status` muda para `'published'`, emitir `logActivityHelper` com `action: 'template_published'` (fire-and-forget)

**Web (`apps/web/src`)**
- `lib/queries.ts` — `fetchContractTemplates()`: trocar `select('id, code, name, status, usageCount, updatedAt')` por select com count join do PostgREST; mapear resultado para `usageCount: number`
- `routes/_dashboard/templates/index.tsx` — `TemplateListItem`: desabilitar o botão trash (e mudar `aria-label`) quando `template.usageCount > 0`

**ROADMAP**
- Marcar todos os itens da Slice 4 como `[x]`

### Fora

- Template delete → não logar `template_deleted` (ROADMAP não lista esse evento)
- Reverter publicação (`draft`) → não logar (ROADMAP só lista `template_published`)
- Edição do corpo do template → sem log (muito ruidoso para MVP)
- `fetchContractTemplate` (detalhe) → sem mudança (não retorna `usageCount`)
- Qualquer nova coluna, campo ou endpoint de template
- Migração de dados existentes (coluna removida tem apenas `0` em todos os rows — sem perda)
- Testes de integração com banco real

---

## 3. Schema changes

### Migration: `templates_slice_remove_usage_count`

```sql
ALTER TABLE "ContractTemplate" DROP COLUMN "usageCount";
```

Sem backfill necessário — a coluna será substituída por COUNT em runtime.

Prisma schema (`apps/bot/prisma/schema.prisma`):

```prisma
model ContractTemplate {
  id        String     @id @default(uuid())
  ownerId   String
  owner     Owner      @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  code      String     @unique
  name      String
  body      String     @default("")
  status    String     @default("draft")
  contracts Contract[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@index([ownerId])
}
```

> `usageCount` removido. A relação `contracts Contract[]` já existe (FK em `Contract.templateId`).

---

## 4. Tipos compartilhados (`packages/types`)

**Nenhuma mudança.** `ContractTemplate.usageCount: number` permanece no tipo TS — o valor agora vem de um COUNT na query em vez de coluna, mas o shape da resposta para o web não muda.

---

## 5. Bot changes

### 5.1 — `GET /admin/contract-templates`: computar usageCount via `_count`

```ts
const templates = await prisma.contractTemplate.findMany({
  select: {
    id: true,
    code: true,
    name: true,
    status: true,
    updatedAt: true,
    _count: { select: { contracts: true } },
  },
  orderBy: { updatedAt: 'desc' },
});

return reply.send(
  templates.map(({ _count, ...t }) => ({ ...t, usageCount: _count.contracts })),
);
```

### 5.2 — `DELETE /admin/contract-templates/:id`: contar contratos inline

```ts
const template = await prisma.contractTemplate.findUnique({
  where: { id },
  select: { _count: { select: { contracts: true } } },
});
if (!template) return reply.status(404).send({ error: 'Template not found' });
if (template._count.contracts > 0) return reply.status(409).send({ error: 'Template is in use' });
await prisma.contractTemplate.delete({ where: { id } });
return reply.status(204).send();
```

### 5.3 — `POST /admin/contracts`: remover incremento de usageCount

Na transaction existente, remover:

```ts
// REMOVER este bloco:
await tx.contractTemplate.update({
  where: { id: templateId },
  data: { usageCount: { increment: 1 } },
});
```

A transaction fica só com o `tx.contract.create(...)`.

### 5.4 — `POST /admin/contract-templates`: log `template_created`

Após o `prisma.contractTemplate.create(...)`:

```ts
logActivityHelper({
  ownerId: owner.id,
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'Admin',
  action: 'template_created',
  subjectType: 'contract_template',
  subjectId: template.id,
  subject: template.name,
}).catch(fastify.log.warn.bind(fastify.log));
```

### 5.5 — `PATCH /admin/contract-templates/:id`: log `template_published`

Buscar `status` antes de aplicar o patch; se status muda para `'published'`, emitir log:

```ts
const existing = await prisma.contractTemplate.findUnique({
  where: { id },
  select: { id: true, name: true, status: true, ownerId: true },
});
if (!existing) return reply.status(404).send({ error: 'Template not found' });

// ... validação de status e build de data ...

const template = await prisma.contractTemplate.update({ where: { id }, data });

if (status === 'published' && existing.status !== 'published') {
  logActivityHelper({
    ownerId: existing.ownerId,
    actorType: 'user',
    actorLabel: request.adminUserId ?? 'Admin',
    action: 'template_published',
    subjectType: 'contract_template',
    subjectId: id,
    subject: existing.name,
  }).catch(fastify.log.warn.bind(fastify.log));
}

return reply.send(template);
```

> `existing.ownerId` precisa ser selecionado no `findUnique` — ampliar o `select` atual de `{ id: true }` para `{ id: true, name: true, status: true, ownerId: true }`.

---

## 6. Web changes

### 6.1 — `lib/queries.ts`: `fetchContractTemplates` com count join

```ts
export async function fetchContractTemplates(): Promise<ContractTemplateSummary[]> {
  const { data, error } = await supabase
    .from('ContractTemplate')
    .select('id, code, name, status, updatedAt, contracts:Contract(count)')
    .order('updatedAt', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((t) => {
    const { contracts, ...rest } = t as typeof t & { contracts: { count: number }[] };
    return { ...rest, usageCount: contracts[0]?.count ?? 0 };
  }) as ContractTemplateSummary[];
}
```

> PostgREST retorna `contracts: [{ count: N }]` para count aggregates em tabelas relacionadas.

### 6.2 — `templates/index.tsx`: desabilitar trash quando `usageCount > 0`

Em `TemplateListItem`, no botão de delete:

```tsx
<button
  type="button"
  aria-label={template.usageCount > 0 ? 'Template em uso — não pode remover' : 'Remover template'}
  onClick={onDelete}
  disabled={template.usageCount > 0}
  className="mt-0.5 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all disabled:pointer-events-none disabled:opacity-30"
>
  <Trash2 className="size-3.5" />
</button>
```

> `disabled:pointer-events-none` impede click. `disabled:opacity-30` dá feedback visual. `aria-label` muda para explicar o motivo.

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `template_created` | `user` | `contract_template` | Bot: `POST /admin/contract-templates` — após criar |
| `template_published` | `user` | `contract_template` | Bot: `PATCH /admin/contract-templates/:id` — quando status muda para `published` |

---

## 8. Notificações

Nenhuma. Esta slice não dispara notificações WhatsApp, email ou in-app.

---

## 9. Critérios de aceite

### Schema
- [ ] Migration aplicada: coluna `usageCount` removida de `ContractTemplate`
- [ ] `prisma generate` OK — sem referência a `usageCount` no schema Prisma
- [ ] Bot compila após migration

### Bot — usageCount computado
- [ ] `GET /admin/contract-templates` retorna `usageCount: N` calculado via `_count.contracts`
- [ ] `DELETE /admin/contract-templates/:id` retorna 409 se há contratos relacionados (via count, não coluna)
- [ ] `POST /admin/contracts` não tenta mais fazer `usageCount: { increment: 1 }`
- [ ] `bunx tsc --noEmit` verde em `apps/bot`

### Bot — activity log
- [ ] `POST /admin/contract-templates` emite `template_created` com `subjectType: 'contract_template'`
- [ ] `PATCH /admin/contract-templates/:id` emite `template_published` ao mudar status para `published`
- [ ] Ambos os logs são fire-and-forget — falha não quebra o endpoint
- [ ] Não emite log quando status volta para `draft`

### Web
- [ ] `fetchContractTemplates()` retorna `usageCount` computado (sem ler coluna `usageCount` do banco)
- [ ] Template sem contratos: `usageCount = 0`, botão trash ativo
- [ ] Template com contratos: `usageCount > 0`, botão trash desabilitado com `aria-label` explicativo
- [ ] `bunx tsc --noEmit` verde em `apps/web`

### Lint / testes
- [ ] `bun run lint` — 0 novos erros
- [ ] `bun test` (bot) — todos passam (sem regressões em criação de contrato)
- [ ] `vitest run` (web) — todos passam

### ROADMAP
- [ ] Todos os itens da Slice 4 marcados `[x]` no ROADMAP

---

## 10. Riscos / edge cases

### R1 — PostgREST count join syntax
PostgREST retorna `contracts: [{ count: N }]` — não um número direto. O map no `fetchContractTemplates` precisa acessar `contracts[0]?.count`. Se o join falhar por nome de FK ambíguo, usar `contracts:Contract!templateId(count)`.
**Mitigação:** testar manualmente após o build; se falhar, ajustar para `Contract!templateId(count)`.

### R2 — `GET /admin/contract-templates` via bot vs Supabase direto
A lista vem do Supabase direto (padrão de leituras do projeto). O bot API também tem um endpoint de list mas não é usado pelo web. Após a migration, a query Supabase precisa do count join — sem isso, `usageCount` fica ausente e o tipo quebra.
**Mitigação:** `bunx tsc --noEmit` falha se o map não produzir `ContractTemplateSummary` correto.

### R3 — `PATCH` existente só seleciona `{ id: true }`
O handler atual do PATCH busca `{ id: true }` para checar existência. Para o log precisamos também de `name`, `status`, `ownerId`. Ampliar o select não quebra nada — só carrega mais dados.
**Mitigação:** ampliar para `{ id: true, name: true, status: true, ownerId: true }` no findUnique inicial.

### R4 — `request.adminUserId` pode ser undefined
O PATCH e POST não usam `adminUserId` hoje. Pode não existir no `request` sem tipagem.
**Mitigação:** usar o mesmo padrão das Slices 1–3: `request.adminUserId ?? 'Admin'`.

### R5 — Contratos existentes com templateId válido
Remover `usageCount` da tabela não afeta contratos — `Contract.templateId` continua funcionando. A relação Prisma `contracts Contract[]` em `ContractTemplate` já existia.
**Mitigação:** sem backfill necessário; a migration só dropa a coluna.

---

## 11. Dependências / pré-condições

- Foundation F0.2 aplicada: `logActivity` helper em `services/activity.ts` existe
- `admin.ts` tem `logActivityHelper` importado (alias de `services/activity`)
- Slices 1–3 aplicadas (padrão de activity log estabelecido)
- Bot e web rodam sem erros antes desta slice

---

## 12. Out of scope (explícito)

- Log de `template_deleted`, `template_updated`, `template_drafted`
- Modal de confirmação no delete (toast de erro 409 é suficiente)
- Tooltip no botão desabilitado (aria-label cobre acessibilidade)
- Paginação ou busca na lista de templates
- Importação de `.docx` (botão stub mantido)
- Contagem de variáveis por template
- RLS
