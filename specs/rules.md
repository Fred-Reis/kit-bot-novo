# Spec: Slice 6 — Rules (UI completion + bot integration + activity logs)

> Sliced de [ROADMAP.md](../ROADMAP.md) Fase 1, Slice 6.
> Depende de: Slices 1–5, Foundation F0.2 (logActivity helper).
> Pipeline: /spec → /plan → /build → /simplify → /review → COMMIT.

---

## 1. Objetivo

Completar a feature de Regras ponta-a-ponta em três frentes:

1. **Vincular/desvincular imóveis** — o painel de reuso exibe chips read-only hoje; adicionar UI funcional (select + botão vincular + botão `×` nos chips).
2. **Bot integration** — `describeProperty()` e `describePropertyTerms()` passam a incluir as policies estruturadas do rule set vinculado, para que o agente `info` possa responder corretamente ("Aceita fumantes: Não", etc.).
3. **Activity logs** — emitir `rule_set_created` e `rule_set_linked` nos endpoints do bot que hoje não os emitem.

**Nota:** a maior parte do web UI já foi implementada em sessões anteriores (tab labels, 3-way toggle, "Aplica ao imóvel" toggle, propagation flags, chips com externalId). O ROADMAP não foi atualizado para refletir isso — esta slice fecha o que falta.

**Usuário alvo:** proprietário logado no admin (apps/web).

**Sucesso:** owner vincula imóvel a um rule set pelo painel de reuso; ao receber nova mensagem do lead perguntando sobre políticas, o bot responde com as policies corretas do rule set; cada ação de criar/vincular gera entrada no activity log.

---

## 2. Escopo

### Dentro

- `packages/types/src/rule-set.ts` — renomear `linkedPropertyIds: string[]` para `linkedProperties: { propertyId: string; externalId: string }[]`
- `apps/web/src/lib/queries.ts` — `fetchRuleSet`: retornar `linkedProperties` com ambos os campos
- `apps/web/src/lib/api.ts` — adicionar `linkProperty`, `unlinkProperty`
- `apps/web/src/routes/_dashboard/rules/index.tsx` — reuso panel: chips com botão `×` + select de imóveis + botão vincular
- `apps/bot/src/services/catalog.ts` — `PropertyData`: adicionar campo `policies`; `getProperty()`, `getPropertyByExternalId()`, `listAvailableProperties()`: include rule set policies; `describeProperty()` e `describePropertyTerms()`: formatar policies
- `apps/bot/src/routes/admin.ts` — `POST /admin/rule-sets`: emitir `rule_set_created`; `POST /admin/rule-sets/:id/properties`: emitir `rule_set_linked`
- ROADMAP: marcar Slice 6 como `[x]`

### Fora

- Propagação real das policies entre imóveis (B10 — UI existe, sem efeito)
- Cache invalidation ao mudar policy (10 min staleness OK para MVP — botão "Limpar cache" manual existe)
- Testes de integração com banco real
- RLS
- Edição inline de nome/descrição da policy
- Histórico de mudanças de policy
- Propagação de rule set entre imóveis

---

## 3. Schema changes

Nenhuma migration necessária. Todos os modelos já existem: `RuleSet`, `RuleSetPolicy`, `PropertyRuleSet`.

---

## 4. Tipos compartilhados (`packages/types`)

**`packages/types/src/rule-set.ts`** — mudar `linkedPropertyIds` para `linkedProperties`:

```ts
// Antes
export interface RuleSetDetail extends RuleSet {
  policies: RuleSetPolicy[];
  linkedPropertyIds: string[];
}

// Depois
export interface LinkedProperty {
  propertyId: string;
  externalId: string;
}

export interface RuleSetDetail extends RuleSet {
  policies: RuleSetPolicy[];
  linkedProperties: LinkedProperty[];
}
```

**Impacto:** único consumidor é `apps/web/src/lib/queries.ts` (fetchRuleSet) e `apps/web/src/routes/_dashboard/rules/index.tsx`. Ambos serão atualizados nesta slice.

---

## 5. Bot changes

### 5.1 — `apps/bot/src/services/catalog.ts`

**Estender `PropertyData`:**

```ts
import type { PropertyMedia, RuleSetPolicy } from '@prisma/client';

export interface PolicyEntry {
  name: string;
  value: 'yes' | 'no' | 'conditional';
}

export interface PropertyData extends Property {
  media: PropertyMedia[];
  policies: PolicyEntry[];
}
```

**Estender queries Prisma** (em `getProperty`, `getPropertyByExternalId`, `listAvailableProperties`) para incluir policies com `appliesToProperty: true`:

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

Após a query, flatten e adicionar ao objeto retornado:

```ts
const flatPolicies: PolicyEntry[] = (property.ruleSets ?? []).flatMap(
  (prs) => prs.ruleSet.policies.map((p) => ({ name: p.name, value: p.value as PolicyEntry['value'] }))
);
const propertyData: PropertyData = { ...property, policies: flatPolicies };
```

**Cache:** o objeto com `policies` é cacheado junto. Staleness máxima: 10 min (TTL existente). Invalidação manual via `invalidatePropertyCache()` / botão "Limpar cache" no admin.

**Adicionar policies em `describeProperty()`:**

```ts
if (p.policies.length > 0) {
  const VALUE_PT: Record<PolicyEntry['value'], string> = { yes: 'sim', no: 'nao', conditional: 'condicional' };
  const lines = p.policies.map((pl) => `  ${pl.name}: ${VALUE_PT[pl.value]}`).join('\n');
  facts.push(`Politicas vinculadas:\n${lines}`);
}
```

Same in `describePropertyTerms()`.

### 5.2 — `apps/bot/src/routes/admin.ts`

**`POST /admin/rule-sets` — emitir `rule_set_created`:**

Após `prisma.ruleSet.create(...)`:

```ts
logActivityHelper({
  actorType: 'user',
  actorLabel: request.adminEmail ?? 'admin',
  ownerId: ruleSet.ownerId,
  action: 'rule_set_created',
  subjectLabel: ruleSet.name,
  subjectId: ruleSet.id,
  subjectType: 'rule_set',
  logFn: fastify.log.warn.bind(fastify.log),
});
```

**`POST /admin/rule-sets/:id/properties` — emitir `rule_set_linked`:**

Após `prisma.propertyRuleSet.create(...)`, buscar `ruleSet` para obter `ownerId` e `name`, então:

```ts
logActivityHelper({
  actorType: 'user',
  actorLabel: request.adminEmail ?? 'admin',
  ownerId: ruleSet.ownerId,
  action: 'rule_set_linked',
  subjectLabel: ruleSet.name,
  subjectId: id,
  subjectType: 'rule_set',
  metadata: { propertyId },
  logFn: fastify.log.warn.bind(fastify.log),
});
```

---

## 6. Web changes

### 6.1 — `apps/web/src/lib/queries.ts` — `fetchRuleSet`

Atualizar para retornar `linkedProperties: { propertyId: string; externalId: string }[]`:

```ts
export async function fetchRuleSet(id: string): Promise<RuleSetDetail> {
  // ...
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
}
```

### 6.2 — `apps/web/src/lib/api.ts` — novos métodos

```ts
linkProperty: (ruleSetId: string, propertyId: string) =>
  botApi.post(`/admin/rule-sets/${ruleSetId}/properties`, { propertyId }),

unlinkProperty: (ruleSetId: string, propertyId: string) =>
  botApi.delete(`/admin/rule-sets/${ruleSetId}/properties/${propertyId}`),
```

### 6.3 — `apps/web/src/routes/_dashboard/rules/index.tsx` — reuso panel

**Chips com botão `×`** (substituir span read-only):

```tsx
{detail.linkedProperties.map(({ propertyId, externalId }) => (
  <div key={propertyId} className="flex items-center gap-0.5 rounded-full bg-muted pl-2 pr-1 py-0.5">
    <span className="text-[11px] font-mono text-muted-foreground">{externalId}</span>
    <button
      type="button"
      aria-label={`Desvincular ${externalId}`}
      disabled={unlinkMutation.isPending}
      onClick={() => unlinkMutation.mutate({ ruleSetId: detail.id, propertyId })}
      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive transition-colors"
    >
      <X className="size-2.5" />
    </button>
  </div>
))}
```

**Select + botão vincular** (abaixo dos chips):

```tsx
function LinkPropertyForm({ ruleSetId, linkedIds }: { ruleSetId: string; linkedIds: string[] }) {
  const [selectedId, setSelectedId] = useState('');
  const qc = useQueryClient();
  const { data: properties = [] } = useQuery({ queryKey: ['properties'], queryFn: fetchProperties });
  const available = properties.filter((p) => !linkedIds.includes(p.id));

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
    <form onSubmit={(e) => { e.preventDefault(); if (selectedId) mutation.mutate(); }} className="flex gap-2">
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <option value="">Selecionar imóvel...</option>
        {available.map((p) => (
          <option key={p.id} value={p.id}>
            {p.externalId} — {p.name}
          </option>
        ))}
      </select>
      <CustomButton type="submit" variant="secondary" size="sm" disabled={!selectedId || mutation.isPending}>
        <Plus className="size-3" />
        Vincular
      </CustomButton>
    </form>
  );
}
```

`unlinkMutation`:

```ts
const unlinkMutation = useMutation({
  mutationFn: ({ ruleSetId, propertyId }: { ruleSetId: string; propertyId: string }) =>
    adminApi.unlinkProperty(ruleSetId, propertyId),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['rule-set', detail?.id] });
    toast.success('Imóvel desvinculado');
  },
  onError: () => toast.error('Falha ao desvincular'),
});
```

**Atenção:** `fetchProperties` precisa estar disponível. Já existe em `queries.ts` (`fetchProperties()` retorna `Property[]`). A query chave `['properties']` já é usada em outros lugares.

---

## 7. Activity log keys

| Evento | actorType | subjectType | Gatilho |
|---|---|---|---|
| `rule_set_created` | `user` | `rule_set` | Bot: `POST /admin/rule-sets` — após criar |
| `rule_set_linked` | `user` | `rule_set` | Bot: `POST /admin/rule-sets/:id/properties` — após vincular |

---

## 8. Notificações

Nenhuma notificação nova nesta slice.

---

## 9. Critérios de aceite

### Types
- [x] `RuleSetDetail.linkedPropertyIds` removido; `linkedProperties: LinkedProperty[]` adicionado
- [x] `LinkedProperty` exportado de `packages/types`
- [x] `bunx tsc --noEmit` verde em `packages/types`

### Web — queries
- [x] `fetchRuleSet` retorna `linkedProperties` com `propertyId` e `externalId` corretos
- [x] `bunx tsc --noEmit` verde em `apps/web`

### Web — api
- [x] `adminApi.linkProperty(ruleSetId, propertyId)` chama `POST /admin/rule-sets/:id/properties`
- [x] `adminApi.unlinkProperty(ruleSetId, propertyId)` chama `DELETE /admin/rule-sets/:id/properties/:propertyId`

### Web — UI vincular/desvincular
- [x] Chips exibem externalId com botão `×`
- [x] Clicar `×` desvincular imóvel, chip some, toast "Imóvel desvinculado"
- [x] Select mostra apenas imóveis NÃO vinculados
- [x] Selecionar imóvel + clicar Vincular adiciona chip, toast "Imóvel vinculado"
- [x] Se todos os imóveis já estão vinculados, o form de vincular não aparece
- [x] Estados de loading durante as mutations

### Bot — policies no contexto
- [x] `getProperty()` inclui `policies` no retorno
- [x] `PropertyData.policies` contém apenas policies com `appliesToProperty: true`
- [x] `describeProperty()` inclui linha "Politicas vinculadas: ..." quando há policies
- [x] `describePropertyTerms()` idem
- [x] Imóvel sem rule set vinculado: `policies = []`, sem linha no describe
- [x] `bunx tsc --noEmit` verde em `apps/bot`

### Bot — activity logs
- [x] `POST /admin/rule-sets` emite `rule_set_created` (fire-and-forget)
- [x] `POST /admin/rule-sets/:id/properties` emite `rule_set_linked` com `metadata.propertyId`
- [x] Falha no log não quebra os endpoints

### Lint
- [x] `bunx oxlint` — 0 novos warnings em ambos os apps

### ROADMAP
- [x] Todos os itens da Slice 6 marcados `[x]` no ROADMAP

---

## 10. Riscos / edge cases

### R1 — `linkedPropertyIds` renomeado para `linkedProperties`
Mudança breaking no tipo `RuleSetDetail`. Único consumidor é a rota `rules/index.tsx` e `queries.ts` — ambos atualizados nesta slice. Sem outros consumidores.
**Mitigação:** verificar com `grep -r linkedPropertyIds` antes de finalizar.

### R2 — `fetchProperties` em `queries.ts`
O `LinkPropertyForm` usa `fetchProperties()`. Confirmar que essa função existe e retorna `Property[]` com `id`, `externalId` e `name`.
**Mitigação:** grep antes de usar; se assinatura diferente, ajustar o componente.

### R3 — Políticas cacheadas com dados stale
Policies incluídas no cache de 10 min do imóvel. Se owner editar uma policy e o bot responder com dado antigo (até 10 min), pode gerar resposta incorreta.
**Mitigação:** aceito para MVP. Owner pode clicar "Limpar cache" no detalhe do imóvel para forçar atualização. Documentar isso como comportamento esperado.

### R4 — Imóvel com múltiplos rule sets
Um imóvel pode estar vinculado a N rule sets. `flatPolicies` faz flatten de todas as policies com `appliesToProperty: true`. Se dois rule sets tiverem a mesma policy com valores diferentes, ambas aparecem no contexto.
**Mitigação:** para MVP, incluir todas. O agente lida com contexto duplicado (pior caso: resposta ambígua, não errada).

### R5 — `prisma.ruleSet.findUnique` já presente no POST /properties
O endpoint `POST /admin/rule-sets/:id/properties` já busca o rule set para verificar existência (necessário para obter `ownerId` para o activity log). Verificar se o endpoint já faz esse lookup; se não, adicionar.
**Mitigação:** ler o endpoint existente no plan e confirmar.

### R6 — `adminEmail` no `request`
Activity logs usam `request.adminEmail`. Verificar se o middleware `verifyAdminJwt` popula esse campo (igual ao padrão de outras slices).
**Mitigação:** grep por `adminEmail` no admin.ts existente para confirmar padrão.

---

## 11. Dependências / pré-condições

- Foundation F0.2 aplicada: `logActivity` helper em `services/activity.ts`
- Slices 1–5 aplicadas (padrão de admin routes e web estabelecido)
- `fetchProperties()` já existe em `apps/web/src/lib/queries.ts`
- Endpoints `POST /admin/rule-sets/:id/properties` e `DELETE /admin/rule-sets/:id/properties/:propertyId` já existem no bot (sem activity log)

---

## 12. Out of scope (explícito)

- Propagação real das policies entre imóveis (B10: UI existe, sem efeito)
- Cache invalidation quando policy é editada
- Criação de rule set via modal (hoje cria direto com nome "Novo conjunto")
- Duplicar rule set (citado no OVERVIEW, fora do ROADMAP checklist)
- Busca/filtro de rule sets
- Tabs "Blocos reutilizáveis", "Templates completos", "Campos estruturados" (permanecem stub)
- Envio de policies ao lead via bot (nunca por texto — políticas são para contexto do agente apenas)
