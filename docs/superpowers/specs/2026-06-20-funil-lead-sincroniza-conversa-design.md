# Design — Funil de lead reflete a conversa no painel

> Data: 2026-06-20
> Status: aprovado (brainstorming) → pronto pra plano de implementação
> Subsistema: captura + progressão de lead (bot ↔ painel)

---

## Problema

Teste real em produção: um número novo conversa com o bot (pede visita, bot agenda),
mas no painel `/leads`:

1. O card **não sai da coluna "Novo"** mesmo após o bot agendar a visita.
2. O lead aparece **sem nome** — o bot nunca pediu nem registrou.
3. A **origem** veio como `zap` (portal Zap Imóveis) quando deveria ser `whatsapp` (contato direto).
4. Não há **botão pra remover** um lead de teste no painel (foi preciso ir no banco na mão).

A captura em si **funciona** — o lead é gravado. O que falha é a *sincronização* entre o
estado da conversa e o que o painel mostra.

---

## Diagnóstico (causa raiz)

| # | Sintoma | Causa no código |
|---|---|---|
| 1 | Card travado em "Novo" | O FSM (`deriveState`, [context.ts:203](../../../apps/bot/src/flows/lead/context.ts)) gera estados de conversa (`lead.visit_scheduling`, etc.) gravados só em `Conversation.data`. O `Lead.stage` (lido pelo kanban) usa outro vocabulário e **só é atualizado pra `kyc_pending`** ([index.ts](../../../apps/bot/src/flows/lead/index.ts)). Não existe mapa `context.state → Lead.stage`. |
| 2 | Lead sem nome | `context.name` é extraído mas **nunca copiado pra `Lead.name`** — o `leadPatch` só grava `source`, `propertyId`, `stage`. |
| 3 | Visita não marca | `visitRequested` exige `context.name` ([index.ts:210](../../../apps/bot/src/flows/lead/index.ts)), mas o agente de agendamento não coleta nome → flag nunca vira true. |
| 4 | Origem = `zap` | `EXTRACTOR_SYSTEM_PROMPT` ([lead.ts:99](../../../apps/bot/src/agents/lead.ts)) **não tem regra de quando preencher `source`** → o LLM chuta `zap` da gíria de WhatsApp. `shouldUpdateLeadSource` ([kyc.ts:24](../../../apps/bot/src/flows/lead/kyc.ts)) deixa qualquer extração sobrescrever o default `whatsapp`. |
| 5 | Sem deletar lead | Não há endpoint nem UI. |

---

## Escopo

**Inclui:** 4 correções + 1 feature, todas no funil de lead.
**Não inclui (→ backlog):** tenant flow / Phase 2, prestadores de serviço, geração de
contrato pelo bot, OCR avançado, Sentry no bot, responsivo mobile.

---

## Decisões

- **Nome:** `pushName` do WhatsApp como valor inicial (card nunca anônimo) **+** bot pede o
  nome ativamente ao agendar visita. Extração explícita (`name_is_explicit`) sobrescreve o
  `pushName`.
- **Remoção:** **soft delete** (arquivar) — não apaga. Campo novo `Lead.archivedAt`, some do
  kanban, reversível.
- **Reativação:** lead arquivado que **envia nova mensagem é reativado** (`archivedAt = null`)
  pelo router. (Suposição confirmada no brainstorming.)
- **Origem:** `source` só é preenchido pelo LLM quando o lead **cita o canal externo
  explicitamente**. Contato direto permanece `whatsapp`. `zap` = portal Zap Imóveis apenas.

---

## Mudanças

### Schema (`apps/bot/prisma/schema.prisma`)

- Migration: `Lead.archivedAt DateTime?` (nullable).
- Migration: `Lead.reactivatedAt DateTime?` — preenchido automaticamente toda vez que o lead é reativado após arquivamento. Permite detectar histórico no card.

### Bot

**`flows/lead/index.ts`**
- Adicionar helper `fsmStateToLeadStage(state): LeadStage` com o mapa abaixo; aplicar no
  `leadPatch.stage` todo turno (sem regredir estágios terminais de KYC em diante).
- Gravar `Lead.name` quando houver nome explícito; passar `pushName` adiante (ver router) como
  fallback inicial.
- Remover a dependência de `context.name` para `visitRequested` (desacoplar visita de nome).

**`flows/router.ts`**
- Propagar `pushName` (hoje em `InboundMessage.senderName`, perdido no buffer) até o `upsert`
  pra preencher `Lead.name` no `create` quando vazio.
- No `upsert`/fluxo: se o lead encontrado está arquivado, limpar `archivedAt` e setar
  `reactivatedAt = now()` (reativar). Activity log: `lead_reactivated`.

**`webhooks/evolution.ts` + `buffer.ts`**
- Carregar `senderName` (pushName) pelo buffer até o `routeMessage` (hoje é descartado no
  `dispatch`).

**`agents/lead.ts`**
- Acrescentar ao `EXTRACTOR_SYSTEM_PROMPT` a regra de `source`: preencher só com menção
  explícita de canal (OLX, Zap Imóveis, site, Instagram, indicação); contato direto → não mexe.
- Agente de agendamento (`SCHEDULING_AGENT_PROMPT`): pedir o nome de forma natural quando ainda
  não conhecido.

**Endpoint admin (`admin.ts` ou equivalente)**
- `PATCH /admin/leads/:id/archive` (body `{ archived: boolean }`) → seta/limpa `archivedAt`.
- Activity log: `lead_archived`, `lead_unarchived`.

### Web (`apps/web`)
- `lib/queries.ts` → `fetchLeads`: filtrar `.is('archivedAt', null)`.
- `packages/types` → `Lead` ganha `archivedAt: string | null` e `reactivatedAt: string | null`.
- `lib/api.ts` → `archiveLead(id, archived)`.
- Detalhe do lead → botão "Arquivar lead" (com confirmação).
- Card kanban → chip/badge "Reativado" quando `reactivatedAt != null`, com tooltip mostrando
  data da última reativação. Se lead já teve KYC negado (stage histórico detectável via
  `ActivityLog`), exibir badge adicional "KYC negado anteriormente" em tom de alerta.

### Mapa FSM → `Lead.stage`

| `context.state` | `Lead.stage` | Coluna kanban |
|---|---|---|
| `lead.start`, `lead.offer_options`, `lead.property_info`, `lead.objection_handling` | `interest` | Novo |
| `lead.visit_scheduling`, `lead.visit_requested` | `visiting` | Visita agendada |
| `lead.post_visit_decision`, `lead.collect_application` | `collection` | Qualificação |
| `lead.review_submitted` | `review_submitted` | Qualificação |
| (transição KYC já existente) | `kyc_pending` → … | Proposta / Ganho |

> Regra de não-regressão: uma vez em `kyc_pending` ou além (ver `TERMINAL_STAGES` em
> [kyc.ts](../../../apps/bot/src/flows/lead/kyc.ts)), o mapa não rebaixa o stage.

---

## Critérios de aceite

1. Lead novo conversa, pede visita → card aparece em **"Visita agendada"** com o **nome** preenchido.
2. Lead que só pergunta sobre o imóvel → permanece em **"Novo"**.
3. Origem de contato direto no WhatsApp → `source = whatsapp` (nunca `zap`).
4. Lead que diz "vi no OLX" → `source = olx`.
5. Botão "Arquivar lead" some o card do kanban; o lead some de `fetchLeads`.
6. Lead arquivado que volta a mandar mensagem → reaparece no kanban (reativado).
7. `bunx tsc --noEmit` limpo em `apps/bot` e `apps/web`.

---

## Riscos / suposições

- **pushName** pode ser apelido ("Fred R."). Mitigação: extração explícita sobrescreve.
- **Reativação automática** pode reabrir um lead arquivado de propósito. Aceito pra fase de
  dogfooding; revisitar se incomodar.
- Propagar `senderName` pelo buffer toca o caminho quente do webhook — cobrir com teste do
  fluxo de captura.

---

## Backlog derivado (fora deste design)

- Tenant flow / Phase 2 (`handleTenantMessage` é stub) — recomendação de prestadores.
- Model `ServiceProvider` + CRUD no painel.
- Geração de contrato pelo bot na conversa (templates já existem).
- OCR avançado (CNH/RG/CPF) pro KYC.
- Sentry no bot (hoje só Pino).
- Responsivo mobile do painel.
