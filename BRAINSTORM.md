# BRAINSTORM — kit-manager

> Registro da sessão de refinamento de produto e arquitetura.
> Data: 2026-05-22
> Objetivo: consolidar contexto, identificar brechas, decidir MVP, alimentar PRD/ROADMAP/SPECs.

---

## 0. Como usar este documento

- **PRD.md** — fonte da verdade do produto (persona, problema, MVP, métricas)
- **ROADMAP.md** — sequência priorizada com justificativas (vertical slices)
- **BRAINSTORM.md** (este) — histórico da sessão + decisões consolidadas + brechas em aberto + perguntas que voltam

Quando começar uma feature nova: ler BRAINSTORM → puxar contexto relevante → escrever SPEC específico em `specs/<feature>.md` → gerar plano em `tasks/<feature>-plan.md` → buildar.

---

## 1. Estado da arte (antes desta sessão)

### Maduro (manter)
- **Bot WhatsApp** em produção técnica. FSM, 3 LLMs em pipeline, comportamentos determinísticos, OCR, Redis, Evolution API.
- **Design system** (tokens, cores, raios, sombras) bem estabelecido no OVERVIEW.md.
- **Padrão de componentes** documentado em CLAUDE.md (`tv()`, `data-slot`, named exports, sem barrel files).
- **Stack decisions** coerentes: Bun, Fastify, Prisma, TanStack, Tailwind v4.
- **specs/*.md** com formato consistente (UI Gaps + Missing Features + Backend Requirements) por página.
- **CLAUDE.md** com restrições claras e explicitadas.

### Brechas identificadas
1. **Sem PRD** — só OVERVIEW.md (técnico) e ROADMAP.md (lista de features). Sem persona, problema, MVP delimitado, métricas.
2. **Ambiguidade single-owner vs PMC** — código é single-owner mas specs mencionam "Repasses para 16 proprietários" e "Equipe & permissões".
3. **Fase 1.5 ovo-galinha** — contrato/KYC bloqueado pelo admin, admin sem contrato é incompleto.
4. **`tasks/` deletado** — `tasks/plan.md` e `tasks/todo.md` sumiram. codeflow.md menciona pasta `/tasks` mas não existe mais.
5. **Activity feed sem schema** — Dashboard spec pede `activity_log` mas tabela não existe.
6. **Financeiro fantasma** — spec pede tipos de pagamento, repasses, mas schema só tem `Payment` básico.
7. **Notificações sem estratégia** — ROADMAP fala "SSE ou Supabase Realtime" mas não decidido.
8. **Sem ADRs** — decisões grandes (TanStack vs Next, supabase-js direto vs API, RLS desativada) sem registro de motivo.
9. **Lead schema incompleto** — falta `name`, `source`, `propertyId`.
10. **Property schema incompleto** — falta `area`.
11. **Tenant externalId** não enforced no create.

---

## 2. Entrevista — perguntas e respostas

### Q1: Persona alvo
**R:** Começa solo, evolui pra PMC.
**Implicação:** schema deve preparar multi-tenancy (org_id eventual) mas MVP é single-owner. Não implementar policies de org agora.

### Q2: Objetivo de negócio
**R:** Uso próprio + interesse de vender futuramente.
**Implicação:** dogfooding é o validador imediato. UX/qualidade de produto importam (não é só script pessoal).

### Q3: Definição de MVP
**R:** Ainda não sabia. → Refinado pela sessão: **todas as 9 páginas funcionais + bot atual + notif WhatsApp ao proprietário + financeiro com lançamento manual + contrato manual fora do sistema**.

### Q4: Bot em produção?
**R:** Funciona tecnicamente, mas não conectado em operação real ainda.
**Implicação:** janela boa pra ajustar bot junto com admin sem regressão em prod.

### Q5: Contrato + assinatura digital
**R:** Manual por agora. Sistema marca "contrato pendente" → "pago". Autentique fica para depois.
**Implicação:** Fase 1.5 (Autentique) sai do MVP. Templates ficam como source-of-truth para Word/PDF gerado e enviado fora do sistema.

### Q6: Financeiro
**R:** Visualizar + lançamento manual de pagamento.
**Implicação:** Sem conciliação bancária. Sem Repasses no MVP (placeholder na UI).

### Q7: Time
**R:** Solo + Claude.
**Implicação:** Documentação precisa estar otimizada para IA recuperar contexto entre sessões. ADRs leves valem a pena pra você mesmo no futuro.

### Q8: Papel dos Templates de contrato
**R:** Hoje não usado, mas futuro source-of-truth. Bot envia contrato gerado a partir de template quando locação fecha.
**Implicação:** Templates ficam no MVP como funcionalidade básica (editor + variáveis). Integração com geração de Word/PDF e envio via bot entra como vertical slice no MVP.

### Q9: Escala
**R:** 5–15 imóveis.
**Implicação:** Performance/pagination/filtros não são gargalo. UI prioriza clareza, não densidade.

### Q10: Notificações
**R:** Multi-canal: WhatsApp + email + in-app.
**Implicação:** Trabalho considerável. Resend (ou similar) pra email; Supabase Realtime pra in-app; Evolution API pra WhatsApp ao próprio proprietário.

### Q11: RLS
**R:** Você decide.
**Decisão proposta:** reativar antes do MVP em produção, mesmo sendo single-owner. Prepara base pra multi-tenant e reduz risco se anon key vazar.

### Q12: Hosting
**R:** Free tier inicial, VPS futuro.
**Implicação:** Vercel (web) + Railway/Fly free (bot + Evolution + Redis). Não otimizar pra cold start agora.

### Q13: Activity log — quem escreve?
**R:** Web e bot escrevem.
**Implicação:** Cada mutation (bot endpoint + supabase-js direct call) deve emitir `activity_log` row. Convencionar helper compartilhado.

### Q14: Cortes do MVP
**R:** Não cortar nada — "pessoas que querem gerenciar seus imóveis sem ter dor de cabeça e com todas as informações consolidadas."
**Implicação:** Todas 9 páginas no MVP. Algumas com versão simples (Repasses placeholder, Equipe stub, etc).

### Q15: Bot todos pendentes
**R:** Notificações WhatsApp ao proprietário entra junto.
**Implicação:** OCR retry + Whisper áudio ficam fora do MVP.

### Q16: Migration strategy
**R:** Por feature, conforme precisar.
**Implicação:** Cada vertical slice traz sua migration. Sem big bang. Trade-off aceito: schema cresce orgânico, pode ter inconsistência temporária.

### Q17: Sequência do MVP
**R:** Vertical slices por página.
**Implicação:** Cada página vira um slice completo (schema → query → UI → endpoint → notif). Entregas visíveis contínuas. ROADMAP organiza ordem das slices.

### Q18: Saída desta sessão
**R:** Três arquivos: PRD.md (produto, fonte da verdade) + BRAINSTORM.md (sessão) + ROADMAP.md atualizado (sequência priorizada).
**Implicação:** Cada arquivo tem responsabilidade distinta. Sem duplicação. Cross-referência entre eles.

---

## 3. Decisões consolidadas

### D1 — Persona MVP
Solo proprietário (você) com 5–15 imóveis. Evolução pra outros proprietários (validação) e PMC (Fase 5+).

### D2 — Modelo de dados
Schema single-owner hoje. Tabelas que vão precisar de `org_id` no futuro: `Property`, `Tenant`, `Lead`, `Payment`, `Contract`, `RuleSet`, `ContractTemplate`. **Não adicionar `org_id` agora.** Refator quando for migrar.

### D3 — Contrato manual fora do sistema (MVP)
Template gera Word/PDF baixável. Proprietário envia por fora. Sistema marca progressão de status (`contract_pending` → `contract_signed` → `confirmed_payment`). Autentique fica para fase posterior.

### D4 — Activity log convencional
Tabela `activity_log` com `actor`, `action`, `subject`, `subject_id`, `subject_type`, `created_at`, `metadata jsonb`. Bot escreve via Prisma; web escreve via supabase-js (ou via endpoint do bot conforme caso).

### D5 — Multi-canal notif
- **WhatsApp pro proprietário**: Evolution API, número do owner em env (`OWNER_PHONE`). Para eventos críticos (KYC pronto, contrato pago, atraso > 5 dias).
- **Email**: Resend ou similar. Diário/semanal. Resumo de operação.
- **In-app**: badge no sidebar + toast. Realtime via Supabase Realtime subscriptions na tabela `activity_log`.

### D6 — RLS reativar antes de produção
Mesmo single-owner, ativar RLS com policies para `authenticated` role (proprietário logado lê tudo) e `service_role` (bot escreve tudo). Anon key sem permissão de leitura.

### D7 — `tasks/` reaparece
Recriar pasta `tasks/` com novo padrão: `tasks/<slice>-plan.md` por vertical slice. Plano detalhado por feature antes de buildar.

### D8 — ADRs leves
Criar `adrs/` com decisões grandes: D1–D8 desta sessão viram ADRs numeradas. Formato curto (1 página). Adicionar quando decisão for irreversível ou contraintuitiva.

### D9 — Vertical slice — anatomia
Cada slice contém:
1. Schema migration (se necessário)
2. Tipos compartilhados em `packages/types`
3. Query/mutation em `apps/web/src/lib/queries.ts` ou `apps/web/src/lib/api.ts`
4. Endpoint bot em `apps/bot/src/routes/admin/` (se mutation)
5. UI completa na rota
6. Activity log emit nos pontos relevantes
7. Notificação (se aplicável)
8. Teste mínimo (smoke)
9. Commit por slice

### D10 — Status atual visto
Páginas e maturidade:
| Página | Status | Próximo passo no slice |
|---|---|---|
| Leads | Funcional, schema incompleto | Kanban card rico (name/source/property), schema migration |
| Properties | Funcional, falta `area`, UI gaps | Schema `area` + card visual + filtros |
| Tenants | Funcional, falta STATUS + IMÓVEL join | Query join + UI status pill + externalId |
| Contracts | Lista + detalhe (uncommitted) | Geração Word/PDF + integração template |
| Templates | Editor funcional | Geração de doc + chip variáveis + status pill |
| Rules | CRUD ok | UI gaps (3-way toggle, propagação) |
| Finance | Static | KPIs reais + transactions table + lançamento manual |
| Dashboard | Static | KPIs reais + activity feed + occupancy real |
| Config | Card grid antigo | Sidebar layout + 7 seções |

---

## 4. Decisões da rodada B1–B14 (fechadas em 2026-05-22)

### B1 — Lib geração de PDF ✓
**Decisão:** `pdfkit`.
**Por quê:** simples, leve (~5MB), maduro (2014+), API estável, sem Chromium, free-tier friendly. Layout suficiente pra contrato formal (texto + cláusulas).
**Trade-off aceito:** menos visual que `puppeteer`. Pode evoluir depois.

### B2 — Onde gerar PDF ✓
**Decisão:** Bot (Fastify). Endpoint `GET /admin/contracts/:id/pdf`. Cache no Supabase Storage após primeira geração (chave `contracts/{id}.pdf`).

### B3 — Como bot envia contrato pro lead ✓
**Decisão:** Evolution `sendMedia(pdfUrl, 'application/pdf')`. PDF puro no MVP.
**Futuro (Fase 6):** link Autentique substitui PDF estático.
**Pendente validar:** se Evolution API aceita PDF MIME nativamente. Se não, fallback é link signado do Storage.

### B4 — Canal WhatsApp notif owner ✓
**Decisão:** Mesma instância Evolution do bot. Bot envia ao número pessoal do owner (cadastrado em Workspace settings).
**Não há segunda instância.**
**Feature complementar:** ver B14.

### B5 — Email transacional ✓
**Decisão:** Resend. Free tier 100/dia + 3000/mês. Setup simples, API moderna. Migra pra SES só se custo escalar.

### B6 — Stage `visiting` no FSM ✓
**Decisão:** Não criar novo stage. Mapear FSM existente → colunas do kanban:
| Coluna Kanban | FSM states |
|---|---|
| Novo | `start`, `offer_options` |
| Qualificação | `property_info`, `objection_handling` |
| Visita agendada | `visit_scheduling`, `visit_requested`, `post_visit_decision` |
| Proposta | `collect_application`, `review_submitted`, `kyc_pending`, `kyc_approved`, `residents_docs_complete`, `contract_pending` |
| Ganho | `contract_signed`, `converted` |
**Por quê:** FSM já cobre todos os estados conceituais. Adicionar `visiting` dobra estado sem ganho.

### B7 — Enum `Property.status` ✓
**Decisão:** 5 valores: `available | rented | maintenance | reserved | archived`.
- `available`: disponível pra locação
- `rented`: atualmente alugado
- `maintenance`: em obras/manutenção
- `reserved`: reservado (lead em fase final, sem contrato ainda)
- `archived`: removido do catálogo (soft delete)
**Filtros do design:** "Disponível" = available; "Alugado" = rented; "Inativo" = maintenance + archived.

### B8 — `ownerId` em todas as tabelas ✓
**Decisão:** Adicionar agora. Migration na Foundation F0.5.
**Tabelas:** Property, Tenant, Lead, Payment, Contract, RuleSet, ContractTemplate, PropertyMedia, LeadDocument, ActivityLog, Conversation, Event.
**Hoje:** single-owner. Todos os rows recebem mesmo `ownerId` (do único Owner).
**Futuro:** trivial migrar pra multi-owner — só popular `ownerId` correto por org/user.
**RLS:** policies por `ownerId` viram triviais quando ativarmos.

### B9 — ContractTemplate `usageCount` ✓
**Decisão:** Computed em query. `COUNT(contracts WHERE template_id=...) AS usageCount`.
**Por quê:** 5–50 templates é trivial pra COUNT. Sem trigger (magia escondida). Sem coluna materializada (risco de inconsistência). Sempre correto, zero config.

### B10 — Rule Set propagação ✓
**Decisão:** Cortar do MVP. UI fica (toggles + descrição) mas sem efeito real.
**Comportamento MVP:** Duplicar rule set → copia tudo. Toggles são UI-only.
**Quando refinar:** quando uso real exigir. Vira SPEC dedicado.

### B11 — Lead source ✓
**Decisão:** Extrator LLM detecta. Adicionar campo `source` no schema do extrator (Zod). Valores: `olx | zap | site | instagram | indicacao | outro | desconhecido`.
**Por quê:** flexível, captura linguagem natural ("vi na OLX", "peguei no anúncio do ZAP"). Sem necessidade de configurar mapeamento por instância Evolution.
**Fallback:** se LLM não identifica, `source = 'desconhecido'`. Owner pode corrigir manualmente no admin (dropdown).

### B12 — ExternalId atômico ✓
**Decisão:** PostgreSQL sequences + format string.
```sql
CREATE SEQUENCE property_external_seq START 1;
CREATE SEQUENCE tenant_external_seq START 100;
CREATE SEQUENCE lead_external_seq START 1;
-- contract: ano + sequence (CT-YYYY-XXXX)
CREATE SEQUENCE contract_external_seq START 1;
```
**Bot ao inserir:** `externalId = 'IM-' + pad(nextval('property_external_seq'), 4)`.
**Por quê:** atômico nativo, sem dep Redis, padrão Prisma, sem race condition.

### B13 — OVERVIEW.md update
**Pendente** (não-bloqueante). OVERVIEW.md mistura estado "ideal" e "atual". Refatorar pra:
- **OVERVIEW.md** = arquitetura corrente (técnica, como funciona hoje)
- **PRD.md** = direção (já criado)
- **ROADMAP.md** = sequência (já criado)
- **SPECs por feature** = `specs/<feature>.md`
- **ADRs por decisão imutável** = `adrs/NNN-titulo.md`

Não bloquear progresso por isso. Atualizar OVERVIEW após primeiras slices.

### B14 — Feature: "Owner assume conversa" (pausa bot por chat) ✓
**Decisão:** Implementar no MVP. Faz parte do Slice 1 (Leads) — UI no detalhe do lead.
**Schema:** adicionar `Conversation.botPaused boolean default false`.
**Bot:** no router de webhook, se `conversation.botPaused === true`, ignora mensagem (não invoca LLM, não responde, mas pode logar `event` pra histórico).
**Admin (web):** toggle "Pausar bot" no header do detalhe do lead. PATCH endpoint `/admin/leads/:id/pause-bot`.
**UX:** quando pausado, badge visual "Bot pausado — você assume". Owner manda mensagem direto via WhatsApp normal (fora do sistema). Bot reativa por toggle ou expiração (24h?).
**Activity log:** `bot_paused`, `bot_resumed`.

---

## 5. Convenções desta sessão (não desbloqueia agora, mas registrar)

### C1 — Estrutura de pastas
```
/
├── PRD.md                ← produto: persona, problema, MVP, métricas
├── BRAINSTORM.md         ← sessões de refinamento + decisões
├── ROADMAP.md            ← sequência priorizada de slices
├── CLAUDE.md             ← restrições e padrões pro Claude
├── OVERVIEW.md           ← arquitetura atual (técnica)
├── codeflow.md           ← processo SPEC → PLAN → BUILD → SIMPLIFY → REVIEW
├── specs/<feature>.md    ← spec detalhado por feature/slice
├── tasks/<slice>-plan.md ← plano executável por slice
├── adrs/NNN-titulo.md    ← decisões arquiteturais imutáveis
├── apps/bot/
├── apps/web/
└── packages/types/
```

### C2 — Slice → Spec → Plan → Build → Review
Cada slice no ROADMAP cita o spec correspondente. Cada spec gera um plan. Cada plan executa o build. Após build, review automatizado. Pipeline reflete codeflow.md.

### C3 — Activity log keys
- `actor`: 'system' | userId | botUserId
- `action`: snake_case: `kyc_approved`, `contract_generated`, `payment_confirmed`, `property_published`, `lead_created`, etc.
- `subject_type`: 'lead' | 'tenant' | 'property' | 'contract' | 'payment'
- `metadata jsonb`: dados extras específicos da ação

### C4 — Nomenclatura externalId
- Properties: `IM-XXXX` (4 dígitos)
- Tenants: `IQ-XXX` (3 dígitos)
- Leads: `LD-XXXX` (4 dígitos)
- Contracts: `CT-YYYY-XXXX` (ano + 4 dígitos)
- Templates: `CT-AA-NN` (placeholder genérico)

---

## 6. Próximos passos

1. **Validar este BRAINSTORM** com você.
2. **Validar ROADMAP** (a ser escrito) com sequência sugerida.
3. **Decidir B1 (PDF lib), B4 (Evolution canal), B8 (owner_id preparation)** antes de começar slices.
4. **Escolher 1ª slice** a executar. Sugestão: **Foundation slice 0** — activity_log + helpers (não tem UI mas destrava várias slices).
5. **Para cada slice subsequente**: rodar `/spec` → `/plan` → `/build` conforme codeflow.md.

---

## 7. Apêndice — refs cruzadas

- Produto: [PRD.md](./PRD.md)
- Sequência: [ROADMAP.md](./ROADMAP.md)
- Arquitetura atual: [OVERVIEW.md](./OVERVIEW.md)
- Restrições: [CLAUDE.md](./CLAUDE.md)
- Processo: [codeflow.md](./codeflow.md)
- Specs por feature: [specs/](./specs/)
