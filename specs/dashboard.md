# Spec — Slice 8: Dashboard

## Objetivo

Tornar o Dashboard plenamente funcional: corrigir o feed de atividade (bug de coluna), adicionar mapeamento PT-BR de ações, e adicionar tooltip de nome completo nas barras de ocupação.

---

## Escopo

### In
- Corrigir `fetchActivityLog` (seleciona `actor` → deve selecionar `actorLabel`)
- Atualizar `ActivityLogEntry` interface (`actor` → `actorLabel`)
- Adicionar `ACTION_LABELS` map em `apps/web/src/lib/activity-labels.ts`
- Atualizar `ActivityRow` para renderizar frase PT-BR legível: `"{actorLabel} {ação} {subject}"`
- Adicionar tooltip de nome completo nas barras de ocupação por imóvel

### Out
- Badge de notificações in-app no sidebar (Supabase Realtime) → F0.4 separado
- Lógica real de filtro 30d/90d/12m → futuro
- Novas migrations de schema → nenhuma necessária
- Alterações no bot → nenhuma necessária
- Novos endpoints → nenhum necessário

---

## Schema changes

Nenhuma. O schema `ActivityLog` já tem `actorLabel String` desde F0.2 (migration 20260522000003).

---

## Tipos compartilhados (`packages/types`)

Nenhuma alteração. `ActivityLog` em `packages/types` já está correto.

---

## Bot changes

Nenhuma.

---

## Web changes

### 1. Corrigir query — `apps/web/src/lib/queries.ts`

**Bug:** `.select('id, actor, action, subject, subjectType, createdAt')` — coluna `actor` não existe.

**Fix:**
```ts
// antes
.select('id, actor, action, subject, subjectType, createdAt')

// depois
.select('id, actorLabel, action, subject, subjectType, createdAt')
```

Atualizar interface:
```ts
export interface ActivityLogEntry {
  id: string;
  actorLabel: string | null;   // era: actor
  action: string;
  subject: string | null;
  subjectType: string | null;
  createdAt: string;
}
```

### 2. Mapeamento PT-BR — `apps/web/src/lib/activity-labels.ts` (novo arquivo)

Novo arquivo com mapa de todos os action keys conhecidos:

```ts
export const ACTION_LABELS: Record<string, string> = {
  lead_created:           'criou lead',
  lead_source_corrected:  'corrigiu origem do lead',
  bot_paused:             'pausou o bot',
  bot_resumed:            'retomou o bot',
  kyc_approved:           'aprovou KYC',
  contract_created:       'gerou contrato',
  contract_signed:        'assinou contrato',
  payment_confirmed:      'confirmou pagamento',
  payment_recorded:       'registrou pagamento',
  property_created:       'criou imóvel',
  property_archived:      'arquivou imóvel',
  tenant_created:         'criou inquilino',
  rule_set_created:       'criou conjunto de regras',
  rule_set_linked:        'vinculou regras ao imóvel',
  template_created:       'criou template',
  template_published:     'publicou template',
};

export function formatActivityLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}
```

### 3. Atualizar `ActivityRow` — `apps/web/src/routes/_dashboard/index.tsx`

Substituir referências a `entry.actor` por `entry.actorLabel`.

Renderização atualizada:
```tsx
function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  const actor = entry.actorLabel ?? 'Sistema';
  const verb = formatActivityLabel(entry.action);
  // ...
  <span className="font-medium">{actor}</span>{' '}{verb}
  {entry.subject && <> <span className="font-medium">{entry.subject}</span></>}
}
```

Avatar inicial: usar primeiros 2 chars de `actorLabel` (ou '?' se null).

### 4. Tooltip nas barras de ocupação — `apps/web/src/routes/_dashboard/index.tsx`

Nas barras de ocupação por imóvel, truncar o nome no layout (`truncate`) e adicionar `title={p.name}` no elemento pai para tooltip nativo.

```tsx
<div key={p.id} className="flex items-center gap-3" title={p.name}>
  <span className="w-32 truncate text-xs text-muted-foreground">{p.name}</span>
  {/* ... */}
</div>
```

> Tooltip nativo (`title` attribute) é suficiente para desktop sem adicionar dependência.

---

## Activity log keys

Nenhuma nova chave. As 16 chaves existentes recebem mapeamento PT-BR neste slice.

---

## Notificações

Nenhuma. Slice 8 é puramente de leitura/display.

---

## Critérios de aceite

- [ ] `fetchActivityLog` seleciona `actorLabel` (não `actor`) — query não lança erro quando ActivityLog tem registros
- [ ] `ActivityLogEntry.actorLabel` existe na interface; `ActivityLogEntry.actor` removido
- [ ] Todas as 16 action keys têm entrada em `ACTION_LABELS`
- [ ] `formatActivityLabel` retorna fallback `action.replace(/_/g, ' ')` para chaves desconhecidas
- [ ] `ActivityRow` renderiza: `"{actorLabel} {ação PT-BR} {subject}"` (ex: "Bot criou lead LD-0042")
- [ ] Avatar no activity feed usa 2 primeiros chars de `actorLabel` (ou '?' se null)
- [ ] Barras de ocupação exibem nome completo no tooltip nativo (`title` attribute) ao hover
- [ ] Quando ActivityLog está vazio, fallback para `recentLeads` permanece funcional
- [ ] `bunx tsc --noEmit` verde em `apps/web`
- [ ] `bunx oxlint` sem warnings novos

---

## Riscos / edge cases

- **actorLabel como UUID ou email:** o mapeamento exibe o que vier sem transformação — aceitável para uso pessoal (dono conhece seus próprios IDs/emails).
- **Chave de ação nova não mapeada:** `formatActivityLabel` faz fallback para `action.replace(/_/g, ' ')` — legível sem quebrar.
- **ActivityLog vazio (setup fresh):** fallback para `recentLeads` continua como antes — nenhuma regressão.
- **Nome de imóvel longo:** truncado com `truncate` no layout + tooltip nativo exibe completo.
