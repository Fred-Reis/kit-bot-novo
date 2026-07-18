# ROADMAP — kit-manager

> Sequência priorizada de entrega via vertical slices.
> Atualizado: 2026-06-26
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
- [x] Documentar policies necessárias em `docs/adrs/001-rls-strategy.md` (2026-06-16)
- [x] Implementar policies por `ownerId` (mas manter desativadas até produção) (2026-07-17)
- [x] Testar leitura como `authenticated` e escrita como bot/Prisma (2026-07-17)
- [ ] **Ativar RLS** (`ENABLE ROW LEVEL SECURITY`) — migration separada, antes de operar com dados reais de terceiros
- [ ] **Por quê:** dever-de-casa antes de subir produção real.

### F0.4 — Notif infra
- [x] Schema: `Owner.notificationPhone` e `Owner.notificationEmail` (migration 20260522000001)
- [x] Helper `apps/bot/src/services/notify.ts`
- [x] `notifyOwner(eventType, payload)` — multiplexa WhatsApp, email, in-app
- [x] Email: integrar Resend (env `RESEND_API_KEY`) — chave adicionada no Railway em 2026-07-15
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
- [x] Migration: `Lead.archivedAt DateTime?`, `Lead.reactivatedAt DateTime?` (migration 20260620000001)
- [x] Atualizar tipos `Lead`, `Conversation` em `packages/types`

#### Bot
- [x] Extrator LLM: adicionar campo `source` no schema Zod (B11) — valores `olx | zap | site | instagram | indicacao | outro | desconhecido`
- [x] Bot: persistir `source` extraído em `Lead.source` (1ª detecção; não sobrescreve depois)
- [x] Bot: `source` preenchido **apenas** com menção explícita de portal ("vi no OLX", "Zap Imóveis") — contato direto pelo WhatsApp → `null`
- [x] Bot: setar `propertyId` quando lead foca em imóvel (`flows/lead/index.ts`)
- [x] Bot: no router de webhook, se `conversation.botPaused === true`, ignora mensagem (sem LLM, sem resposta)
- [x] Bot: `pushName` pipeline — `senderName` → Redis `sender:{chatId}` (NX, write-once) → `Lead.name` na criação
- [x] Bot: FSM→stage sync — `fsmStateToLeadStage()` em `flows/lead/stage-map.ts` sincroniza `Lead.stage` a cada turno; não regride stages terminais (`kyc_pending` em diante)
- [x] Bot: `Lead.name` persistido quando LLM extrai explicitamente (não sobrescreve se já preenchido via pushName)
- [x] Bot: `visitRequested` desacoplado de `context.name` (não depende mais de ter nome para marcar visita)
- [x] Bot: reativação de lead arquivado — quando lead arquivado manda mensagem, `archivedAt → null`, `reactivatedAt → now()`, log `lead_reactivated`
- [x] Bot endpoint: `PATCH /admin/leads/:id/pause-bot` — body `{paused: boolean}` → atualiza `Conversation.botPaused`
- [x] Bot endpoint: `PATCH /admin/leads/:id/archive` — body `{archived: boolean}` → soft-delete com `archivedAt`; `updateMany` + precondition para idempotência
- [x] Bot endpoint: `PATCH /admin/leads/:id/stage` — body `{stage: LeadStage}` → movimentação manual; validado contra `MANUAL_STAGES`
- [x] Bot: notificação WhatsApp ao owner quando `stage` muda pra `kyc_pending` (via `notifyOwner`)
- [x] Scheduling agent pede nome quando desconhecido, de forma natural, uma única vez

#### Web (admin)
- [x] `fetchLead(id)` retorna `botPaused: boolean` + `documents` (via `Conversation` join)
- [x] `fetchLeads()` filtra `archivedAt IS NULL` — leads arquivados não aparecem no kanban
- [x] Kanban card rico: `externalId` mono muted, source chip, relative time, propertyRef
- [x] Kanban card: badge "Reativado" quando `reactivatedAt != null`
- [x] Kanban DnD: arrastar cards entre colunas droppable (Novo / Qualificação / Visita agendada); usa `@dnd-kit/core`
- [x] Kanban DnD: optimistic update — card fica na coluna destino imediatamente; rollback + toast de erro se falhar; toast de sucesso
- [x] Kanban DnD: bloqueio durante mutation — `useDraggable({ disabled })` + opacity-50 enquanto request processa
- [x] Mapeamento FSM → coluna (B6) — `stageToColumn()` em `lib/lead-utils.ts`
- [x] `SOURCE_LABELS`: WhatsApp com label "WhatsApp" (não "ZAP"); `zap` filtrado do select como legado
- [x] `api.ts`: `pauseLead()`, `updateLeadSource()`, `archiveLead()`, `updateLeadStage()`
- [x] Detalhe lead: dropdown manual de source para correção (inclui WhatsApp; exclui `zap`, `other`, `desconhecido`)
- [x] Detalhe lead: toggle "Pausar bot / Retomar bot"
- [x] Detalhe lead: badge "Bot pausado — você assume" quando `botPaused === true`
- [x] Detalhe lead: botão "Arquivar / Reativar lead" com `ConfirmButton` (sem `confirm()` nativo)
- [x] Labels corretas das colunas kanban: Novo / Qualificação / Visita agendada / Proposta / Ganho
- [x] Tabela: colunas nome + source + property + stage + updatedAt
- [x] Header: botões Filtros (stub) + Novo lead (stub)

#### Activity log
- [x] `lead_created` (bot escreve na 1ª criação)
- [x] `lead_reactivated` (bot escreve na reativação de lead arquivado)
- [x] `lead_archived`, `lead_unarchived` (web escreve junto ao PATCH /archive)
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

### Slice 5 — Contracts (geração de Word/PDF) ✅ DONE

- [x] Decidir B1 (provisório: `pdfkit`)
- [x] Bot: serviço `apps/bot/src/services/pdf.ts` — render template + dados → PDF
- [x] Bot: endpoint `GET /admin/contracts/:id/pdf` (gera se não existir, retorna URL Storage)
- [x] Bot: endpoint `POST /admin/contracts` cria contrato + body renderizado
- [x] Bot: endpoint `POST /admin/contracts/preview` — resolução de variáveis com auto-map + suggestions
- [x] Bot: endpoint `POST /admin/leads/:id/mark-signed` — move stage contract_pending → contract_signed
- [x] Web: `fetchContract(id)` já retorna joins corretos
- [x] Web: detalhe `$contractId.tsx` — botão Baixar PDF funcional
- [x] Web: tabela com VIGÊNCIA merged + VALOR + status Renovação computado (≤60 dias do fim)
- [x] Web: modal novo contrato em 2 steps — step 2 resolve variáveis não mapeadas
- [x] Activity log: `contract_created`, `contract_signed`
- [x] Notif: bot avisa owner em `contract_signed`
- [ ] Commit

### Slice 10 — Funil completo lead → inquilino (V1 closure) ✅ DONE

> Auditado em 2026-07-14 contra o código real em main.

#### Schema & migration
- [x] `Contract.tenantId` → nullable (`String?`) — schema.prisma linha 183
- [x] `Contract.leadId String?` (FK Lead, onDelete SetNull) — schema.prisma linha 301
- [x] `Contract.signedPdfUrl String?` — schema.prisma linha 308
- [x] `Lead.contracts Contract[]` (relação inversa) — schema.prisma
- [x] Tipos compartilhados atualizados em `packages/types`

#### Config & notificações
- [x] `config.ts`: `RESEND_API_KEY` opcional via Zod
- [x] `notify.ts`: Resend instanciado condicionalmente; envia email quando `RESEND_API_KEY` presente + `owner.notificationEmail` preenchido
- [ ] CPF incluído no payload `kyc_pending` — não confirmado

#### Bot — FSM data_confirmation
- [x] `context.ts`: `dataConfirmed?: boolean` em `LeadContext`; estado `lead.data_confirmation` em `STATE_GUIDANCE` e `deriveState()`
- [x] `kyc.ts` / `context.ts`: `shouldTransitionToKyc()` requer `dataConfirmed === true`
- [x] `index.ts`: ao entrar em `data_confirmation` pela primeira vez, extrai CPF do `ocrText` e envia confirmação ao lead (`context.dataConfirmationSent`); ao receber confirmação → `dataConfirmed = true`

#### Bot — visit confirmation
- [x] `index.ts`: quando `scheduledVisitAt` muda nessa interação, envia mensagem ao lead com data, hora e nome do imóvel

#### Bot — approve-kyc (auto-contrato + PDF)
- [x] `admin.ts` `approve-kyc`: busca template padrão; resolve variáveis (auto-map + LLM); cria `Contract` com `leadId`; gera PDF; `sendMedia` ao lead; stage `kyc_pending → contract_pending`
- [x] Variáveis de template com LLM second-pass (PR #25)

#### Bot — mark-signed (auto-tenant)
- [x] `admin.ts` `mark-signed`: cria `Tenant`; atualiza `Contract.tenantId`; `property.status = rented`; stage `contract_pending → converted`
- [x] Bot: detecção de PDF assinado recebido pelo lead (PR #16) — upload para Storage, `Contract.signedPdfUrl`, auto-finaliza

#### Web (admin)
- [x] Stage stepper: Novo → Qualificação → Visita agendada → KYC → Contrato → Convertido
- [x] `kyc_pending`: botão "Aprovar KYC" com modal de dia de pagamento + resolução de variáveis
- [x] `contract_pending`: botão "Marcar contrato assinado"
- [x] Card de imóvel vinculado no detalhe do lead (PR #23)
- [x] Seção de contratos com PDF emitido + assinado, preview e download (PR #24)

#### Activity log
- [x] `kyc_approved` (approve-kyc)
- [x] `tenant_created` (mark-signed — usa label genérica, não `tenant_auto_created`)
- [ ] `contract_auto_created`, `contract_pdf_sent` — não encontrados; ações logadas via `kyc_approved`

- [x] Commit

### Slice 6 — Rules (UI refinement) ✅ DONE

**Por quê:** policies vinculadas a imóvel são usadas pelo bot e referenciadas no contrato.

- [x] Web: labels corretas das tabs (Políticas / Blocos reutilizáveis / Templates completos / Campos estruturados)
- [x] Web: políticas tab — 3-way toggle (Sim/Não/Cond) por policy
- [x] Web: políticas tab — "Aplica ao imóvel" toggle por policy
- [x] Web: reuso panel — propagação flags + lista de propriedades vinculadas (chips com externalId)
- [x] Web: reuso panel — vincular/desvincular imóveis
- [x] Bot: usar policies do rule set vinculado nas respostas (via `catalog.ts`)
- [x] Activity log: `rule_set_created`, `rule_set_linked`
- [x] Commit

### Slice 7 — Financeiro (KPIs + transações + lançamento manual) ✅ DONE

- [x] Migration: `Payment.tenantId` nullable + `Payment.propertyId` adicionado
- [x] Atualizar tipo `Payment` em `packages/types`
- [x] Bot: endpoint `POST /admin/payments` (lançamento manual)
- [x] Bot: endpoint `GET /admin/payments` (lista filtrada)
- [x] Web: KPIs labels corretos + subtext + sparkline
- [x] Web: tabs corretas (Visão geral / Receitas / À receber / Repasses placeholder / Relatórios placeholder)
- [x] Web: chart dual-series (Recebido + Em atraso) com legend
- [x] Web: tabela Últimos movimentos (10 recentes, todos os tipos)
- [x] Web: aba Receitas com filtro Mês/Semestre/Ano
- [x] Web: aba À receber funcional (status='pending', ordenada por mês)
- [x] Web: aba Repasses placeholder "Disponível com multi-tenancy"
- [x] Web: modal "Novo lançamento" (receita vincula inquilino, despesa vincula imóvel)
- [x] Activity log: `payment_recorded` (lançamento manual)
- [ ] Activity log: `payment_overdue` (cron job) — roadmap futuro
- [ ] Notif: bot avisa owner em atrasos > 5 dias — roadmap futuro
- [x] Commit

### Slice 8 — Dashboard (KPIs + activity + occupancy) ✅ DONE
**Por quê:** depende de tudo acima (activity_log, payments, leads enriched).

- [x] Web: KPI labels corretos (A RECEBER / RECEBIDO / EM ATRASO / LEADS ATIVOS)
- [x] Web: KPI delta % vs mês anterior
- [x] Web: KPI subtext linhas
- [x] Web: month chip no header + botão Exportar (stub)
- [x] Web: ocupação por empreendimento — barras com unit count + tooltip nome
- [x] Web: próximos vencimentos — nome do tenant + status pill (prio/atraso) + relative time
- [x] Web: activity feed — fetch `ActivityLog` últimos 10 + render "actor action subject"
- [x] Web: time filter toggle 30d/90d/12m (UI only)
- [x] Commit

### Slice 9 — Configurações (sidebar layout + 7 seções) ✅ DONE
**Por quê:** menor urgência operacional. Pode ser last.

- [x] Web: layout sidebar nav 220px + content panel
- [x] Web: Workspace section read-only (nome empresa, CNPJ, etc — hardcoded ou em env por ora)
- [x] Web: Integrações section — campos Evolution URL/instância (move da Conta)
- [x] Web: Notificações section — toggles
- [x] Web: Aparência section — dark mode wired
- [x] Web: Segurança stub
- [x] Web: Equipe stub ("Disponível com multi-tenancy")
- [x] Web: Plano stub ("Em breve")
- [x] Commit

---

## Fase 2 — Hardening pré-produção

> Antes de ligar dados reais e operar de verdade.

- [x] **Logs estruturados** — bot loga JSON via Pino; web captura erros via Sentry (ErrorBoundary + init)
- [x] **MSW removido** — handlers estavam vazios, dependência eliminada
- [x] **Variáveis env produção** — checklist em `docs/deploy.md`; ADR RLS em `docs/adrs/001-rls-strategy.md`
- [x] **Sentry completo** — source maps, `setUser` pós-login, router tracing (ver `docs/deploy.md` §Sentry)
- [ ] **RLS reativar** — policies implementadas e verificadas em `docs/adrs/001-rls-strategy.md`; falta só `ENABLE ROW LEVEL SECURITY` antes de prod com dados de terceiros
- [ ] **Backups Supabase** — confirmar policy de backup automático
- [x] **Bot deploy** — Railway (`kit-bot-novo-production.up.railway.app`)
- [x] **Web deploy** — Vercel (login Google OAuth + dashboard funcionando; guard por `Owner.email`)
- [x] **Evolution API deploy** — Railway (`evolution-api-production-c037.up.railway.app`)
- [ ] **Domínio + SSL** — usando subdomínios Railway/Vercel por ora
- [ ] **Onboarding dos próprios imóveis** — cadastrar você como Owner, importar imóveis existentes
- [x] **Conectar bot ao número de WhatsApp real** — instância `halugar` conectada

---

## Backlog de features sem design

> Features removidas da UI por não terem design ou backend definidos. Retomar quando houver spec.

- [ ] Property detail — aba Documentos do imóvel (escritura, IPTU, matrícula)
- [ ] Rules — aba Blocos reutilizáveis (cláusulas de contrato reutilizáveis)
- [ ] Rules — aba Templates completos
- [ ] Rules — aba Campos estruturados
- [ ] Finance — aba Relatórios exportáveis
- [ ] Templates — Variáveis globais: definir variáveis no nível do workspace (ex: nome da imobiliária, CNPJ, endereço) reutilizáveis em todos os templates sem redefinição; editor de variáveis globais nas Configurações; resolver automaticamente no `preview-contract` junto às variáveis locais do template

### Calendário de visitas

- [x] **V1 — Agenda interna + histórico:** filter chips de status; status derivado client-side; modal de edição/reagendamento com select de status ao clicar no card. Spec: `docs/superpowers/specs/2026-06-21-bot-toggle-visit-history-pwa-design.md`.
- [ ] **V2 — Responsável por visita por imóvel:** model `PropertyCoordinator` (nome + telefone WhatsApp) vinculado a `Property`; um imóvel pode ter múltiplos responsáveis; CRUD no detalhe do imóvel; cron de lembrete usa o responsável do imóvel em vez do proprietário quando configurado.
- [ ] **V3 — Lembretes automáticos de visita (cron):** cron job que roda a cada hora no bot; proprietário configura em Configurações quais offsets de antecedência quer (ex: 60 min, 24h, 48h — múltiplos, livre escolha); para cada visita futura, envia WhatsApp ao responsável (`PropertyCoordinator` do imóvel, ou `Owner.notificationPhone` se não houver) e ao lead (`Lead.phone`) em cada offset configurado; deduplicação via tabela `VisitReminderLog` (leadId + offsetMinutes + scheduledVisitAt) para não reenviar na próxima hora; se `Owner.botEnabled = false`, lembrete ao lead é suprimido mas lembrete ao responsável é enviado mesmo assim (é operacional).
- [ ] **V4 — Disponibilidade configurável:** proprietário define blocos de horário disponíveis para visita no painel; bot consulta esses blocos e só oferece datas/horários dentro da disponibilidade cadastrada (em vez de deixar o lead sugerir qualquer horário).
- [ ] **V5 — Google Calendar sync:** sincronização bidirecional com Google Calendar (OAuth); visitas agendadas aparecem na agenda do proprietário; confirmações/cancelamentos refletem no painel.

### Histórico e reativação de leads

- [ ] **Card "Reativado":** badge no card kanban quando `Lead.reactivatedAt != null` (implementado na Slice Funil — ver spec `2026-06-20`); badge adicional "KYC negado" quando histórico de `ActivityLog` registra rejeição.
- [ ] **Timeline do lead:** seção de histórico completo no detalhe do lead — todas as tentativas, stages percorridos, reativações e rejeições, em ordem cronológica.

### Sanitização de armazenamento

- [ ] **Cron de limpeza de `Event`:** deletar rows da tabela `Event` (histórico de conversa) com mais de N meses para leads em estágio terminal (`converted`, `archived`) — N a definir com base no custo real de armazenamento Supabase.
- [ ] **Política documentada:** definir regra de retenção por tipo de dado (Event, LeadDocument, ActivityLog) antes de implementar o cron.

### Perfil do proprietário para contratos

- [ ] **`Owner` — campos para auto-preenchimento de contrato:** adicionar campos `ownerName`, `ownerCpf`, `ownerAddress`, `ownerCnpj` (opcional) na tabela `Owner`; CRUD em Config > Workspace no painel admin; `getContractVariables` usa esses campos para resolver variáveis do tipo `{{nome_locador}}`, `{{cpf_locador}}`, `{{endereco_locador}}` etc.
- [ ] **Auto-fill de variáveis no modal "Aprovar KYC":** o endpoint `GET /admin/leads/:id/contract-variables` já auto-mapeia dados do lead e do imóvel; estender para incluir dados do `Owner` (locador) e dados do imóvel (endereço, bairro, valor, prazo); modal só exibe variáveis que realmente não foram resolvidas automaticamente — lista vazia deve resultar em aprovação direta sem abrir step 2.

### Bot — features pendentes

- [x] **Bot global disable toggle:** toggle em Config > Integrações que desliga o bot para todas as conversas simultaneamente; `Owner.botEnabled` flag no banco; webhook verifica flag com cache Redis 60s; Evolution permanece conectado (sem QR code). Spec: `docs/superpowers/specs/2026-06-21-bot-toggle-visit-history-pwa-design.md`.
- [~] **Funil completo lead → inquilino** — ver Slice 10 (em progresso): data_confirmation, email via Resend, auto-contrato + PDF, auto-tenant
- [ ] **Tenant flow Phase 2** — `handleTenantMessage` real: manutenção → classifica responsabilidade owner vs tenant → recomenda prestador ou vídeo
- [ ] **Model `ServiceProvider`** (eletricista, encanador, pedreiro) — schema + CRUD no painel + leitura pelo bot para recomendação
- [ ] **Boleto mensal automático** — integração com provedor (Asaas, Efí, etc.); cron mensal; inquilino notificado via WhatsApp
- [ ] OCR avançado — extração estruturada de CNH/RG/CPF (Slice 10 usa regex simples no ocrText existente)

### Infraestrutura e observabilidade

- [ ] Sentry no bot (`apps/bot`) — hoje só Pino; rastreamento de erros em produção
- [ ] Responsivo mobile do painel — diversas quebras identificadas em uso real
- [x] **PWA install-only:** `vite-plugin-pwa` com manifest + service worker mínimo; ícones gerados via `@vite-pwa/assets-generator`; instalável no Android (prompt nativo), iOS (Compartilhar → Add to Home) e desktop Chrome/Edge. Spec: `docs/superpowers/specs/2026-06-21-bot-toggle-visit-history-pwa-design.md`.

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

> Atualizado: 2026-07-15

| Fase | Status | Pendências |
|---|---|---|
| F0 — Foundation | 95% | F0.3 RLS (docs existem, policies desativadas); F0.4 in-app notif pendente |
| F1 — Slices 1–9 | ✅ 100% | — |
| Slice 10 — Funil completo | ✅ DONE | `contract_auto_created`/`contract_pdf_sent` activity logs opcionais |
| F2 — Hardening | 85% | RLS ativar; backups Supabase; domínio+SSL; onboarding imóveis reais |
| Auth web | ✅ DONE | Google OAuth + PKCE callback + guard por `Owner.email` (PR #27) |
| Lead flow v2 (bot pipeline) | ✅ prod (gated) | Cutover: `LEAD_FLOW_V2=true` após ≥1 sem. canário sem escalações |
| F3 — Dogfooding | pendente | Depende de F2 completo |

### PRs mergeados nesta sessão (2026-07-15)

| PR | Descrição |
|---|---|
| #23 | Card de imóvel vinculado no detalhe do lead |
| #24 | Seção de contratos (PDF emitido + assinado) no detalhe do lead |
| #25 | Resolução de variáveis de template com LLM second-pass |
| #26 | Fix acesso a PDF de contrato (storagePath + download forçado) |
| #27 | Google OAuth — rota `/auth/callback` (PKCE) + guard por `Owner.email` |

### Próximas prioridades

1. **Perfil do proprietário para contratos** — adicionar `ownerName`, `ownerCpf`, `ownerAddress`, `ownerCnpj` no model `Owner`; CRUD em Config > Workspace; `contract-variables` inclui dados do Owner no auto-map para resolver `{{nome_locador}}`, `{{cpf_locador}}` etc.
2. **RLS** — ativar policies antes de operar com dados reais de terceiros
3. **Variáveis globais de template** — definir no workspace, resolver junto às variáveis locais
4. **Calendário V2** — model `PropertyCoordinator` vinculado a `Property`

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
