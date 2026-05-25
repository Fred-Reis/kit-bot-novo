# Plano: Slice 6 — Rules (UI completion + bot integration + activity logs)

> Spec: [specs/rules.md](../specs/rules.md)
> Pipeline: /spec ✅ → /plan ✅ → /build → /simplify → /review → COMMIT

---

## Visão geral

Três frentes independentes com dependências simples:

```
T01 (types + queries + chip rendering)
    │
    ├─→ T02 (api.ts link/unlink)
    │       │
    │       └─→ T03 (vincular/desvincular UI)
    │
    └─→ CHECKPOINT 1
             │
             ├─→ T04 (activity log: rule_set_created)
             ├─→ T05 (activity log: rule_set_linked)
             │
             └─→ CHECKPOINT 2
                      │
                      └─→ T06 (catalog.ts: policies no contexto)
                               │
                               └─→ CHECKPOINT 3
                                        │
                                        └─→ T07 (ROADMAP update)
```

---

## Decisões de arquitetura

- **`linkedPropertyIds: string[]` → `linkedProperties: { propertyId, externalId }[]`** — breaking change isolada a 3 arquivos (types, queries, rules/index). Necessária para que o botão `×` saiba qual `propertyId` enviar ao endpoint DELETE.
- **Policies cacheadas com o imóvel** — incluso no cache Redis de 10 min. Staleness aceitável para MVP. Botão "Limpar cache" já existe.
- **Fire-and-forget para logActivity** — padrão existente no projeto (`.catch(fastify.log.warn.bind(fastify.log))`).
- **`listAvailableProperties()` sem policies** — usada apenas para o bot exibir opções ao lead; não precisa de policies. Só `getProperty()` e `getPropertyByExternalId()` incluem policies.

---

## Fase 1 — Types e base web

### T01 — Atualizar `RuleSetDetail` e adaptar consumidores

**Descrição:** Renomear `linkedPropertyIds: string[]` para `linkedProperties: { propertyId: string; externalId: string }[]` no tipo compartilhado e atualizar todos os consumidores. Feito em uma única task pois a mudança de tipo quebra o TypeScript até que todos os consumidores sejam atualizados.

**Arquivos:**
- `packages/types/src/rule-set.ts`
- `apps/web/src/lib/queries.ts`
- `apps/web/src/routes/_dashboard/rules/index.tsx`

**O que muda:**

`packages/types/src/rule-set.ts`:
```ts
// Adicionar antes de RuleSetDetail
export interface LinkedProperty {
  propertyId: string;
  externalId: string;
}

// Mudar em RuleSetDetail
export interface RuleSetDetail extends RuleSet {
  policies: RuleSetPolicy[];
  linkedProperties: LinkedProperty[]; // era: linkedPropertyIds: string[]
}
```

`apps/web/src/lib/queries.ts` — `fetchRuleSet`:
```ts
type LinkRow = { propertyId: string; property: { externalId: string }[] };
return {
  ...(rs as RuleSetDetail),
  policies: (policies ?? []) as RuleSetDetail['policies'],
  linkedProperties: (links ?? []).map((l) => {
    const row = l as unknown as LinkRow;
    return {
      propertyId: row.propertyId,
      externalId: row.property[0]?.externalId ?? row.propertyId,
    };
  }),
};
```

`apps/web/src/routes/_dashboard/rules/index.tsx` — chips no reuso panel:
```tsx
// Antes: detail.linkedPropertyIds.map((pid) => <span key={pid}>{pid}</span>)
// Depois: detail.linkedProperties.map(({ propertyId, externalId }) => <span key={propertyId}>{externalId}</span>)
```
(ainda read-only — botão `×` vem no T03)

**Critérios de aceite:**
- [x] `LinkedProperty` exportado de `packages/types`
- [x] `RuleSetDetail.linkedProperties` tipado como `LinkedProperty[]`
- [x] `fetchRuleSet` retorna `linkedProperties` com `propertyId` (UUID) e `externalId`
- [x] Chips no reuso panel renderizam sem erro de TypeScript

**Verificação:** `bunx tsc --noEmit` em `packages/types` + `apps/web` — ambos verdes. `bunx oxlint apps/web/src` — sem warnings novos.

---

### T02 — Adicionar `linkProperty` e `unlinkProperty` em `api.ts`

**Descrição:** Dois novos métodos no objeto `adminApi` para chamar os endpoints bot existentes de vincular e desvincular imóvel de um rule set.

**Arquivo:**
- `apps/web/src/lib/api.ts`

**O que adicionar após `deletePolicy`:**
```ts
linkProperty: (ruleSetId: string, propertyId: string) =>
  botApi.post(`/admin/rule-sets/${ruleSetId}/properties`, { propertyId }),

unlinkProperty: (ruleSetId: string, propertyId: string) =>
  botApi.delete(`/admin/rule-sets/${ruleSetId}/properties/${propertyId}`),
```

**Critérios de aceite:**
- [x] `adminApi.linkProperty` e `adminApi.unlinkProperty` exportados e tipados

**Verificação:** `bunx tsc --noEmit` em `apps/web` — verde.

---

### T03 — UI vincular/desvincular no reuso panel

**Descrição:** Completar o reuso panel com chips clicáveis (botão `×` para desvincular) e um formulário de seleção para vincular novos imóveis. Usa `fetchProperties()` (já existe) para popular o select com imóveis não vinculados.

**Arquivo:**
- `apps/web/src/routes/_dashboard/rules/index.tsx`

**Novos componentes:**

`UnlinkPropertyButton` (inline no chip):
```tsx
function UnlinkPropertyButton({ ruleSetId, propertyId, externalId }: {
  ruleSetId: string; propertyId: string; externalId: string;
}) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => adminApi.unlinkProperty(ruleSetId, propertyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
      toast.success('Imóvel desvinculado');
    },
    onError: () => toast.error('Falha ao desvincular'),
  });
  return (
    <button type="button" aria-label={`Desvincular ${externalId}`}
      disabled={mutation.isPending} onClick={() => mutation.mutate()}
      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive transition-colors"
    >
      <X className="size-2.5" />
    </button>
  );
}
```

`LinkPropertyForm`:
```tsx
function LinkPropertyForm({ ruleSetId, linkedPropertyIds }: {
  ruleSetId: string; linkedPropertyIds: string[];
}) {
  const [selectedId, setSelectedId] = useState('');
  const qc = useQueryClient();
  const { data: properties = [] } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  });
  const available = properties.filter((p) => !linkedPropertyIds.includes(p.id));
  const mutation = useMutation({
    mutationFn: () => adminApi.linkProperty(ruleSetId, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rule-set', ruleSetId] });
      setSelectedId('');
      toast.success('Imóvel vinculado');
    },
    onError: () => toast.error('Falha ao vincular imóvel'),
  });
  if (available.length === 0) return null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (selectedId) mutation.mutate(); }}
      className="flex gap-2 pt-1">
      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <option value="">Selecionar imóvel...</option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.externalId} — {p.name}
          </option>
        ))}
      </select>
      <CustomButton type="submit" variant="secondary" size="sm"
        disabled={!selectedId || mutation.isPending}>
        <Plus className="size-3" />
        Vincular
      </CustomButton>
    </form>
  );
}
```

Substituir seção "Em uso" no reuso panel:
```tsx
<div>
  <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
    Em uso
  </p>
  <div className="flex flex-wrap gap-1.5">
    {detail.linkedProperties.map(({ propertyId, externalId }) => (
      <div key={propertyId}
        className="flex items-center gap-0.5 rounded-full bg-muted pl-2 pr-1 py-0.5">
        <span className="text-[11px] font-mono text-muted-foreground">{externalId}</span>
        <UnlinkPropertyButton ruleSetId={detail.id} propertyId={propertyId} externalId={externalId} />
      </div>
    ))}
  </div>
  <LinkPropertyForm
    ruleSetId={detail.id}
    linkedPropertyIds={detail.linkedProperties.map((lp) => lp.propertyId)}
  />
</div>
```

Adicionar `X` ao import de `lucide-react`:
```ts
import { Plus, Trash2, X } from 'lucide-react';
```

Adicionar `fetchProperties` ao import de `@/lib/queries`:
```ts
import { fetchRuleSets, fetchRuleSet, fetchProperties } from '@/lib/queries';
```

**Critérios de aceite:**
- [x] Chips mostram `externalId` com botão `×`
- [x] Clicar `×`: chip desaparece, toast "Imóvel desvinculado"
- [x] Select mostra apenas imóveis NÃO vinculados
- [x] Vincular: chip aparece, select reseta, toast "Imóvel vinculado"
- [x] Se todos os imóveis já vinculados: `LinkPropertyForm` não renderiza
- [x] Botões desabilitados durante loading

**Verificação:** `bunx tsc --noEmit` em `apps/web` — verde. `bunx oxlint apps/web/src` — sem warnings novos.

---

## CHECKPOINT 1 — Web vincular/desvincular

- [x] `bunx tsc --noEmit` verde em `apps/web`
- [x] `bunx tsc --noEmit` verde em `packages/types`
- [x] `bunx oxlint` sem novos warnings
- [x] Teste manual: vincular imóvel → chip aparece; clicar `×` → chip some

---

## Fase 2 — Activity logs no bot

### T04 — `rule_set_created` em `POST /admin/rule-sets`

**Descrição:** Adicionar chamada fire-and-forget a `logActivityHelper` após criar o rule set. O `ownerId` já vem do `prisma.owner.findFirst()` que o endpoint já usa.

**Arquivo:**
- `apps/bot/src/routes/admin.ts`

**Onde:** após `return reply.status(201).send(ruleSet);` → inserir ANTES do return:
```ts
logActivityHelper({
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'admin',
  ownerId: ruleSet.ownerId,
  action: 'rule_set_created',
  subject: ruleSet.name,
  subjectId: ruleSet.id,
  subjectType: 'rule_set',
}).catch(fastify.log.warn.bind(fastify.log));
```

**Critérios de aceite:**
- [x] `rule_set_created` emitido após criação (fire-and-forget)
- [x] Falha no log não quebra o endpoint (`.catch`)

**Verificação:** `bunx tsc --noEmit` em `apps/bot` — verde.

---

### T05 — `rule_set_linked` em `POST /admin/rule-sets/:id/properties`

**Descrição:** O endpoint de vincular property não busca o rule set — adicionar lookup para obter `ownerId` e `name`, depois emitir log. Também adiciona 404 guard (bom para robustez).

**Arquivo:**
- `apps/bot/src/routes/admin.ts`

**Mudança no endpoint `POST /admin/rule-sets/:id/properties`:**
```ts
// Antes do create:
const ruleSet = await prisma.ruleSet.findUnique({
  where: { id },
  select: { ownerId: true, name: true },
});
if (!ruleSet) return reply.status(404).send({ error: 'Rule set not found' });

// ...prisma.propertyRuleSet.create existente...

// Após o create:
logActivityHelper({
  actorType: 'user',
  actorLabel: request.adminUserId ?? 'admin',
  ownerId: ruleSet.ownerId,
  action: 'rule_set_linked',
  subject: ruleSet.name,
  subjectId: id,
  subjectType: 'rule_set',
  metadata: { propertyId },
}).catch(fastify.log.warn.bind(fastify.log));
```

**Critérios de aceite:**
- [x] `rule_set_linked` emitido após vincular property (fire-and-forget)
- [x] Retorna 404 se rule set não existe
- [x] `metadata.propertyId` presente no log
- [x] Falha no log não quebra o endpoint

**Verificação:** `bunx tsc --noEmit` em `apps/bot` — verde.

---

## CHECKPOINT 2 — Activity logs

- [x] `bunx tsc --noEmit` verde em `apps/bot`
- [x] `bunx oxlint` sem novos warnings
- [x] (Opcional) criar rule set e vincular property — verificar entradas em `ActivityLog` no Supabase

---

## Fase 3 — Bot: policies no contexto do agente

### T06 — Estender `catalog.ts` para incluir policies

**Descrição:** Três mudanças coordenadas no mesmo arquivo: (1) novo tipo `PolicyEntry` + estender `PropertyData`; (2) include `ruleSets → ruleSet → policies` nas queries `getProperty()` e `getPropertyByExternalId()`; (3) formatar policies em `describeProperty()` e `describePropertyTerms()`.

> **`listAvailableProperties()`** — não inclui policies (usada para listar opções ao lead, não precisa de policies).

**Arquivo:**
- `apps/bot/src/services/catalog.ts`

**1. Tipos:**
```ts
export interface PolicyEntry {
  name: string;
  value: 'yes' | 'no' | 'conditional';
}

export interface PropertyData extends Property {
  media: PropertyMedia[];
  policies: PolicyEntry[];
}
```

**2. Include nas queries (getProperty e getPropertyByExternalId):**
```ts
include: {
  media: { orderBy: { order: 'asc' } },
  ruleSets: {
    include: {
      ruleSet: {
        include: {
          policies: {
            where: { appliesToProperty: true },
            orderBy: { name: 'asc' },
          },
        },
      },
    },
  },
},
```

Flatten após query:
```ts
const flatPolicies: PolicyEntry[] = (property.ruleSets ?? []).flatMap(
  (prs) => prs.ruleSet.policies.map((p) => ({
    name: p.name,
    value: p.value as PolicyEntry['value'],
  }))
);
// Em vez de: return property as PropertyData
return { ...property, policies: flatPolicies } as PropertyData;
```

Para `listAvailableProperties()` — adicionar `policies: []` no retorno (mantém tipo `PropertyData`):
```ts
return properties.map((p) => ({ ...p, policies: [] })) as PropertyData[];
```

**3. Formatar em `describeProperty()` e `describePropertyTerms()`:**

Adicionar no final, antes do `return`:
```ts
if (p.policies.length > 0) {
  const VALUE_PT = { yes: 'sim', no: 'nao', conditional: 'condicional' } as const;
  const lines = p.policies.map((pl) => `  ${pl.name}: ${VALUE_PT[pl.value]}`).join('\n');
  facts.push(`Politicas vinculadas:\n${lines}`);
}
```

**Critérios de aceite:**
- [x] `PropertyData.policies` tipado como `PolicyEntry[]`
- [x] `getProperty()` retorna policies com `appliesToProperty: true` do(s) rule set(s) vinculado(s)
- [x] Imóvel sem rule set: `policies = []`, nenhuma linha "Politicas" no describe
- [x] Imóvel com rule set: `describeProperty()` inclui bloco "Politicas vinculadas:"
- [x] `listAvailableProperties()` inclui policies via POLICY_INCLUDE (corrigido no review)
- [x] Prisma type check correto (sem `as any`)

**Verificação:** `bunx tsc --noEmit` em `apps/bot` — verde. `bunx oxlint apps/bot/src` — sem warnings novos.

---

## CHECKPOINT 3 — Bot integration

- [x] `bunx tsc --noEmit` verde em `apps/bot`
- [x] `bunx oxlint` sem novos warnings
- [x] Smoke test mental: imóvel com rule set com 2 policies → `describeProperty()` inclui as 2 linhas

---

## Fase 4 — Fechamento

### T07 — Atualizar ROADMAP.md

**Descrição:** Marcar todos os itens da Slice 6 como `[x]` no ROADMAP.md.

**Arquivo:**
- `ROADMAP.md`

Itens a marcar `[x]`:
```markdown
- [x] Web: labels corretas das tabs (Políticas / Blocos reutilizáveis / Templates completos / Campos estruturados)
- [x] Web: políticas tab — 3-way toggle (Sim/Não/Cond) por policy
- [x] Web: políticas tab — "Aplica ao imóvel" toggle por policy
- [x] Web: reuso panel — propagação flags + lista de propriedades vinculadas (chips com externalId)
- [x] Bot: usar policies do rule set vinculado nas respostas (`info` agent já lê via `catalog.ts`?)
- [x] Activity log: `rule_set_created`, `rule_set_linked`
- [x] Commit
```

Também atualizar o tracking macro no final do ROADMAP:
```markdown
| F1 — Vertical slices | 6/9 (Slice 1 ✓, ..., Slice 6 ✓) | 67% |
```

**Critérios de aceite:**
- [x] Todos os 7 itens da Slice 6 marcados `[x]`
- [x] Tracking macro atualizado

**Verificação:** inspeção visual do ROADMAP.

---

## Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Prisma type para `ruleSets` include complexo | Médio | Verificar `bunx tsc --noEmit` após T06; o campo `ruleSets` existe no schema (`Property.ruleSets PropertyRuleSet[]`) |
| `linkedPropertyIds` em outros arquivos não identificados | Baixo | Rodar `grep -r linkedPropertyIds` antes de completar T01 |
| `fetchProperties` retorna `Property` sem `id` tipado | Baixo | A interface `Property` já tem `id: string` |
| `request.adminUserId` undefined causa `actorLabel: 'admin'` | Baixo | Padrão existente em todas as outras chamadas — aceitável |

---

## Resumo

| Task | Arquivo(s) | Tamanho | Depende de |
|---|---|---|---|
| T01 | types + queries + rules/index | M (3 arquivos) | — |
| T02 | api.ts | S | T01 |
| T03 | rules/index.tsx | M | T01, T02 |
| T04 | admin.ts | S | — |
| T05 | admin.ts | S | — |
| T06 | catalog.ts | M | — |
| T07 | ROADMAP.md | XS | T01–T06 |

**Total: 7 tasks, ~9 arquivos afetados.**
