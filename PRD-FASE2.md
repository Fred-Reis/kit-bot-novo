# PRD — Fase 2: Fluxo do Inquilino (Tenant)

> **Documento-mestre de execução da Fase 2.** Base para TODAS as tarefas desta fase.
> Criado: 2026-07-27 · Design aprovado: [`docs/superpowers/specs/2026-07-27-tenant-flow-phase2-design.md`](docs/superpowers/specs/2026-07-27-tenant-flow-phase2-design.md)
> Produto geral: [`PRD.md`](PRD.md) · Regras de negócio do tenant: [`tenant-flow.md`](tenant-flow.md) §3–§9

---

## 🔁 Prompt de restart (colar em sessão nova)

> Quando o contexto zerar ou uma sessão nova começar, cole isto:

```
Leia PRD-FASE2.md (documento-mestre da Fase 2 do kit-manager) e a spec
docs/superpowers/specs/2026-07-27-tenant-flow-phase2-design.md.

Olhe a seção "Tracking de execução" do PRD-FASE2.md e identifique a próxima
etapa não concluída (primeiro checkbox vazio, respeitando a ordem das slices
e as dependências).

Continue EXATAMENTE de onde parou, seguindo o pipeline obrigatório do
superpowers definido no PRD-FASE2.md §Pipeline (brainstorm → spec → plan →
build → simplify → review). Invoque a skill do superpowers correspondente à
etapa atual antes de qualquer ação.

Regras da casa: bun (nunca npm/yarn), nunca Python, nunca commitar em main —
feature branch + PR via gh, merge é sempre do Fred. Review local com
agent-skills:code-review-and-quality; CodeRabbit roda nos PRs.

Ao concluir qualquer etapa, marque o checkbox correspondente no
PRD-FASE2.md (mesmo commit da etapa) para o tracking nunca ficar defasado.
```

---

## Pipeline obrigatório por slice (fluxo superpowers)

**Toda slice passa por todas as etapas, nesta ordem.** Nenhuma etapa é pulada — nem em slice "simples".

| Etapa | Skill | Saída | Gate |
|---|---|---|---|
| 1. Brainstorm | `superpowers:brainstorming` | Dúvidas de design da slice resolvidas (se o design aprovado já cobre, registrar "sem deltas" e seguir) | Aprovação do Fred se houver delta de design |
| 2. Spec | seção da slice na spec aprovada + refinamentos | Spec da slice fechada (critérios de aceite claros) | Sem TBDs/ambiguidade |
| 3. Plan | `superpowers:writing-plans` | `docs/superpowers/plans/YYYY-MM-DD-<slice>-plan.md` — tasks pequenas, verificáveis, com critérios | Plano revisado |
| 4. Build | `superpowers:executing-plans` + `superpowers:test-driven-development` | Código + testes passando (`bun test`, `bunx tsc --noEmit` em cada app) | Suite 100% verde |
| 5. Simplify | `agent-skills:code-simplification` | Complexidade removida sem mudar comportamento | Diff revisado |
| 6. Review | `agent-skills:code-review-and-quality` local → PR (`gh pr create`) → CodeRabbit no PR → loop CI/feedback até limpo | PR limpa aguardando merge | **Merge é do Fred** |

Convenções fixas:
- 1 slice = 1 feature branch = 1 PR. Slice incompleta não abre PR.
- Cada slice inclui: migration (se houver) → `packages/types` → bot → web → testes → activity log → notif.
- Todo checkbox concluído é marcado **neste arquivo, no mesmo commit** da etapa.

---

## Visão

Hoje inquilino recebe silêncio (`flows/tenant/index.ts` = stub). A Fase 2 entrega o bot atendendo as 3 trilhas do inquilino (financeiro, manutenção, info/reclamação) como intermediário formal — tudo registrado, owner notificado, escalação quando o bot não dá conta — mais o painel mínimo para operar (prestadores de serviço, chamados e reclamações).

Arquitetura: **agente único + tools (padrão lead v2)**, snapshot factual com cache Redis, overrides determinísticos (saudação, áudio, emergência), pipeline determinístico de mídia. Detalhes: ver spec.

Decisões fechadas: T-D1 a T-D6 na spec §2.

---

## Slices

### Fase 2.0 — Core tenant

| # | Slice | Resumo | Depende de |
|---|---|---|---|
| **T1** | Fundação | Snapshot + cache `tenant:{phone}`; fix `botPaused` no router; overrides (saudação/áudio/emergência hardcoded); agente único + dúvidas informativas | — |
| **T2** | Reclamações | Model `Complaint` + tool + notif owner + seção no detalhe do tenant | T1 |
| **T3** | Manutenção | Models `MaintenanceRequest`+`ServiceProvider`; `docs/lei-inquilinato-resumo.md`; tools `abrir_chamado`/`indicar_profissional`; fotos anexadas (`mediaUrls`); página `/providers`; chamados+galeria no painel | T1 |
| **T4** | Financeiro | Tool `status_pagamentos` (lê `Payment`+`dueDay`); negociação → `escalar_owner` | T1 |
| **T5** | Comprovante PIX | Classificador OCR de comprovante; notif "sinalizou pagamento"; confirmação manual no painel | T1, T4 |

### Fase 2.1 — Percepção (só começa com 2.0 em produção)

| # | Slice | Resumo | Depende de |
|---|---|---|---|
| **T6** | Triagem visual | Vision **sugere** tipo/severidade da foto do chamado; agente confirma com inquilino; nunca decide sozinha | T3 |
| **T7** | Áudio (lead+tenant) | Transcrição `gpt-4o-mini-transcribe` (fallback `whisper-1`); máx 2 min; flag `AUDIO_TRANSCRIPTION_ENABLED` | T1 |

---

## Tracking de execução

> Legenda: `[ ]` todo · `[~]` em progresso · `[x]` done · `[!]` blocked
> **Regra: marcar checkbox no mesmo commit que conclui a etapa.**

### Preparação (P0)

- [x] Brainstorming da fase (2026-07-27) — decisões T-D1..T-D6
- [x] Spec de design escrita e aprovada (`2026-07-27-tenant-flow-phase2-design.md`)
- [x] Auditoria checkboxes vs código (ROADMAP/PRD corrigidos)
- [x] Este PRD-FASE2.md criado
- [x] PR de docs aberta e mergeada pelo Fred (PR #37, 2026-07-28)

### T1 — Fundação

- [x] 1. Brainstorm da slice — delta T-D7 registrado na spec (§2): `escalar_owner` entra já na T1 pra cobrir trilhas ainda não implementadas (manutenção/financeiro), nunca silêncio
- [x] 2. Spec da slice fechada — design §3 (arquitetura + snapshot + tools) + T-D7 cobrem os critérios de aceite; sem TBDs
- [x] 3. Plan (`docs/superpowers/plans/2026-07-27-t1-fundacao-plan.md`) — 10 tasks TDD, self-review aplicado
- [x] 4. Build (TDD): snapshot + cache + invalidação (`flows/tenant/context.ts`)
- [x] 4. Build (TDD): fix `botPaused` no branch tenant do `router.ts` (bug real confirmado por teste antes do fix)
- [x] 4. Build (TDD): overrides determinísticos (saudação / áudio / emergência+notif) (`flows/tenant/intents.ts`)
- [x] 4. Build (TDD): agente único `agents/tenant-v2.ts` + prompt + dúvidas informativas via snapshot (reusa `agents/agent-runner.ts`, extraído do lead v2)
- [x] 4. Build: `Event` em toda interação; `ActivityLog` nos eventos relevantes (escalação, emergência) — mesmo padrão do lead flow
- [x] 5. Simplify — agent-skills:code-simplify aplicado; código já enxuto (guard clauses, sem duplicação nova); único ajuste: normalizada ordem persist→send nos 4 branches determinísticos do orquestrador (estava send→persist, inconsistente com o branch feliz e com o precedente do lead flow)
- [x] 6. Review local → PR → CodeRabbit limpo → merge do Fred — review local (5 eixos) + **2 reviews independentes rigorosas** (superpowers general-purpose seguindo `code-reviewer.md` + `agent-skills:code-reviewer`), ambas re-executando a suite em vez de confiar nos commits. Achados convergentes corrigidos (ver abaixo). PR aberta, aguardando CodeRabbit + merge do Fred

**Achados das reviews rigorosas (2026-07-27) — todos corrigidos:**
- **Critical (as duas reviews, independentemente):** `escalateTenantToOwner` commitava `botPaused=true` e então aguardava `sendText`/`logActivity` sem isolamento — uma falha (ex: Evolution API fora do ar) deixava o inquilino preso em silêncio pra sempre, sem o owner ser avisado. Corrigido: `Promise.allSettled` + `.catch()` independente por efeito colateral, espelhando `lead/escalation.ts`. Teste adicionado forçando falha do `sendText` e provando que `notifyOwner`/`logActivity`/`Event` ainda rodam.
- **Important:** a resposta que `escalateTenantToOwner` manda ao inquilino nunca era persistida em `Event` (o `persistTurn` do orquestrador sempre passava `null`) — quebra a regra 6 do design. Corrigido: `escalateTenantToOwner` agora persiste seu próprio `Event`, cobrindo inclusive o caminho via tool `escalar_owner` (que cruza a fronteira do LLM e o orquestrador não enxerga).
- **Important (achado real, minha auto-avaliação anterior estava errada):** `router-bot-paused.test.ts` mockava `@/flows/tenant/index`/`@/agents/tenant-v2` por completo — colidia com `index.test.ts`/`tenant-v2-runner.test.ts`, que importam esses módulos de verdade. Um `bun test` puro (sem escopo) falhava 5-8 testes. Eu tinha documentado isso como "gap aceito dado o escopo do script real" — as duas reviews corretamente rejeitaram essa racionalização (`bun test` puro é o comando mais natural de rodar). Reescrito pra exercitar o `handleTenantMessage` real via mocks de dependência-folha só.
- **Important:** `bun run lint` estava quebrado (2 erros oxlint novos, nunca rodado durante a build original) — import não usado + variável de teste não usada. Corrigido.
- **Important:** `invalidateTenantSnapshotCache` nunca era chamado em produção, apesar do design (§3.1) já prever isso — `POST /admin/payments` (único write path real que toca tenant) agora invalida o cache em pagamentos de receita.
- **Important/Suggestion (as duas reviews, exemplos convergentes):** `detectEmergency` tinha falsos negativos reais em PT-BR ("cheiro de queimado", "vazamento de gás" sem a palavra "cheiro", sinônimos de alagamento) — mensagens de emergência caindo no caminho do LLM em vez do hardcoded (viola regra 5). Lista de termos ampliada + testes de regressão. Falso-positivo ("fogos de artifício") aceito como trade-off documentado (favorece pegar emergência real sobre evitar alarme falso ocasional).
- **Minor:** gap pré-existente no script de teste (`bun test src/__tests__` nunca varria `flows/*/__tests__`, sem CI) — ambas reviews marcaram como risco que se acumula a cada slice nova. Corrigido: `"test": "bun test src"` — `bun run check` agora é um gate completo de verdade.
- **Minor:** wording do design §3.1 ("via `catalog.ts`") desatualizado — T1 usa `include` direto na query do `Tenant` (mais eficiente, evita segunda consulta+cache redundante). Nota adicionada no design doc.
- **Aceito como simplificação da T1 (ambas reviews concordam):** `escalar_owner` sempre grava `reason: 'out_of_scope'` mesmo quando o prompt do agente instrui chamá-la por pedido de humano ou frustração — perde a distinção na notificação ao owner. Revisitar em T2+ quando mais tools/tracks existirem.

Verificação final pós-fixes: `bun run check` (typecheck + lint + test, varredura completa) limpo — 221 pass, 0 fail, 0 erros de lint.

**Rodada CodeRabbit na PR #38 (2026-07-28) — triada com julgamento, não aceita cegamente:**
- **Corrigido (achado real que as 2 reviews anteriores não pegaram):** `buildTenantSnapshot` não tratava o cache como best-effort — falha do Redis ou JSON corrompido lançava exceção síncrona, que escapava do orquestrador direto pro catch externo, produzindo silêncio total (pior que o caso "snapshot ausente" já tratado). Regra 8 do design cita "corrompido" explicitamente. Corrigido: `redis.get`+`JSON.parse` e `redis.set` isolados em try/catch próprios.
- **Corrigido (achado mais grave que qualquer coisa pega pelas 2 reviews anteriores):** no branch de emergência (`flows/tenant/index.ts`), `notifyOwner` rodava DEPOIS de `persistTurn`/`sendText`/`buildTenantSnapshot` — uma falha de banco ou Evolution durante uma emergência real (incêndio/gás/alagamento) impedia o aviso ao proprietário, o efeito colateral mais importante desse caminho. Corrigido com `Promise.allSettled`, mesmo padrão já usado em `escalateTenantToOwner`.
- **Corrigido (nitpick aceito — barato e resolve a simplificação documentada acima):** `escalateTenantToOwner` ganhou parâmetro opcional `detail`; a tool `escalar_owner` agora repassa o `motivo` do LLM pro label enviado ao owner e pro `ActivityLog.metadata`, sem expandir o enum `TenantEscalationReason`.
- **Corrigido:** `POST /admin/payments` agora usa `await` na invalidação do cache (antes fire-and-forget) — fecha uma corrida onde uma mensagem do inquilino logo após a confirmação do pagamento ainda podia ler o snapshot pré-pagamento.
- **Recusado com justificativa (não é "aceitar tudo que o CodeRabbit sugere"):** CodeRabbit também marcou o teste de falha do `sendText` em `escalation.test.ts` como não-resiliente de verdade, querendo entrega garantida ao inquilino via retry/outbox quando a Evolution API cai. É um gap real em termos absolutos, mas nenhum outro ponto de envio deste bot tem infra de retry/outbota — o padrão do lead flow inteiro é fire-and-best-effort. Construir isso só pra este call site é desproporcional pra uma slice de fundação. O que as 2 reviews independentes realmente pediram (owner nunca fica sem saber que o inquilino travou) já está fechado; entrega garantida é investimento maior, a se fazer deliberadamente quando/se T2+ precisar, não um patch da T1.

Verificação final pós-CodeRabbit (1ª rodada): `bun run check` limpo — 226 pass, 0 fail, 0 erros de lint.

**2ª rodada CodeRabbit (2026-07-28) — pegou algo que a 1ª rodada + as 2 reviews independentes não pegaram:**
- **Corrigido:** mesmo depois da resiliência a falhas, `buildTenantSnapshot(chatId)` no branch de emergência ainda era `await`ado sequencialmente ANTES do `Promise.allSettled` — uma conexão Redis/Prisma travada (nenhum dos dois clientes tem `connectTimeout`/`commandTimeout` explícito) atrasaria `notifyOwner` indefinidamente, não só em caso de falha, mas de lentidão. Corrigido: lookup do nome do imóvel corre contra um teto de 2s (`EMERGENCY_SNAPSHOT_TIMEOUT_MS`) e só é encadeado na entrada do `notifyOwner`, nunca aguardado antes do batch — `sendText`/`persistTurn`/`logActivity` disparam no mesmo tick independente de quão lento o snapshot esteja. Teste prova: `findUnique` que nunca resolve ainda deixa a chamada inteira completar em ~2s.
- **Recusado com justificativa:** CodeRabbit também pediu `connectTimeout`/`commandTimeout` explícitos nos clientes globais de Redis/Prisma. Mudança de config que afeta TODOS os outros caminhos do bot (lead flow, upload de mídia, cache de propriedade etc.) — desproporcional e mais arriscado que o escopo desta slice; merece ser feito deliberadamente, com seu próprio teste, não como efeito colateral de um PR de tenant flow. O cap via `Promise.race` já resolve o objetivo real deste branch sem tocar config global.

Verificação final pós-2ª rodada: `bun run check` limpo — 227 pass, 0 fail, 0 erros de lint.

**3ª rodada CodeRabbit (2026-07-28):** confirmou o fix da 2ª rodada (✅ Addressed). Achado novo, Minor: o teste que prova o teto de 2s (hang de `findUnique`) não tinha timeout próprio — uma regressão futura reintroduzindo o bloqueio faria o teste travar até o timeout genérico de 5s do bun disparar, em vez de falhar rápido com mensagem clara. Corrigido: `Promise.race` local com timeout de 2900ms e mensagem própria.

Verificação final pós-3ª rodada: `bun run check` limpo — 227 pass, 0 fail, 0 erros de lint.

**Review manual do Fred (2026-07-28):** `Promise.race` no branch de emergência não cancelava a entrada perdedora — quando `buildTenantSnapshot` resolvia rápido (o caso comum, Redis/DB saudáveis), o `setTimeout` de fallback ficava armado até disparar sozinho de qualquer forma. Em volume, um timer vazado por emergência resolvida rápido. Corrigido: id do timer capturado e limpo em `.finally()` sobre a race, mesmo padrão guard-timer já usado no teste que prova o teto.

Verificação final: `bun run check` limpo — 227 pass, 0 fail, 0 erros de lint.
- [x] Merge (Fred) — PR #38 mergeada (`560bc61`, 2026-07-28)

### T2 — Reclamações

- [x] 1. Brainstorm da slice (2026-07-29) — sem deltas de design; design §3.2/§4/§5 já fecha os critérios de aceite. Decisões de implementação (replicam padrões existentes): tool `registrar_reclamacao` no padrão `registrar_renda` (retorna texto pro LLM, não pausa bot); notif `tenant_complaint` fire-and-forget (padrão `agendar_visita`); migration `Complaint` com RLS inerte via só `CREATE POLICY` (sem `ENABLE`/`FORCE` — lição do bug do PR #38); `PATCH /admin/complaints/:id` no padrão `coordinators.ts`, sem GET dedicado (painel lê via supabase-js, RLS inerte); seção "Chamados & Reclamações" no painel só com reclamações por ora (T3 estende com manutenção depois). Aprovado pelo Fred.
- [x] 2. Spec da slice fechada — design §3.2 (tool), §4 (model `Complaint`), §5.2 (painel), §7 (regras 1-8) cobrem os critérios de aceite; sem TBDs
- [x] 3. Plan (`docs/superpowers/plans/2026-07-29-t2-reclamacoes-plan.md`) — 7 tasks TDD: types compartilhados; migration `Complaint` + RLS inerte; notif `tenant_complaint`; tool `registrar_reclamacao` + prompt do agente; endpoint `PATCH /admin/complaints/:id`; seção "Chamados & Reclamações" no painel; verificação final
- [x] 4. Build (TDD): migration `Complaint` + RLS inerte + types — `prisma migrate dev --create-only` não funciona neste repo (P3006 no shadow-db, documentado em `docs/superpowers/plans/2026-07-18-lead-conversion-and-login-fixes.md`); migration escrita à mão no formato do Prisma, aplicada via `prisma db execute` + `prisma migrate resolve --applied`
- [x] 4. Build (TDD): tool `registrar_reclamacao` + notif owner + confirmação ao tenant — padrão `registrar_renda` (não pausa o bot); prompt do agente atualizado para chamar a tool em reclamação formal
- [x] 4. Build (TDD): endpoints `PATCH /admin/complaints/:id` + leitura web — sem GET dedicado, painel lê via supabase-js (RLS inerte, mesmo padrão do resto do painel)
- [x] 4. Build: seção "Chamados & Reclamações" no detalhe do tenant (parte reclamações) — `ComplaintsSection` presentational (sem `useMutation` interno, mutação vive na rota, igual `$leadId.tsx`)
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

Verificação final: bot `bun run check` limpo (233 pass, 0 fail, 0 erros de lint); web `bunx tsc --noEmit` + `bun run lint` (0 erros, mesmo baseline de warnings pré-existente) + `bunx vitest run` limpo (122 pass, 0 fail).

### T3 — Manutenção

- [ ] 1. Brainstorm da slice
- [ ] 2. Spec da slice fechada
- [ ] 3. Plan
- [ ] 4. Build (TDD): migration `MaintenanceRequest` + `ServiceProvider` + RLS inertes + types
- [ ] 4. Build: `docs/lei-inquilinato-resumo.md` (conteúdo revisado pelo Fred)
- [ ] 4. Build (TDD): tool `abrir_chamado` (responsabilidade/tipo/severidade; owner/unclear/urgente → notif)
- [ ] 4. Build (TDD): tool `indicar_profissional` (só do banco; vazio → honestidade)
- [ ] 4. Build (TDD): pipeline de mídia anexa foto em chamado aberto (`mediaUrls`)
- [ ] 4. Build (TDD): endpoints `GET/POST/PATCH /admin/providers` + `PATCH /admin/maintenance/:id`
- [ ] 4. Build: página `/providers` (tabela + modal + toggle ativo)
- [ ] 4. Build: chamados + galeria de fotos no detalhe do tenant
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

### T4 — Financeiro

- [ ] 1. Brainstorm da slice
- [ ] 2. Spec da slice fechada
- [ ] 3. Plan
- [ ] 4. Build (TDD): tool `status_pagamentos` (leitura `Payment` + `Tenant.dueDay`)
- [ ] 4. Build (TDD): negociação/desconto/parcelamento → `escalar_owner` (botPaused + notif)
- [ ] 4. Build (TDD): guardrail — nunca confirmar pagamento sem registro
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

### T5 — Comprovante PIX

- [ ] 1. Brainstorm da slice
- [ ] 2. Spec da slice fechada
- [ ] 3. Plan
- [ ] 4. Build (TDD): classificador OCR de comprovante (fixtures reais) no pipeline de mídia
- [ ] 4. Build (TDD): extração valor+data → notif owner "sinalizou pagamento" + resposta ao tenant
- [ ] 4. Build: ação "Confirmar pagamento" no painel (`Payment.status = paid`) + activity log
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

### T6 — Triagem visual (fase 2.1)

- [ ] 1. Brainstorm da slice
- [ ] 2. Spec da slice fechada
- [ ] 3. Plan
- [ ] 4. Build (TDD): chamada vision + Zod (sugestão tipo/severidade/descrição)
- [ ] 4. Build (TDD): pré-preenchimento de `abrir_chamado` + confirmação com o inquilino
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

### T7 — Áudio transversal (fase 2.1)

- [ ] 1. Brainstorm da slice
- [ ] 2. Spec da slice fechada
- [ ] 3. Plan
- [ ] 4. Build (TDD): transcrição base64 → texto no pipeline (lead + tenant)
- [ ] 4. Build (TDD): guardrails (2 min, falha → hardcoded, `[áudio]` no Event, flag)
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

### Encerramento da fase

- [ ] `handleTenantMessage` stub removido (fluxo real em produção)
- [ ] ROADMAP.md atualizado (tenant flow → done; T7 substitui "Whisper" da Fase 7)
- [ ] tenant-flow.md: seção 10 (ordem antiga) marcada como substituída por este tracking
- [ ] Smoke test em produção com inquilino real (dogfooding)

---

## Estado atual

> **Atualizar este bloco a cada sessão de trabalho.**

| Campo | Valor |
|---|---|
| Última atualização | 2026-07-29 |
| Etapa atual | T2 etapa 4 (build) concluída — migration `Complaint`, tool `registrar_reclamacao`, endpoint `PATCH /admin/complaints/:id` e seção "Chamados & Reclamações" no painel; bot e web verificados limpos. Branch `feat/tenant-t2-reclamacoes` |
| Próxima etapa | T2 etapa 5 (`agent-skills:code-simplification`) → etapa 6 (review local → PR → CodeRabbit → merge do Fred) |
| Bloqueios | — |

---

## Fora de escopo da Fase 2

Boleto automático / provedor PIX (Asaas/Efí), timer auto-retomada 24h do bot, kanban de manutenção, página dedicada de reclamações, timeline do tenant, RLS activation (trilha separada), multi-tenancy.
