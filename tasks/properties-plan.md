# Plan: Slice 2 — Properties (CRUD completo + UI)

> Spec: [specs/properties.md](../specs/properties.md)
> Objetivo: tipo `Property['status']` completo (inclui `archived`), activity logs nos endpoints de criação e arquivamento, ROADMAP sincronizado.

---

## Grafo de dependências

```
T01 (types: adicionar 'archived' ao status)
  └── T02 (web: PropertyCard STATUS_CONFIG) ← depende de T01

T03 (bot: migrar logActivity POST + adicionar DELETE) ← independente de T01/T02

T04 (ROADMAP: marcar itens [x]) ← independente de todos
```

**Execução:** T01 → T02 → T03 → T04 (sequencial por segurança, mas T03 e T04 poderiam rodar em paralelo com T01/T02).

---

## Fase 1 — Tipos

---

### T01 — Adicionar `'archived'` ao `Property['status']`

**Descrição:** Expandir o union type `Property['status']` em `packages/types/src/property.ts` para incluir `'archived'`. Alinha com BRAINSTORM B7 (5 valores) e com o uso real no bot (endpoint DELETE já seta `status: 'archived'`).

**Arquivos afetados:**
- `packages/types/src/property.ts`

**Mudança:**
```ts
// ANTES:
status: 'available' | 'rented' | 'maintenance' | 'reserved';

// DEPOIS:
status: 'available' | 'rented' | 'maintenance' | 'reserved' | 'archived';
```

**Critério de pronto:**
- [ ] `Property['status']` inclui `'archived'`
- [ ] `bunx tsc --noEmit` verde em `packages/types`, `apps/bot`, `apps/web`

**Verificação:**
```bash
cd packages/types && bunx tsc --noEmit
cd apps/bot && bunx tsc --noEmit
cd apps/web && bunx tsc --noEmit
```

**Dependências:** Slice 0a e 0b aplicadas (pré-condição, não tarefa).
**Escopo:** XS (1 arquivo, 1 linha).

---

## Checkpoint 1 — Após T01

- [ ] `bunx tsc --noEmit` verde nos 3 pacotes
- [ ] Nenhum erro novo em bot ou web

---

## Fase 2 — Web

---

### T02 — Adicionar `archived` ao `PropertyCard STATUS_CONFIG`

**Descrição:** `PropertyCard` usa `Record<Property['status'], { tone: Tone; label: string }>`. Com `'archived'` adicionado ao tipo em T01, TypeScript exige que o record tenha a entrada correspondente. Adicionar com tone `'bad'` e label `'Arquivado'`.

**Arquivos afetados:**
- `apps/web/src/components/property-card.tsx`

**Mudança:**
```ts
const STATUS_CONFIG: Record<Property['status'], { tone: Tone; label: string }> = {
  available:   { tone: 'ok',      label: 'Disponível' },
  rented:      { tone: 'accent',  label: 'Alugado'    },
  maintenance: { tone: 'warn',    label: 'Manutenção' },
  reserved:    { tone: 'default', label: 'Reservado'  },
  archived:    { tone: 'bad',     label: 'Arquivado'  }, // ← ADICIONAR
};
```

> Sem mudança visual: cards arquivados nunca aparecem (filtro `.neq('status','archived')` na query `fetchProperties`).

**Critério de pronto:**
- [ ] `STATUS_CONFIG` tem entrada para `'archived'`
- [ ] `bunx tsc --noEmit` verde em `apps/web`
- [ ] `vitest run` — sem regressões

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && vitest run
```

**Dependências:** T01.
**Escopo:** XS (1 arquivo, 1 linha).

---

## Checkpoint 2 — Após T02

- [ ] `bunx tsc --noEmit` verde em `apps/web`
- [ ] `vitest run` — todos passam

---

## Fase 3 — Bot

---

### T03 — Migrar `logActivity` legado + adicionar `property_archived`

**Descrição:** Dois ajustes no mesmo arquivo (`apps/bot/src/routes/admin.ts`):

1. **`POST /admin/properties`**: Substituir a chamada ao `logActivity` local (assinatura legada, string livre `'publicou imóvel'`) por `logActivityHelper` importado de `@/services/activity` com `action: 'property_created'`.

2. **`DELETE /admin/properties/:id`**: Expandir o `findUnique` para incluir `name` e `ownerId` no select; adicionar `logActivityHelper` com `action: 'property_archived'` após o soft-delete.

**Arquivos afetados:**
- `apps/bot/src/routes/admin.ts`

**Mudança (1) — import:**
```ts
// Adicionar no topo (se não existir — verificar antes):
import { logActivity as logActivityHelper } from '@/services/activity';
```

> ⚠️ `admin.ts` já tem `function logActivity(...)` definida localmente (assinatura legada). O alias `logActivityHelper` evita colisão — mesmo padrão do Slice 1.

**Mudança (2) — POST /admin/properties** (linha ~411):
```ts
// REMOVER chamada existente:
logActivity(
  request.adminUserId ?? 'admin',
  owner.id,
  'publicou imóvel',
  property.name,
  property.id,
  'property',
  fastify.log.warn.bind(fastify.log),
);

// ADICIONAR no lugar:
await logActivityHelper({
  ownerId: property.ownerId,
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'Admin',
  action: 'property_created',
  subjectType: 'property',
  subjectId: property.id,
  subject: property.name,
}).catch(fastify.log.warn.bind(fastify.log));
```

**Mudança (3) — DELETE /admin/properties/:id:**
```ts
// ANTES:
const existing = await prisma.property.findUnique({ where: { id }, select: { id: true } });
if (!existing) return reply.status(404).send({ error: 'Property not found' });

await prisma.property.update({ where: { id }, data: { status: 'archived', active: false } });
await redis.del(`property:${id}`);

return reply.send({ success: true });

// DEPOIS:
const existing = await prisma.property.findUnique({
  where: { id },
  select: { id: true, name: true, ownerId: true },
});
if (!existing) return reply.status(404).send({ error: 'Property not found' });

await prisma.property.update({ where: { id }, data: { status: 'archived', active: false } });
await redis.del(`property:${id}`);

await logActivityHelper({
  ownerId: existing.ownerId,
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'Admin',
  action: 'property_archived',
  subjectType: 'property',
  subjectId: id,
  subject: existing.name,
}).catch(fastify.log.warn.bind(fastify.log));

return reply.send({ success: true });
```

**Antes de implementar:** verificar assinatura atual de `logActivity` em `apps/bot/src/services/activity.ts` para garantir que o objeto passado está correto.

**Critério de pronto:**
- [ ] Import `logActivityHelper` adicionado (ou já existia do Slice 1 — verificar)
- [ ] `POST /admin/properties` não usa mais o `logActivity` local com string livre
- [ ] `logActivityHelper` chamado com `action: 'property_created'` no POST
- [ ] `findUnique` no DELETE inclui `name` e `ownerId` no select
- [ ] `logActivityHelper` chamado com `action: 'property_archived'` no DELETE
- [ ] Ambos os logs são fire-and-forget (`.catch(warn)`)
- [ ] `bunx tsc --noEmit` verde em `apps/bot`
- [ ] `bun run lint:bot` — 0 novos errors
- [ ] `bun test src/__tests__` — todos passam

**Verificação:**
```bash
cd apps/bot && bunx tsc --noEmit
cd apps/bot && bun run lint:bot
cd apps/bot && bun test src/__tests__
```

**Dependências:** Slice 0b aplicada (`services/activity.ts` existe).
**Escopo:** S (1 arquivo, ~15 linhas de mudança líquida).

---

## Checkpoint 3 — Após T03

- [ ] `bunx tsc --noEmit` verde em `apps/bot`
- [ ] `bun run lint:bot` — 0 novos errors
- [ ] `bun test src/__tests__` (bot) — todos passam

---

## Fase 4 — ROADMAP

---

### T04 — Atualizar ROADMAP.md com itens já implementados

**Descrição:** Marcar como `[x]` todos os itens do ROADMAP que já estão implementados no código mas permanecem com `[ ]`:

**Slice 1 — Itens de cleanup (confirmados via inspeção de código):**
- Labels corretas das colunas kanban (já em `index.tsx` linha 23–27)
- Tabela: colunas nome + source + property + stage + updatedAt (já em `TableView`)
- Header: botões Filtros (stub) + Novo lead (stub) (já implementados)

**Slice 2 — Itens já implementados antes desta slice:**
- `Property.area float` — campo existe como `Float?` em `schema.prisma`
- `Property.status` enum normalizado — string no banco, normalização feita via tipo
- `Bot: aceitar area em POST /admin/properties allowlist` — `area` já está em `PROPERTY_PATCH_FIELDS`
- `Web: fetchProperties() retorna area` — já retorna via tipo `Property`
- `Web: card grid — externalId mono muted + endereço completo + status pill overlaid + área` — já implementado em `property-card.tsx`
- `Web: card row — externalId, neighborhood, área` — já implementado
- `Web: header — botão Filtros (stub) + toggle ícones grid/lista` — já implementado
- `Web: tabs pill-style com counts inline` — já implementado

**Arquivo afetado:**
- `ROADMAP.md`

**Critério de pronto:**
- [ ] Todos os itens listados acima marcados `[x]` no ROADMAP
- [ ] Tracking macro atualizado: `F1 — Vertical slices | 1/9` (Slice 1 completa)
- [ ] Nenhum item incorretamente marcado (verificar apenas o que realmente existe no código)

**Verificação:**
```bash
# Review visual do ROADMAP após edição
```

**Dependências:** Nenhuma (ROADMAP é documentação).
**Escopo:** XS (1 arquivo, edições de marcação).

---

## Checkpoint Final

- [ ] `bunx tsc --noEmit` verde nos 3 pacotes
- [ ] `bun run lint:bot` — 0 novos errors
- [ ] `bun test src/__tests__` (bot) — todos passam
- [ ] `vitest run` (web) — todos passam
- [ ] ROADMAP atualizado e consistente com código
- [ ] Critérios de aceite do spec verificados (seção 9 de `specs/properties.md`)

---

## Resumo de arquivos afetados

| Arquivo | Task | Operação |
|---|---|---|
| `packages/types/src/property.ts` | T01 | Editar (1 linha) |
| `apps/web/src/components/property-card.tsx` | T02 | Editar (1 linha) |
| `apps/bot/src/routes/admin.ts` | T03 | Editar (~15 linhas) |
| `ROADMAP.md` | T04 | Editar (marcação) |

**Total: 4 arquivos — 1 tipo, 1 componente, 1 endpoint, 1 doc.**

---

## Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| `logActivityHelper` já importado do Slice 1 | Baixo | Verificar se import já existe antes de adicionar |
| Assinatura de `logActivity` em `services/activity.ts` diferente do esperado | Médio | Ler o arquivo antes de implementar T03 |
| `'archived'` no tipo causa erros em outros componentes que usam `Property['status']` | Baixo | `tsc --noEmit` no checkpoint 1 revela imediatamente |
