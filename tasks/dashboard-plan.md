# Plan — Slice 8: Dashboard

> Spec: `specs/dashboard.md`
> Dependências: nenhuma migration, nenhum endpoint novo, apenas `apps/web`.

---

## Grafo de dependências

```
T01 (fix query + interface)
T02 (activity-labels.ts)      ← paralelo com T01
        ↓           ↓
        T03 (dashboard index — ActivityRow + tooltip)
```

T01 e T02 são independentes. T03 depende de ambos.

---

## Tasks

### T01 — Corrigir `fetchActivityLog` e `ActivityLogEntry`

**Arquivo:** `apps/web/src/lib/queries.ts`

**O que fazer:**
1. Na interface `ActivityLogEntry`: renomear campo `actor: string | null` → `actorLabel: string | null`
2. Em `fetchActivityLog`: trocar `.select('id, actor, action, subject, subjectType, createdAt')` por `.select('id, actorLabel, action, subject, subjectType, createdAt')`

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/lib/queries.ts
```

**Critério de pronto:**
- Interface tem `actorLabel`, não tem `actor`
- Query seleciona `actorLabel`
- TypeCheck verde (erros de uso de `actor` na dashboard ficam para T03)

---

### T02 — Criar `activity-labels.ts`

**Arquivo novo:** `apps/web/src/lib/activity-labels.ts`

**O que fazer:**
Criar arquivo com:
- `ACTION_LABELS: Record<string, string>` com as 16 chaves existentes mapeadas para PT-BR
- `formatActivityLabel(action: string): string` — retorna `ACTION_LABELS[action]` ou `action.replace(/_/g, ' ')` como fallback

Chaves a mapear:
```
lead_created, lead_source_corrected, bot_paused, bot_resumed,
kyc_approved, contract_created, contract_signed, payment_confirmed,
payment_recorded, property_created, property_archived, tenant_created,
rule_set_created, rule_set_linked, template_created, template_published
```

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/lib/activity-labels.ts
```

**Critério de pronto:**
- Arquivo existe e exporta `ACTION_LABELS` e `formatActivityLabel`
- Todas as 16 chaves presentes
- TypeCheck verde

---

### T03 — Atualizar dashboard: ActivityRow + tooltip de ocupação

**Arquivo:** `apps/web/src/routes/_dashboard/index.tsx`

**O que fazer:**
1. Importar `formatActivityLabel` de `@/lib/activity-labels`
2. Em `ActivityRow`:
   - Trocar `entry.actor` → `entry.actorLabel` em todos os usos
   - Renderizar verb com `formatActivityLabel(entry.action)`
   - Avatar: usar 2 primeiros chars de `actorLabel ?? '?'`
3. Na seção de ocupação por imóvel (`properties.map`):
   - Adicionar `title={p.name}` no `<div key={p.id}>` container
   - Adicionar `truncate` na classe do `<span>` do nome

**Verificação:**
```bash
cd apps/web && bunx tsc --noEmit
cd apps/web && bunx oxlint src/routes/_dashboard/index.tsx
```

**Critério de pronto:**
- Zero referências a `entry.actor` no arquivo
- `formatActivityLabel` em uso no `ActivityRow`
- `title={p.name}` presente nas linhas de ocupação
- TypeCheck e oxlint verdes

---

## Checkpoint final

Após T03:
```bash
cd apps/web && bunx tsc --noEmit   # zero erros
cd apps/web && bunx oxlint src/    # zero warnings novos
```

Verificar manualmente:
- Dashboard carrega sem erros de console
- Activity feed (se houver registros no banco) exibe frases PT-BR
- Hover em nome de imóvel longo exibe tooltip com nome completo
