# Plano: Slice 4 — Templates (refinement)

> Spec: [specs/templates.md](../specs/templates.md)
> Pipeline: /spec ✅ → /plan ✅ → /build → /simplify → /review → COMMIT

---

## Visão geral

Finalizar a feature de templates: remover coluna `usageCount` materializada do banco (substituir por COUNT em query), proteger delete na UI, e adicionar activity log em criação e publicação de templates.

A UI já está implementada (lista, editor, chips, highlight). O trabalho é técnico: migration + 3 ajustes no bot + 2 ajustes no web.

---

## Decisões arquiteturais

- **usageCount via `_count.contracts`** no bot (Prisma) e via PostgREST count join no web (mantém padrão leituras → supabase-js)
- **Logs fire-and-forget** com `.catch(fastify.log.warn.bind(fastify.log))` — padrão das Slices 1–3
- **Trash desabilitado** (não oculto) quando `usageCount > 0` — feedback visual claro

---

## Grafo de dependências

```
T01 — Migration + Prisma schema
  │
  ├── T02 — Bot: _count em list/delete + remover increment
  │         (depende do schema sem usageCount)
  │
  └── T03 — Bot: activity logs template_created / template_published
            (independente do _count, mas vai no mesmo arquivo — sequencial por convenção)
                │
                └── T04 — Web: fetchContractTemplates com count join
                           (depende da migration estar aplicada no banco)
                             │
                             └── T05 — Web: trash guard no TemplateListItem
                                        (depende de usageCount chegar corretamente)

T06 — ROADMAP (após T01–T05 completos)
```

---

## Tarefas

### T01 — Migration: remover coluna `usageCount` + atualizar Prisma schema

**Descrição:** Criar migration SQL que dropa `ContractTemplate.usageCount`. Atualizar `schema.prisma` removendo o campo. Rodar `prisma generate` para confirmar.

**Arquivos afetados:**
- `apps/bot/prisma/migrations/20260524000002_templates_slice_remove_usage_count/migration.sql` (CRIAR)
- `apps/bot/prisma/schema.prisma` (EDITAR — remover campo `usageCount`)

**Critérios de pronto:**
- [ ] Arquivo `migration.sql` criado com `ALTER TABLE "ContractTemplate" DROP COLUMN "usageCount";`
- [ ] `schema.prisma`: campo `usageCount Int @default(0)` removido do model `ContractTemplate`
- [ ] `bunx prisma generate` no `apps/bot` sem erros

**Verificação:**
```bash
cd apps/bot && bunx prisma generate
bunx tsc --noEmit
```

---

### T02 — Bot: `_count` em list/delete + remover `usageCount: increment` do create contract

**Descrição:** Três edições em `admin.ts`:
1. `GET /admin/contract-templates`: trocar `usageCount: true` por `_count: { select: { contracts: true } }`; mapear na resposta
2. `DELETE /admin/contract-templates/:id`: trocar `select: { usageCount: true }` por `_count: { select: { contracts: true } }`; checar `_count.contracts > 0`
3. `POST /admin/contracts`: remover `tx.contractTemplate.update({ data: { usageCount: { increment: 1 } } })` da transaction

**Arquivos afetados:**
- `apps/bot/src/routes/admin.ts` (3 edições)

**Critérios de pronto:**
- [ ] `GET /admin/contract-templates` compila sem referência a `usageCount` no select Prisma; resposta inclui `usageCount: _count.contracts`
- [ ] `DELETE /admin/contract-templates/:id` usa `_count.contracts > 0` para guard
- [ ] `POST /admin/contracts` não tenta fazer `usageCount: { increment: 1 }`
- [ ] `bunx tsc --noEmit` verde

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/
```

**Depende de:** T01

---

### T03 — Bot: activity logs `template_created` e `template_published`

**Descrição:** Duas edições em `admin.ts`:
1. `POST /admin/contract-templates`: adicionar `logActivityHelper` com `action: 'template_created'` após o create
2. `PATCH /admin/contract-templates/:id`: ampliar `findUnique` inicial para `{ id, name, status, ownerId }`; emitir `logActivityHelper` com `action: 'template_published'` quando status muda para `'published'` e era diferente antes

**Arquivos afetados:**
- `apps/bot/src/routes/admin.ts` (2 edições)

**Critérios de pronto:**
- [ ] `POST /admin/contract-templates` emite `logActivityHelper({ action: 'template_created', subjectType: 'contract_template', ... })` fire-and-forget
- [ ] `PATCH /admin/contract-templates/:id` emite `logActivityHelper({ action: 'template_published', ... })` apenas quando `status === 'published' && existing.status !== 'published'`
- [ ] Não emite log quando status volta para `draft`
- [ ] `bunx tsc --noEmit` verde

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
bunx oxlint src/
```

**Depende de:** T02 (mesmo arquivo — sequencial)

---

### T04 — Web: `fetchContractTemplates` com PostgREST count join

**Descrição:** Atualizar `fetchContractTemplates()` em `queries.ts` para usar `select('... contracts:Contract(count)')` e mapear `contracts[0]?.count ?? 0` para `usageCount`. Remover `usageCount` do select direto (coluna não existe mais no banco).

**Arquivos afetados:**
- `apps/web/src/lib/queries.ts` (1 edição)

**Critérios de pronto:**
- [ ] `fetchContractTemplates()` não seleciona coluna `usageCount` diretamente
- [ ] Retorna `ContractTemplateSummary[]` com `usageCount: number` calculado via count join
- [ ] `bunx tsc --noEmit` verde em `apps/web`

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
bunx oxlint src/
```

**Depende de:** T01

---

### T05 — Web: trash guard no `TemplateListItem`

**Descrição:** No componente `TemplateListItem` dentro de `templates/index.tsx`, adicionar `disabled={template.usageCount > 0}` no botão de delete; atualizar `aria-label` e classes CSS para estado desabilitado.

**Arquivos afetados:**
- `apps/web/src/routes/_dashboard/templates/index.tsx` (1 edição no botão trash)

**Critérios de pronto:**
- [ ] Botão trash tem `disabled={template.usageCount > 0}`
- [ ] `aria-label` muda para `'Template em uso — não pode remover'` quando `usageCount > 0`
- [ ] Classe `disabled:pointer-events-none disabled:opacity-30` aplicada
- [ ] `bunx tsc --noEmit` verde

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
bunx oxlint src/
```

**Depende de:** T04

---

### T06 — ROADMAP: marcar Slice 4 concluída

**Descrição:** Marcar todos os itens `[ ]` da Slice 4 no `ROADMAP.md` como `[x]`. Atualizar a tabela de tracking macro.

**Arquivos afetados:**
- `ROADMAP.md`

**Critérios de pronto:**
- [ ] Todos os itens da Slice 4 marcados `[x]`
- [ ] Tabela de tracking atualiza F1 para 4/9

**Depende de:** T01–T05

---

## Checkpoints

### Checkpoint A — após T01
- `bunx prisma generate` OK
- `bunx tsc --noEmit` verde no bot (schema sem `usageCount`)

### Checkpoint B — após T03
- `bunx tsc --noEmit` verde no bot
- `bunx oxlint src/` sem novos warnings no bot
- Bot inicia sem erros (`bun run dev` ou equivalente)

### Checkpoint C — após T05 (slice completa)
- `bunx tsc --noEmit` verde em ambos os apps
- `bunx oxlint` sem novos warnings em ambos
- `bun test` (bot) — todos passam
- `vitest run` (web) — todos passam

---

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| PostgREST count join syntax errada | Médio — `usageCount` retorna undefined | Se `contracts:Contract(count)` falhar, tentar `contracts:Contract!templateId(count)` |
| `fetchContractTemplate` (detalhe) retorna `usageCount` via campo removido | Baixo — `GET *` sem coluna retorna undefined | Verificar que `fetchContractTemplate` não depende da coluna; tipos TS capturam |
| `request.adminUserId` undefined no PATCH | Baixo | Padrão `?? 'Admin'` já usado em outras slices |
