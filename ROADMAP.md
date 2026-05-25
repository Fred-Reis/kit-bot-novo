# ROADMAP — kit-manager

> Sequência priorizada de entrega via vertical slices.
> Atualizado: 2026-05-22
> Visão de produto: [PRD.md](./PRD.md) · Decisões: [BRAINSTORM.md](./BRAINSTORM.md)

---

## Filosofia

- **Vertical slices** — cada item entrega valor visível ponta-a-ponta (schema + types + query + UI + endpoint + activity log + notif quando aplicável).
- **MVP é todas as 9 páginas funcionais** — sem cortes, mas com versões simples quando integração externa exige.
- **Schema cresce por feature** — sem big bang migration. Cada slice traz sua migration.
- **Commit por slice completo.** Slice incompleta não vai pra `main`.

---

## Status legend
- `[ ]` todo
- `[~]` em progresso
- `[x]` done
- `[!]` blocked
- `[?]` decisão pendente

---

## Fase 0 — Foundation (pré-MVP, transversal)

> Bloqueia ou destrava várias slices. Fazer antes ou em paralelo.

### F0.1 — Decisões fechadas (ver BRAINSTORM §4)
- [x] **B1** Lib PDF: `pdfkit`
- [x] **B2** PDF gerado no bot, cacheado em Storage
- [x] **B3** Bot envia PDF via Evolution `sendMedia`
- [x] **B4** Notif WhatsApp owner: mesma instância Evolution, número pessoal cadastrado em Workspace
- [x] **B5** Email: Resend
- [x] **B6** FSM mantém estados; kanban mapeia estados → colunas
- [x] **B7** `Property.status` enum: available | rented | maintenance | reserved | archived
- [x] **B8** `ownerId` em todas as tabelas — ver F0.5
- [x] **B9** Template `usageCount` computed em query
- [x] **B10** Rule Set propagação cortada do MVP (UI fica, sem efeito)
- [x] **B11** Lead `source` extraído por LLM
- [x] **B12** ExternalId via PostgreSQL sequences
- [x] **B14** Pausar bot por chat: dentro do Slice 1 (Leads)

### F0.2 — Activity log infra
- [x] Migration: refatorar `ActivityLog` table — actorType, actorId, actorLabel, ownerId, metadata jsonb (migration 20260522000003)
- [x] Tipo compartilhado `ActivityLog` em `packages/types`
- [x] Helper `apps/bot/src/services/activity.ts` — `logActivity({actorType, actorLabel, ownerId, action, ...})`
- [x] Helper `apps/web/src/lib/activity.ts` — variante client-side
- [x] Convenção de chaves `action` documentada (`docs/activity-actions.md` ou na própria interface TS)
- [ ] **Por quê:** destrava Dashboard activity feed, auditoria, in-app notif.

### F0.3 — RLS readiness
- [ ] Documentar policies necessárias em `adrs/001-rls-strategy.md`
- [ ] Implementar policies por `ownerId` (mas manter desativadas até produção)
- [ ] Testar leitura como `authenticated` e escrita como `service_role`
- [ ] **Por quê:** dever-de-casa antes de subir produção real.

### F0.4 — Notif infra
- [x] Schema: `Owner.notificationPhone` e `Owner.notificationEmail` (migration 20260522000001)
- [x] Helper `apps/bot/src/services/notify.ts`
- [x] `notifyOwner(eventType, payload)` — multiplexa WhatsApp, email, in-app
- [ ] Email: integrar Resend (env `RESEND_API_KEY`)
- [x] WhatsApp: `evolution.sendText(ownerPhone, message)` mesma instância do bot
- [ ] In-app: subscribe em `ActivityLog` via Supabase Realtime no web; badge no sidebar
- [ ] **Por quê:** todas as slices que disparam evento crítico usam isso.

### F0.5 — ownerId migration (transversal)
- [x] Migration: adicionar `ownerId uuid NOT NULL` em: Property, Tenant, Lead, Payment, Contract, RuleSet, ContractTemplate, PropertyMedia, LeadDocument, ActivityLog, Conversation, Event (migrations 20260522000002–20260522000003)
- [x] FK → Owner.id, ON DELETE RESTRICT
- [x] Backfill: setar `ownerId` = id do único Owner existente
- [x] Atualizar tipos compartilhados em `packages/types`
- [x] Bot: todos os inserts populam `ownerId`
- [ ] Web: queries não filtram por `ownerId` ainda (single-owner); preparado pra adicionar `.eq('ownerId', currentOwner.id)` no futuro
- [ ] **Por quê:** destrava multi-tenancy futuro sem refator grande. Faz uma vez, dói uma vez.

### F0.6 — ExternalId sequences
- [x] Migration: `CREATE SEQUENCE` pra Property, Tenant, Lead, Contract (migration 20260522000004)
- [x] Bot: utilitário `nextExternalId(entity)` chama `nextval()` (`services/external-id.ts`)
- [x] Backfill: rows existentes recebem externalId conforme ordem `createdAt`
- [x] **Por quê:** referências legíveis em UI, contrato, bot. Padroniza tudo de uma vez.

---

## Fase 1 — Vertical slices do MVP

> Ordem sugerida — priorizada por: (a) destravar operação real próxima, (b) usar coisas que já existem, (c) curva de aprendizado crescente.

### Slice 1 — Leads (kanban + detalhe + pausar bot) ✅ DONE

**Por quê primeiro:** core do funil. Bot escreve aqui. Tudo começa aqui.

#### Schema & types
- [x] Migration: adicionar `Lead.name text`, `Lead.source text`, `Lead.propertyId uuid FK` (pré-existente)
- [x] Migration: `Lead.externalId` via `lead_external_seq` (pré-existente, F0.6)
- [x] Migration: `Conversation.botPaused boolean default false` (migration 20260523000001)
- [x] Atualizar tipos `Lead`, `Conversation` em `packages/types`

#### Bot
- [x] Extrator LLM: adicionar campo `source` no schema Zod (B11) — valores `olx | zap | site | instagram | indicacao | outro | desconhecido`
- [x] Bot: persistir `source` extraído em `Lead.source` (1ª detecção; não sobrescreve depois)
- [x] Bot: setar `propertyId` quando lead foca em imóvel (`flows/lead/index.ts`)
- [x] Bot: no router de webhook, se `conversation.botPaused === true`, ignora mensagem (sem LLM, sem resposta)
- [x] Bot endpoint: `PATCH /admin/leads/:id/pause-bot` — body `{paused: boolean}` → atualiza `Conversation.botPaused`
- [x] Bot: notificação WhatsApp ao owner quando `stage` muda pra `kyc_pending` (via `notifyOwner`)

#### Web (admin)
- [x] `fetchLead(id)` retorna `botPaused: boolean` + `documents` (via `Conversation` join)
- [x] Kanban card rico: `externalId` mono muted, source chip, relative time, propertyRef
- [x] Mapeamento FSM → coluna (B6) — `stageToColumn()` em `lib/lead-utils.ts`
- [x] `SOURCE_LABELS` cobre `olx`, `outro`, `desconhecido`
- [x] `api.ts`: `pauseLead()` e `updateLeadSource()`
- [x] Detalhe lead: dropdown manual de source para correção
- [x] Detalhe lead: toggle "Pausar bot / Retomar bot"
- [x] Detalhe lead: badge "Bot pausado — você assume" quando `botPaused === true`
- [x] Labels corretas das colunas kanban: Novo / Qualificação / Visita agendada / Proposta / Ganho
- [x] Tabela: colunas nome + source + property + stage + updatedAt
- [x] Header: botões Filtros (stub) + Novo lead (stub)

#### Activity log
- [x] `lead_created` (bot escreve na 1ª criação)
- [x] `lead_source_corrected` (web escreve quando owner muda dropdown)
- [x] `bot_paused`, `bot_resumed` (web escreve junto ao PATCH)
- [x] `kyc_approved`, `contract_generated`, `payment_confirmed` (pré-existentes em admin.ts)

#### Notif
- [x] WhatsApp pro owner em `stage = kyc_pending` (bot via `notifyOwner`)
- [ ] Email diário (Resend) com resumo de leads novos (→ F0.4 Resend pendente)

- [x] Commit

### Slice 2 — Properties (CRUD completo + UI) ✅ DONE

**Por quê:** Lead refere imóvel. Tenant refere imóvel. Tudo amarra aqui.

- [x] Migration: `Property.area float` (m²) — campo `Float?` já existia no schema
- [x] Migration: confirmar/normalizar `Property.status` — string no banco, enum no tipo TS (inclui `archived`)
- [x] Atualizar tipo `Property` em `packages/types` — adicionado `'archived'` ao status union
- [x] Bot: aceitar `area` em `POST /admin/properties` allowlist — já estava em `PROPERTY_PATCH_FIELDS`
- [x] Web: `fetchProperties()` retorna `area` — já retornava via tipo `Property`
- [x] Web: card grid — externalId mono muted + endereço completo + status pill overlaid + área
- [x] Web: card row — externalId, neighborhood, área
- [x] Web: header — botão Filtros (stub) + toggle ícones grid/lista
- [x] Web: tabs pill-style com counts inline
- [x] Activity log: `property_created`, `property_archived`
- [x] Commit

### Slice 3 — Tenants (lista + detalhe completos) ✅ DONE

**Por quê:** Lead converte em Tenant. Status do inquilino aparece em vários lugares.

- [x] Migration: `Tenant.externalId` (`IQ-XXX` sequence) — enforce no create
- [x] Atualizar tipo `Tenant` em `packages/types`
- [x] Bot: auto-gerar `externalId` em `POST /admin/tenants`
- [x] Web: `fetchTenants()` join `Property` retorna `propertyName`, `externalId`
- [x] Web: tabela com colunas IMÓVEL + STATUS pill (Em dia / Atenção)
- [x] Web: cards view atualizado
- [x] Web: detalhe — propertyName, externalId, score
- [x] Activity log: `tenant_created`
- [x] Commit

### Slice 4 — Templates de contrato (refinement) ✅ DONE

- [x] Web: lista esquerda com status pill (Publ./Rasc.) + code + metadata
- [x] Web: editor com code visível + Pré-visualizar button
- [x] Web: variables chips clicáveis (`{{locador}}` etc) que inserem no cursor
- [x] Web: highlighting de `{{variável}}` no body editado
- [x] Web: `usageCount` computado em query
- [x] Web: bloquear delete se `usageCount > 0`
- [x] Activity log: `template_created`, `template_published`
- [x] Commit

### Slice 5 — Contracts (geração de Word/PDF)
**Por quê:** fluxo central do MVP — admin gera contrato baixável.

- [ ] Decidir B1 (provisório: `pdfkit`)
- [ ] Bot: serviço `apps/bot/src/services/pdf.ts` — render template + dados → PDF
- [ ] Bot: endpoint `GET /admin/contracts/:id/pdf` (gera se não existir, retorna URL Storage)
- [ ] Bot: endpoint `POST /admin/contracts` cria contrato + body renderizado
- [ ] Web: `fetchContract(id)` já retorna joins corretos (parcial — finalizar)
- [ ] Web: detalhe `$contractId.tsx` (uncommitted) — finalizar + botão Baixar PDF funcional
- [ ] Web: tabela com VIGÊNCIA merged + VALOR + status Renovação computado (≤60 dias do fim)
- [ ] Web: modal novo contrato funcional (já existe)
- [ ] Activity log: `contract_created`, `contract_signed`
- [ ] Notif: bot avisa owner em `contract_signed`
- [ ] Commit

### Slice 6 — Rules (UI refinement)
**Por quê:** policies vinculadas a imóvel são usadas pelo bot e referenciadas no contrato.

- [ ] Web: labels corretas das tabs (Políticas / Blocos reutilizáveis / Templates completos / Campos estruturados)
- [ ] Web: políticas tab — 3-way toggle (Sim/Não/Cond) por policy
- [ ] Web: políticas tab — "Aplica ao imóvel" toggle por policy
- [ ] Web: reuso panel — propagação flags + lista de propriedades vinculadas (chips com externalId)
- [ ] Bot: usar policies do rule set vinculado nas respostas (`info` agent já lê via `catalog.ts`?)
- [ ] Activity log: `rule_set_created`, `rule_set_linked`
- [ ] Commit

### Slice 7 — Financeiro (KPIs + transações + lançamento manual)
**Por quê:** dor real — proprietário precisa ver pagamentos. Lançamento manual viabiliza o uso.

- [ ] Migration: `Payment.description text`, `Payment.type ('income'|'expense')`
- [ ] Atualizar tipo `Payment` em `packages/types`
- [ ] Bot: endpoint `POST /admin/payments` (lançamento manual)
- [ ] Web: `fetchFinanceSummary()` — toReceiveMonth, received, overdue, etc
- [ ] Web: `fetchMonthlyTotals(months)` — para chart Receita x Inadimplência
- [ ] Web: `fetchRecentTransactions(limit)` — para tabela movimentos
- [ ] Web: KPIs labels corretos + subtext + sem sparkline
- [ ] Web: tabs corretas (Visão geral / À receber / Repasses placeholder / Relatórios placeholder)
- [ ] Web: chart dual-series (Receita + Inadimplência) com legend
- [ ] Web: tabela Últimos movimentos
- [ ] Web: modal "Novo lançamento"
- [ ] Web: aba À receber funcional
- [ ] Web: aba Repasses fica placeholder com texto "Disponível com multi-tenancy"
- [ ] Activity log: `payment_confirmed`, `payment_recorded`, `payment_overdue` (job cron)
- [ ] Notif: bot avisa owner em atrasos > 5 dias
- [ ] Commit

### Slice 8 — Dashboard (KPIs + activity + occupancy)
**Por quê:** depende de tudo acima (activity_log, payments, leads enriched).

- [ ] Web: KPI labels corretos (A RECEBER / RECEBIDO / EM ATRASO / LEADS ATIVOS)
- [ ] Web: KPI delta % vs mês anterior
- [ ] Web: KPI subtext linhas
- [ ] Web: month chip no header + botão Exportar (stub)
- [ ] Web: ocupação por empreendimento — barras com unit count + tooltip nome
- [ ] Web: próximos vencimentos — nome do tenant + status pill (prio/atraso) + relative time
- [ ] Web: activity feed — fetch `ActivityLog` últimos 10 + render "actor action subject"
- [ ] Web: time filter toggle 30d/90d/12m (UI only)
- [ ] Commit

### Slice 9 — Configurações (sidebar layout + 7 seções)
**Por quê:** menor urgência operacional. Pode ser last.

- [ ] Web: layout sidebar nav 220px + content panel
- [ ] Web: Workspace section read-only (nome empresa, CNPJ, etc — hardcoded ou em env por ora)
- [ ] Web: Integrações section — campos Evolution URL/instância (move da Conta)
- [ ] Web: Notificações section — toggles
- [ ] Web: Aparência section — dark mode wired
- [ ] Web: Segurança stub
- [ ] Web: Equipe stub ("Disponível com multi-tenancy")
- [ ] Web: Plano stub ("Em breve")
- [ ] Commit

---

## Fase 2 — Hardening pré-produção

> Antes de ligar dados reais e operar de verdade.

- [ ] **RLS reativar** — todas as tabelas com policies definidas em F0.3
- [ ] **MSW dev-only** — confirmar que MSW handlers não vão pra prod build (env check)
- [ ] **Backups Supabase** — confirmar policy de backup automático
- [ ] **Logs estruturados** — bot loga em JSON, web envia erros pra Sentry (?)
- [ ] **Variáveis env produção** — checklist completo em `docs/deploy.md`
- [ ] **Bot deploy** — Railway/Fly free tier
- [ ] **Web deploy** — Vercel
- [ ] **Evolution API deploy** — qual provider? (precisa de webhook público)
- [ ] **Domínio + SSL**
- [ ] **Onboarding dos próprios imóveis** — cadastrar você como Owner, importar imóveis existentes
- [ ] **Conectar bot ao número de WhatsApp real**

---

## Fase 3 — Dogfooding (uso próprio real)

> Operação ponta-a-ponta dos seus 5–15 imóveis. Métricas do PRD §7 começam a ser medidas.

- [ ] Bot atende leads reais
- [ ] Admin opera funil real
- [ ] Contrato manual funcionando
- [ ] Financeiro alimentado manualmente
- [ ] Coletar bugs e refinamentos vividos no uso
- [ ] Iterar até zero planilhas paralelas

---

## Fase 4 — Validação externa (3 proprietários piloto)

> Antes de multi-tenancy: ainda single-owner por user (instância por proprietário).

- [ ] Onboarding manual (você cria org/setup pra cada piloto)
- [ ] Coletar feedback NPS
- [ ] Medir tempo lead → tenant
- [ ] Iterar UX baseado em proprietário não-dev

---

## Fase 5 — Multi-tenancy

> Quando demanda comercial concreta justifica.

### Schema
- [ ] `organizations` table (name, CNPJ, domain, language, currency, timezone)
- [ ] `organization_members` (userId + orgId + role: admin/manager/viewer)
- [ ] `org_id` FK em: Property, Tenant, Lead, Payment, Contract, RuleSet, ContractTemplate, PropertyMedia, LeadDocument, ActivityLog
- [ ] Backfill `org_id` para dados existentes (single org)
- [ ] RLS scoped por `org_id`

### Auth + Onboarding
- [ ] Flow de criação de org no signup
- [ ] Invite por email → member + magic link
- [ ] Org switcher no sidebar (multi-org users)

### RBAC
- [ ] Admin: full access
- [ ] Gestor: CRUD imóveis/tenants/leads, sem members/billing
- [ ] Visualizador: read-only

### Config sections (real)
- [ ] Workspace wired a `organizations` row
- [ ] Equipe & permissões — invite, list, role
- [ ] Plano & cobrança — Stripe integration

### Bot scoping
- [ ] Instância bot ↔ org_id
- [ ] Todas as writes scoped por `org_id`

### Repasses (real)
- [ ] Modelo de Owner real (dono do imóvel ≠ user da PMC)
- [ ] Disbursement calculations
- [ ] Aba Repasses no Financeiro funcional

---

## Fase 6 — Autentique + KYC automatizado

> Substituir contrato manual por assinatura digital.

- [ ] `apps/bot/src/services/autentique.ts` (GraphQL)
- [ ] Criar documento com signatários via WhatsApp
- [ ] `POST /webhook/autentique` — recebe assinatura completa
- [ ] Atualizar `Lead.stage` automaticamente
- [ ] Download PDF assinado → Storage
- [ ] Integração com validação CPF (Receita/Serpro)
- [ ] Score de risco do locatário
- [ ] Aprovação automática se score > threshold

---

## Fase 7 — Refinamentos do bot

> Backlog de melhorias do bot não-críticas pro MVP.

- [ ] OCR retry com foto melhor (2ª falha notifica owner)
- [ ] Transcrição de áudio via Whisper
- [ ] Múltiplos imóveis em foco (lead negocia 2+)
- [ ] Reativação de lead frio (cron)
- [ ] Análise de sentimento → flag lead difícil
- [ ] Multi-idioma (i18n PT/EN)

---

## Tracking macro

| Fase | Slices completas | % MVP |
|---|---|---|
| F0 — Foundation | 3/5 (F0.2 ✓, F0.5 ✓, F0.6 ✓) — F0.4 parcial (Resend + in-app pendentes) | 60% |
| F1 — Vertical slices | 4/9 (Slice 1 ✓, Slice 2 ✓, Slice 3 ✓, Slice 4 ✓) | 44% |
| F2 — Hardening | 0 | — |
| F3 — Dogfooding | — | — |

> Atualizar ao concluir slices.

---

## Notas de prioridade

- **Slice 1 (Leads) é a próxima** — porque é o core do funil e tem dependências de schema que destravam outras slices.
- **F0.2 (activity_log) deve sair antes da Slice 8 (Dashboard)** — Dashboard depende disso.
- **F0.4 (notif infra) destrava o Slice 1, 5, 7** — fazer cedo se quiser notificações desde o início, ou implementar inline na primeira slice que precisar.
- **Decisões pendentes (F0.1)** devem ser fechadas antes das slices que dependem delas:
  - B1 (PDF lib) → Slice 5
  - B4 (notif canal) → F0.4
  - B6 (FSM visiting) → Slice 1
  - B7 (Property.status enum) → Slice 2
  - B8 (ownerId prep) → ✋ decisão arquitetural; idealmente antes de F1
