# Spec: Slice 2 — Properties (CRUD completo + UI)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 2.
> Depende de: Slice 0a (schema), Slice 0b (helpers), Slice 1 (leads done).
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Completar o pipeline de imóveis ponta-a-ponta: tipos consistentes (incluindo `archived`), activity log nos dois eventos críticos (`property_created` e `property_archived`) usando o helper atualizado, e manter o ROADMAP sincronizado com o estado real do código.

**Usuário alvo:** proprietário logado no admin (apps/web).

**Sucesso:** toda criação e arquivamento de imóvel emite activity log com a convenção correta (snake_case, actorType, subjectType), e o sistema de tipos não contém gaps (status `archived` tipado).

---

## 2. Escopo

### Dentro

**Types (`packages/types/src/property.ts`)**
- Adicionar `'archived'` ao union `Property['status']`
- Resultado: `'available' | 'rented' | 'maintenance' | 'reserved' | 'archived'` (alinha com BRAINSTORM B7)

**Web — `PropertyCard` (`apps/web/src/components/property-card.tsx`)**
- Adicionar `archived` ao `STATUS_CONFIG`:
  ```ts
  archived: { tone: 'bad', label: 'Arquivado' }
  ```
  > Nota: card nunca exibe archived (filtrado na query com `.neq('status','archived')`), mas o tipo exige entrada completa no record — TypeScript falha sem ela.

**Bot — `POST /admin/properties` (`apps/bot/src/routes/admin.ts`)**
- Substituir chamada ao `logActivity` local (formato antigo, string livre `'publicou imóvel'`) por `logActivityHelper` importado de `@/services/activity`:
  ```ts
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

**Bot — `DELETE /admin/properties/:id` (`apps/bot/src/routes/admin.ts`)**
- Adicionar `logActivityHelper` após o soft-delete:
  ```ts
  const existing = /* já buscado */ await prisma.property.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true },
  });
  // ... soft-delete ...
  await logActivityHelper({
    ownerId: existing.ownerId,
    actorType: 'user',
    actorLabel: request.adminUserId ?? 'Admin',
    action: 'property_archived',
    subjectType: 'property',
    subjectId: id,
    subject: existing.name,
  }).catch(fastify.log.warn.bind(fastify.log));
  ```
  > O `findUnique` atual só seleciona `{ id: true }` — precisará adicionar `name` e `ownerId` ao select para o log.

**ROADMAP — marcar como `[x]` itens já implementados**
- Itens já presentes no código (confirmados por inspeção):
  - `area Float?` no schema e no tipo (`Property.area: number | null`)
  - `area` no `PROPERTY_PATCH_FIELDS` (allowlist do PATCH)
  - `fetchProperties()` retorna `area`
  - Card grid: externalId mono muted + endereço + status pill overlaid + área
  - Card row: externalId, neighborhood, área
  - Header: botão Filtros (stub) + toggle grid/lista
  - Tabs pill-style com counts inline
- Slice 1 cleanup (confirmado como done):
  - Labels corretas das colunas kanban: Novo / Qualificação / Visita agendada / Proposta / Ganho
  - Tabela: colunas nome + source + property + stage + updatedAt
  - Header: botões Filtros (stub) + Novo lead (stub)

### Fora

- `$propertyId.tsx` (detalhe) — sem mudança nesta slice
- `new.tsx` (formulário novo) — sem mudança nesta slice
- `PATCH /admin/properties/:id` activity log — não está no ROADMAP para este slice
- `area` migration — campo já existe como `Float?`; tornar NOT NULL está fora de scope (nenhuma decisão tomada sobre default)
- `area` display no formulário de criação/edição — out of scope
- RLS em Property — out of scope (Fase 2)
- Filtros reais de Properties (atualmente stub) — out of scope

---

## 3. Schema changes

**Nenhuma migration necessária.**

- `Property.area` já existe como `Float?` no schema Prisma
- `Property.status` é `String` (sem enum DB-level) — correto, sem alteração

A normalização nesta slice é apenas no **tipo TypeScript**, não no banco.

---

## 4. Tipos compartilhados (`packages/types/src/property.ts`)

### Antes
```ts
status: 'available' | 'rented' | 'maintenance' | 'reserved';
```

### Depois
```ts
status: 'available' | 'rented' | 'maintenance' | 'reserved' | 'archived';
```

Nenhum outro campo do tipo `Property` muda.

---

## 5. Bot changes

### 5.1 — `routes/admin.ts`: import `logActivityHelper`

Adicionar import no topo do arquivo (se ainda não existir):
```ts
import { logActivity as logActivityHelper } from '@/services/activity';
```

> `admin.ts` já tem uma função local `logActivity` com assinatura diferente (legado). O alias `logActivityHelper` evita colisão — mesmo padrão usado em Slice 1.

### 5.2 — `POST /admin/properties`: substituir log

Remover a chamada existente ao `logActivity` local (linha ~411):
```ts
// REMOVER:
logActivity(
  request.adminUserId ?? 'admin',
  owner.id,
  'publicou imóvel',
  property.name,
  property.id,
  'property',
  fastify.log.warn.bind(fastify.log),
);
```

Substituir por:
```ts
// ADICIONAR:
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

### 5.3 — `DELETE /admin/properties/:id`: adicionar log + expandir select

O `findUnique` atual seleciona só `{ id: true }`. Expandir para incluir `name` e `ownerId`:
```ts
// ANTES:
const existing = await prisma.property.findUnique({ where: { id }, select: { id: true } });

// DEPOIS:
const existing = await prisma.property.findUnique({
  where: { id },
  select: { id: true, name: true, ownerId: true },
});
```

Após o soft-delete, adicionar:
```ts
await logActivityHelper({
  ownerId: existing.ownerId,
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'Admin',
  action: 'property_archived',
  subjectType: 'property',
  subjectId: id,
  subject: existing.name,
}).catch(fastify.log.warn.bind(fastify.log));
```

---

## 6. Web changes

### 6.1 — `PropertyCard` STATUS_CONFIG

Adicionar entrada faltante:
```ts
const STATUS_CONFIG: Record<Property['status'], { tone: Tone; label: string }> = {
  available:   { tone: 'ok',      label: 'Disponível' },
  rented:      { tone: 'accent',  label: 'Alugado'    },
  maintenance: { tone: 'warn',    label: 'Manutenção' },
  reserved:    { tone: 'default', label: 'Reservado'  },
  archived:    { tone: 'bad',     label: 'Arquivado'  },  // ← ADICIONAR
};
```

**Sem mudança visual** — a query `.neq('status','archived')` impede que cards arquivados apareçam. A entrada é necessária apenas para satisfazer o `Record<Property['status'], ...>`.

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `property_created` | `user` | `property` | Bot: `POST /admin/properties` (substitui chamada antiga) |
| `property_archived` | `user` | `property` | Bot: `DELETE /admin/properties/:id` (novo) |

> Convenção conforme BRAINSTORM §5 C3: snake_case, sem acento, sem espaço.

---

## 8. Notificações

Nenhuma. Esta slice não dispara notificações WhatsApp, email ou in-app.

---

## 9. Critérios de aceite

### Types
- [ ] `Property['status']` inclui `'archived'` no union
- [ ] `PropertyCard STATUS_CONFIG` tem entrada para `'archived'`
- [ ] `bunx tsc --noEmit` verde em `packages/types`, `apps/bot`, `apps/web`

### Bot — `property_created`
- [ ] `POST /admin/properties` não usa mais o `logActivity` local com string livre
- [ ] `logActivityHelper` chamado com `action: 'property_created'`, `subjectType: 'property'`
- [ ] Log é fire-and-forget (`.catch(warn)` — não quebra o endpoint se falhar)
- [ ] Resposta do endpoint mantém o mesmo shape (`{ success: true, id, property }`)

### Bot — `property_archived`
- [ ] `DELETE /admin/properties/:id` chama `logActivityHelper` com `action: 'property_archived'`
- [ ] `findUnique` no DELETE seleciona `name` e `ownerId` além de `id`
- [ ] Log é fire-and-forget

### Lint e tipos
- [ ] `bun run lint:bot` — 0 novos errors
- [ ] `bun test src/__tests__` (bot) — todos passam (sem regressão)
- [ ] `vitest run` (web) — todos passam (sem regressão)

### ROADMAP
- [ ] Itens já implementados marcados `[x]` no ROADMAP
- [ ] Slice 1 cleanup marcado `[x]` no ROADMAP

---

## 10. Riscos / edge cases

### R1 — Colisão de nomes `logActivity` em admin.ts
`admin.ts` já tem uma função local `logActivity` com assinatura legada.
**Mitigação:** import com alias `logActivityHelper` — padrão já adotado em Slice 1 (R6 do spec de leads).

### R2 — `existing` null no DELETE antes do log
Se o `findUnique` retornar `null` (property não existe), o endpoint já retorna 404 antes do log.
**Mitigação:** o fluxo atual já tem `if (!existing) return reply.status(404)...` — só adicionar `name` e `ownerId` ao select, sem lógica nova.

### R3 — `archived` nunca exibido visualmente
O `STATUS_CONFIG` terá `archived` mas ele nunca renderiza (filtrado na query).
**Mitigação:** comportamento correto por design — a entrada no record é necessária só para satisfazer TypeScript.

### R4 — `logActivityHelper` signature mudou entre slices
Se `services/activity.ts` foi alterado após Slice 1, o import/signature pode diferir.
**Mitigação:** verificar `apps/bot/src/services/activity.ts` antes de implementar a task.

---

## 11. Dependências / pré-condições

- Slice 0b aplicada: `logActivity` helper em `services/activity.ts` existe com assinatura `{ownerId, actorType, actorLabel, action, subjectType, subjectId, subject}`
- Slice 1 aplicada: import alias `logActivityHelper` já foi estabelecido como padrão em `admin.ts`
- Bot e web rodam sem erros antes desta slice

---

## 12. Out of scope (explícito)

- Migration `area NOT NULL`
- `PATCH /admin/properties/:id` activity log
- Detalhe do imóvel (`$propertyId.tsx`) e formulário de criação (`new.tsx`)
- RLS em Property
- Filtros reais
- Email, WhatsApp, notificações in-app
