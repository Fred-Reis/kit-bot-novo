# Activity Log — Convenção de Chaves

Referência de todas as chaves `action` usadas no `ActivityLog`, seus `actorType`, `subjectType` e em qual slice são emitidas.

---

## Convenção de nomenclatura

- Formato: `<objeto>_<verbo_passado>` em snake_case
- Exemplos: `lead_created`, `kyc_approved`, `payment_marked_overdue`

---

## Valores de `actorType`

| Valor | Quando usar |
| --- | --- |
| `'bot'` | Ação disparada pelo webhook do bot WhatsApp |
| `'user'` | Ação disparada pelo owner logado no painel admin |
| `'system'` | Ação disparada por cron, job automático ou trigger interno |

## Valores típicos de `actorLabel`

| `actorType` | `actorLabel` |
| --- | --- |
| `'bot'` | `'Bot'` |
| `'system'` | `'Sistema'` |
| `'user'` | Nome do owner (ex: `'Fred Reis'`) |

---

## Chaves por slice

| Chave | actorType | subjectType | Slice |
| --- | --- | --- | --- |
| `lead_created` | `bot` | `lead` | Slice 1 |
| `lead_stage_changed` | `bot` | `lead` | Slice 1 |
| `lead_source_corrected` | `user` | `lead` | Slice 1 |
| `bot_paused` | `user` | `lead` | Slice 1 |
| `bot_resumed` | `user` | `lead` | Slice 1 |
| `kyc_approved` | `user` | `lead` | Slice 1 |
| `kyc_rejected` | `user` | `lead` | Slice 1 |
| `property_created` | `user` | `property` | Slice 2 |
| `property_published` | `user` | `property` | Slice 2 |
| `property_archived` | `user` | `property` | Slice 2 |
| `tenant_created` | `bot` | `tenant` | Slice 3 |
| `tenant_status_changed` | `system` | `tenant` | Slice 3 |
| `template_created` | `user` | `template` | Slice 4 |
| `template_published` | `user` | `template` | Slice 4 |
| `template_unpublished` | `user` | `template` | Slice 4 |
| `contract_created` | `bot` | `contract` | Slice 5 |
| `contract_signed` | `bot` | `contract` | Slice 5 |
| `contract_cancelled` | `user` | `contract` | Slice 5 |
| `rule_set_created` | `user` | `rule_set` | Slice 6 |
| `rule_set_linked` | `user` | `rule_set` | Slice 6 |
| `rule_set_unlinked` | `user` | `rule_set` | Slice 6 |
| `payment_recorded` | `user` | `payment` | Slice 7 |
| `payment_confirmed` | `bot` | `payment` | Slice 7 |
| `payment_marked_overdue` | `system` | `payment` | Slice 7 |
| `owner_updated` | `user` | `owner` | Slice 9 |

---

## Como usar

### Bot (`apps/bot`)

```ts
import { logActivity } from '../services/activity';

await logActivity({
  ownerId: owner.id,
  actorType: 'bot',
  actorLabel: 'Bot',
  action: 'lead_created',
  subjectType: 'lead',
  subjectId: lead.id,
  subject: lead.name ?? lead.phone,
});
```

Para fire-and-forget (não bloquear o fluxo se o log falhar):

```ts
logActivity({ ... }).catch(console.error);
```

### Web (`apps/web`)

```ts
import { logActivity } from '@/lib/activity';
import { supabase } from '@/lib/supabase';

await logActivity(supabase, {
  ownerId: session.user.id,
  actorType: 'user',
  actorLabel: session.user.name,
  action: 'lead_source_corrected',
  subjectType: 'lead',
  subjectId: lead.id,
  subject: lead.name ?? lead.phone,
});
```

---

## Regras

- Sempre usar `await` ou `.catch(console.error)` explícito — nunca chamar sem capturar o resultado
- `subject` é opcional mas recomendado: facilita leitura no feed de atividade
- `metadata` é opcional: usar para dados extras relevantes para auditoria (ex: valor anterior, novo valor)
- Não criar chaves novas sem adicionar à `ActivityLogAction` em `packages/types/src/activity-log.ts` e a esta tabela
