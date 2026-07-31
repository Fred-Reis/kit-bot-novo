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
- [x] 5. Simplify — `agent-skills:code-simplification` aplicado; diff pequeno e já espelhando padrões existentes (T1/coordinators/ContractsSection), sem over-engineering novo. Único achado real: `ComplaintStatus` duplicado como union literal em `lib/api.ts` e `$tenantId.tsx` em vez de reusar o tipo compartilhado (mesmo padrão já usado por `LeadStage`) — corrigido
- [x] 6. Review local (`agent-skills:code-review-and-quality`, 5 eixos) + **review independente extra** (subagent fresco `agent-skills:code-reviewer`, sem contexto da implementação, re-rodou as duas suites) — ambos sem achados Critical/Important. Confirmado: RLS inerte (diff direto contra o bug do PR #38 e o fix); side effects best-effort não bloqueiam o fluxo principal; sem regressão de tipos (`ComplaintStatus` já unificado, achado do simplify confirmado corrigido). 2 sugestões menores não-bloqueantes: (1) triggers de `registrar_reclamacao` vs `escalar_owner` no prompt se sobrepõem um pouco ("insatisfação com atendimento" vs "estiver irritado") — deixar pra observar em uso real; (2) endpoint aceita qualquer transição de status (sem enforcement forward-only), consistente com todos os outros PATCH admin hoje. PR #40 aberta

**Rodada CodeRabbit na PR #40 (2026-07-29) — triada com julgamento, não aceita cegamente:**
- **Corrigido:** `registrar_reclamacao` afirmava "o proprietário foi avisado" no retorno pro LLM, mas `notifyOwner` é fire-and-forget (não aguardado) — a frase não era garantida no momento em que a tool retorna. Ajustado pra só confirmar o registro.
- **Corrigido (nitpick):** `ComplaintsSection` era o único componente novo desta slice que não seguia `COMPONENT_PATTERN.md` à risca — adicionado `className` + `twMerge()` + `{...props}` + `data-state`.
- **Recusado com justificativa:** mover a decisão de roteamento de reclamação do prompt do LLM pra classificação determinística em código — contradiz T-D2 (agente único + tools, sem router por trilha; exatamente a arquitetura que esta fase substituiu).
- **Recusado com justificativa:** scoping por `ownerId` no endpoint `PATCH /admin/complaints/:id` — nenhum endpoint admin do app escopa por `ownerId` hoje (single-owner; multi-tenancy fora de escopo, RLS activation é trilha separada já gated); corrigir só este endpoint seria inconsistente com todos os irmãos.
- **Recusado com justificativa:** CodeRabbit assumiu que RLS bloqueia leitura de não-owners em `fetchTenantComplaints` — premissa incorreta pra este schema, RLS é deliberadamente inerte em toda tabela (`Complaint` incluída), se comporta igual a toda outra leitura via supabase-js já existente.

Verificação final pós-CodeRabbit: bot `bun run check` limpo (233 pass, 0 fail); web `bunx tsc --noEmit` + `bun run lint` (0 erros) + `bunx vitest run` limpo (122 pass, 0 fail).
- [x] Merge (Fred) — PR #40 mergeada (`67ca321`, 2026-07-30)

Verificação final pós-build: bot `bun run check` limpo (233 pass, 0 fail, 0 erros de lint); web `bunx tsc --noEmit` + `bun run lint` (0 erros, mesmo baseline de warnings pré-existente) + `bunx vitest run` limpo (122 pass, 0 fail). Pós-simplify: reverificado, tudo continua verde.

### T3 — Manutenção

- [x] 1. Brainstorm da slice (2026-07-29) — design §3/§4/§5/§6 cobre a arquitetura, models e endpoints; 3 deltas reais achados explorando o código (spec descreve intenção, não a implementação atual) e aprovados pelo Fred:
  1. **Storage:** spec cita bucket `tenants/{tenantId}/...`, mas `buffer.ts` já sobe toda mídia não-áudio pro bucket `leads` (`uploadLeadDocument`) ANTES do router saber se é lead ou tenant. Decisão: reusar o path já gerado no bucket `leads` — `MaintenanceRequest.mediaUrls` guarda esse storage path, sem bucket novo nem refactor em `buffer.ts`. Nota de correção a registrar na spec (mesmo padrão da nota §3.1 sobre `catalog.ts`).
  2. **Precedência mídia+texto:** spec diz "chamado aberto → anexa; senão → encaminha ao owner", o que impediria abrir um chamado novo já com foto no mesmo turno (caso comum: foto + "tá vazando na cozinha"). Decisão: pipeline determinístico (zero LLM) só age quando (a) já existe `MaintenanceRequest` open/acknowledged pro tenant, ou (b) mídia chega sem texto nenhum (`hasMedia && !messageText`, espelha o branch de áudio já existente em `index.ts`). Com texto presente e sem chamado aberto, os `mediaUrls` pendentes ficam disponíveis pra tool `abrir_chamado` anexar na criação — agente decide.
  3. **"Conversa em contexto de manutenção" (spec §3):** heurística sobre histórico de chat cortada (YAGNI) — só chamado `open`/`acknowledged` real no banco conta. Sem chamado real, cai nos branches acima.
  - Decisões de implementação sem necessidade de aprovação (padrões já existentes no repo, sem ambiguidade): página `/providers` clona o padrão CRUD+modal+toggle de `coordinators/index.tsx` (mesmo shape de `ServiceProvider`: nome/telefone/tipo/ativo); múltiplos chamados `open` pro mesmo tenant (não impedido pelo schema) → pipeline anexa no mais recente (`createdAt desc`); `docs/lei-inquilinato-resumo.md` rascunhado no Build e revisado pelo Fred antes do merge (conteúdo jurídico, não é decisão de arquitetura).
- [x] 2. Spec da slice fechada — design §3.2 (tools)/§4 (models)/§5 (painel)/§6 cobrem os critérios de aceite; 3 notas de correção do brainstorm registradas na spec (§3, bloco "Nota T3"); sem TBDs
- [x] 3. Plan (`docs/superpowers/plans/2026-07-29-t3-manutencao-plan.md`) — 14 tasks TDD: tipos compartilhados; migration; `lei-inquilinato-resumo.md`; tools `abrir_chamado`/`indicar_profissional`; templates de notif; injeção do resumo no contexto do agente; pipeline determinístico de mídia; endpoints `/admin/providers` + `/admin/maintenance/:id`; página `/providers`; extensão da seção "Chamados & Reclamações" com galeria de fotos; verificação final. Self-review aplicado (achado e corrigido: `TenantToolDeps` ganhando campos obrigatórios quebraria o fixture de teste do T1/T2; `apiErrorMessage` chamado com aridade errada)
- [x] 4. Build (TDD): migration `MaintenanceRequest` + `ServiceProvider` + RLS inertes + types — migration escrita à mão (padrão `Complaint`), aplicada via `prisma db execute` + `migrate resolve --applied` (mesma limitação de shadow-db já documentada)
- [x] 4. Build: `docs/lei-inquilinato-resumo.md` — rascunho escrito; **pendente revisão de conteúdo jurídico pelo Fred antes do merge** (não é achado de review técnico)
- [x] 4. Build (TDD): tool `abrir_chamado` (responsabilidade/tipo/severidade; owner/unclear/urgente → notif) — responsabilidade decidida pelo próprio LLM (tem lei-resumo + contrato no contexto), passada como parâmetro validado por Zod; nunca inferida em código
- [x] 4. Build (TDD): tool `indicar_profissional` (só do banco; vazio → honestidade)
- [x] 4. Build (TDD): pipeline de mídia anexa foto em chamado aberto (`mediaUrls`) — reusa o storage path já gerado no bucket `leads` por `buffer.ts` (achado do brainstorm); com texto presente e sem chamado aberto, `mediaUrls` pendentes ficam disponíveis pra `abrir_chamado` anexar na criação
- [x] 4. Build (TDD): endpoints `GET/POST/PATCH /admin/providers` + `PATCH /admin/maintenance/:id` — sem rota de teste HTTP dedicada (nenhuma rota admin do repo tem hoje); cobertura via typecheck+lint, smoke test manual pendente antes do merge
- [x] 4. Build: página `/providers` (tabela + modal + toggle ativo) — clona o padrão CRUD de `coordinators/index.tsx`; `ProviderFormModal` testado (TDD)
- [x] 4. Build: chamados + galeria de fotos no detalhe do tenant — `ComplaintsSection` estendida (unifica `Complaint`+`MaintenanceRequest`, ordenados por `createdAt`); galeria assina URL client-side via `supabase.storage.from('leads')`, mesmo padrão de `fetchTenantDocuments`

**Achados corrigidos durante o Build (nenhum estava no plano original):**
- `docs/lei-inquilinato-resumo.md` é injetado no contexto do agente via `readFileSync`, mas o plano original calculava o caminho a partir de `process.cwd() + 'docs/...'` — `process.cwd()` é sempre `apps/bot` (dev local e Docker) e o `Dockerfile` do bot nunca copiava a pasta `docs/` da raiz, então a implementação literal do plano teria funcionado em teste/dev e falhado silenciosamente (fallback vazio) em produção. Corrigido: caminho `process.cwd() + '../../docs/...'` + uma linha `COPY docs/lei-inquilinato-resumo.md` no Dockerfile (só este arquivo, não a pasta inteira).
- `metadata: { active }` no endpoint `PATCH /admin/providers/:id` não compilava (`boolean | undefined` não é `JsonValue`) — corrigido para `active ?? null`.
- Nota de correção do brainstorm (achados de storage/precedência/heurística) tinha sido escrita na spec mas nunca commitada antes de eu seguir pro Plan — pego via `git status` no meio do Build e commitado à parte.

Verificação final: bot `bun run check` limpo (typecheck+lint+test, 246 pass, 0 fail); web `bunx tsc --noEmit` + `bun run lint` (0 erros, mesmo baseline de warnings pré-existente) + `bunx vitest run` (128 pass, 0 fail) + `bun run build` limpo.
- [x] 5. Simplify — `agent-skills:code-simplification` aplicado; achado real (mesmo mapa `eletrica/hidraulica/civil/limpeza_conservacao → label PT-BR` copiado ao pé da letra em 3 arquivos: `provider-form-modal.tsx`, `providers/index.tsx`, `complaints-section.tsx`) extraído pra `lib/service-type-labels.ts` (padrão de `lib/activity-labels.ts`). Demais achados considerados aceitáveis pelo princípio de "manter equilíbrio" do skill: `ComplaintRow`/`MaintenanceRow` em `complaints-section.tsx` têm shell parecido (header+pill / footer com botão de avançar status) mas corpo bem diferente — extrair um shell genérico agora seria abstração prematura pra só 2 variantes, e T6 (triagem visual) deve divergir ainda mais o `MaintenanceRow`. Rotas admin (`providers.ts`/`maintenance.ts`) seguem o mesmo padrão replicado das rotas irmãs (`coordinators.ts`/`complaints.ts`) — já é a convenção estabelecida do repo, não uma duplicação nova desta slice
- [~] 6. Review local (`agent-skills:code-review-and-quality`, 5 eixos, suíte re-executada de verdade) → PR #42 aberta (2026-07-30)
  - **Corrigido (achado real):** pipeline de mídia anexa qualquer mídia não-áudio (imagem, documento ou vídeo — a Evolution API manda os 3 tipos) em `MaintenanceRequest.mediaUrls`, mas a galeria renderizava tudo como `<img>` incondicionalmente — um PDF ou vídeo de evidência (ex: vazamento intermitente) virava ícone de imagem quebrada no painel, sem teste cobrindo o caso não-imagem. Corrigido: `isImageUrl()` detecta a extensão (ignorando querystring da signed URL) e renderiza link de arquivo pros casos não-imagem, em vez de restringir o que o bot aceita (vídeo como evidência é legítimo).
  - **Nitpick aceito:** `metadata: { active: active ?? null }` em `PATCH /admin/providers/:id` grava `active: null` no log de atividade mesmo quando o campo não foi tocado no PATCH (só nome/telefone mudaram) — ambíguo mas inofensivo (mesmo padrão de `metadata` opcional usado em outras rotas admin); não bloqueante.

**Rodada CodeRabbit na PR #42 (2026-07-30) — 1ª tentativa automática bateu no rate limit da conta (sem achados); 2ª rodada (manual, `@coderabbitai review`) trouxe 10 comentários acionáveis + 6 nitpicks, triados com julgamento:**
- **Corrigido (Critical):** `ProviderFormModal` mantinha estado obsoleto ao trocar de prestador em edição sem fechar o modal — editar A e depois clicar Editar em B mantinha os campos de A, risco de salvar dado errado sobre B. Corrigido na raiz (`useEffect` resincroniza em `open`/`initialValue`), não com o workaround mais simples de `key` no chamador que o CodeRabbit também sugeriu — mais robusto contra reuso futuro do componente.
- **Corrigido (Major):** corrida real entre `findFirst` e `update` no anexo de foto a chamado aberto — o chamado podia ser resolvido nesse intervalo. Trocado por `updateMany` com filtro de status + checagem de `count`; 0 linhas afetadas cai no encaminhamento ao owner em vez de anexar a um chamado já fechado.
- **Corrigido (Major):** mesmo trecho engolia falha de `update`/`persistTurn` no catch-all externo, deixando o inquilino em silêncio total — agora cai no encaminhamento ao owner em qualquer falha, nunca silêncio (regra 7).
- **Corrigido (Major):** notificação de "mídia encaminhada" ao owner descartava `mediaUrls` — proprietário era avisado sem link nenhum pra ver o arquivo. Corrigido: `createLeadDocumentUrl` assina cada path antes de notificar, link entra na mensagem de WhatsApp.
- **Corrigido (Major):** `ProviderFormModal` sem `role="dialog"`/`aria-modal` nem fechamento por Escape. Adicionados os dois; focus-trap completo deixado de fora por desproporcional (nenhum outro modal do repo tem).
- **Corrigido (Major):** lista de prestadores engolia erro de query — falha na busca renderizava tabela vazia, indistinguível de "nenhum prestador". `isError` agora exposto e tratado.
- **Corrigido (Minor):** formulário de prestador permitia salvar nome/telefone vazios — Salvar desabilitado até ambos preenchidos.
- **Corrigido (Minor):** teste do fluxo de anexo aceitava qualquer payload de update — agora valida o conteúdo de `mediaUrls`.
- **Corrigido (nitpicks, 1 mudança):** `MaintenanceType`/`ServiceProviderType` duplicavam os mesmos 4 literais em arquivos separados — extraído `ServiceCategory` compartilhado em `packages/types`; arrays de validação (`MAINTENANCE_SEVERITIES`/`MAINTENANCE_RESPONSIBILITIES`/`MAINTENANCE_STATUSES`/`SERVICE_CATEGORIES`) centralizados no pacote em vez de redeclarados em `tenant-tools.ts`/`providers.ts`/`maintenance.ts`; `type: string` → `ServiceProviderType` em `lib/api.ts`; `queries.ts` trocou N `createSignedUrl` por 1 `createSignedUrls` em lote.
- **Recusado com justificativa (2 instâncias do mesmo ponto, em `tenant-tools.ts` e `tenant-v2.ts`):** CodeRabbit marcou a responsabilidade tenant/owner/unclear decidida pelo LLM como violação de regra determinística, e apontou que uma classificação errada como "tenant + não-urgente" nunca notifica o owner. É a decisão T-D confirmada no brainstorm desta slice (PRD acima) — LLM tem o resumo da Lei do Inquilinato + contrato no contexto, código só valida o enum, mesmo padrão de `registrar_reclamacao`. Não notificar em caso tenant+baixa severidade é intencional (evita alarme a cada lâmpada queimada); todo chamado continua visível no painel. A 2ª instância pedia também parar de embutir o resumo legal no Docker e usar um classificador determinístico via Supabase Storage — redesenho maior ("Heavy lift" no próprio label do CodeRabbit), desproporcional pra esta slice.

Verificação pós-CodeRabbit (1ª rodada): bot `bun run check` limpo (250 pass, 0 fail, 0 erros de lint); web `bunx tsc --noEmit` + `bun run lint` (0 erros) + `bunx vitest run` (132 pass, 0 fail) + `bun run build` limpo.

**2ª rodada CodeRabbit na PR #42 (2026-07-30) — pegou algo real que a 1ª rodada + minha própria correção anterior não pegaram:**
- **Corrigido (achado real, mais fino que o da 1ª rodada):** meu fix anterior da corrida (`updateMany`) envolvia `persistTurn`+`sendText` no mesmo `try/catch` do `updateMany` — uma falha só no aviso ao inquilino (`sendText`) DEPOIS de um anexo bem-sucedido caía no `forwardMediaToOwner()`, mentindo "encaminhei ao proprietário" pra mídia que já estava corretamente anexada ao chamado real, e registrando um evento `tenant_media_forwarded` enganoso. Corrigido: só a escrita (`updateMany`) decide anexar-vs-encaminhar; a resposta pós-sucesso agora propaga uma falha normalmente (mesmo nível de resiliência que saudação/áudio/frustração já têm nesse arquivo — nenhuma delas é protegida também). Teste novo prova que `forwardMediaToOwner` não dispara quando só a confirmação falha após anexo real.
- **Corrigido (nitpick):** overlay do `ProviderFormModal` usava `bg-black/40` hardcoded — trocado por `bg-foreground/20`, convenção já usada em outros 2 modais do repo (`_dashboard.tsx`, `leads/$leadId.tsx`); regra do CLAUDE.md proíbe cor hardcoded.
- **Recusado com justificativa:** CodeRabbit marcou `POST /admin/providers` associando o prestador via `prisma.owner.findFirst()` (owner arbitrário) em vez de resolvido pela autorização do admin. É o padrão do app inteiro (11+ rotas admin fazem o mesmo — coordinators, properties, payments, rule-sets, templates, visits, tenants, bot-settings), não uma introdução desta slice; multi-tenancy/escopo por owner é explicitamente fora de escopo da Fase 2, e o CodeRabbit já tinha levantado o mesmo ponto idêntico na PR #40 (T2) pra `complaints.ts`, recusado pela mesma razão lá.

Verificação pós-2ª rodada: bot `bun run check` limpo (251 pass, 0 fail); web `bunx tsc --noEmit` + `bun run lint` (0 erros) + `bunx vitest run` (132 pass, 0 fail).

**3ª rodada CodeRabbit na PR #42 (2026-07-31) — pegou 2 achados reais que as 2 rodadas anteriores não pegaram (um deles fora da minha própria correção da rodada 2):**
- **Corrigido (achado real):** a resposta pós-anexo (`persistTurn`+`sendText`) do fix da 2ª rodada ainda rodava sequencial sem isolamento próprio — falha em `persistTurn` pulava o `sendText` e subia pro catch externo, deixando o inquilino sem resposta nenhuma mesmo com o anexo já feito. Isolados os dois com `.catch()` próprio, igual ao ramo de encaminhamento. Teste novo revelou que o mock de `$transaction` no teste (`async (ops) => ops`) nunca esperava as operações de verdade — corrigido pra `Promise.all(ops)`, batendo com a semântica real do Prisma.
- **Corrigido (achado real, fora da lista numerada — estava só no resumo "outside diff"):** `getMaintenanceLawSummary()` cacheava falha de leitura permanentemente (`cachedMaintenanceLawSummary = ''` numa falha nunca mais tentava de novo) — uma falha transitória (ex: arquivo ainda não montado no cold start do container) travaria o resumo legal vazio pro resto da vida do processo. Corrigido: só sucesso popula o cache.
- **Corrigido (nitpicks):** `notify.ts` ainda tinha `'tenant'|'owner'|'unclear'`/`'baixa'|'media'|'urgente'` como union literal inline em 3 lugares em vez de importar `MaintenanceResponsibility`/`MaintenanceSeverity` de `@kit-manager/types` — mesma classe de drift já corrigida pra `ServiceCategory`/`MaintenanceType` na rodada anterior, só que esquecida aqui; teste "...severidade" não checava a severidade de fato — assertion adicionada.
- **Recusado com justificativa (3ª vez):** responsabilidade decidida pelo LLM em `tenant-tools.ts`/`tenant-v2.ts` — mesma decisão T-D confirmada, já recusada 2x.
- **Recusado com justificativa:** mover o resumo legal pra DB/Supabase Storage em vez de arquivo local — mesmo redesenho desproporcional já recusado; o bug de cache que vinha junto foi corrigido acima.
- **Recusado com justificativa (2 achados):** transação/outbox pro audit log de `PATCH /admin/maintenance/:id` e guard de body malformado antes do destructure — ambos batem exatamente com o padrão idêntico de `complaints.ts` (mesmo fire-and-forget `logActivity(...).catch(warn)`, mesmo `const { status } = request.body` sem guard); é convenção de toda rota admin do repo, não introdução desta slice.
- **Recusado com justificativa:** ativar RLS em `ServiceProvider`/`MaintenanceRequest` — RLS activation é trilha própria já gated pra Fase 2 inteira (ver "Fora de escopo" abaixo), não algo pra ligar só nessas 2 tabelas.

Verificação pós-3ª rodada: bot `bun run check` limpo (252 pass, 0 fail, 0 erros de lint).
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
| Última atualização | 2026-07-30 |
| Etapa atual | T3 (Manutenção) — brainstorm→spec→plan→build→simplify→review local fechados. PR #42 aberta, aguardando CodeRabbit |
| Próxima etapa | Loop CodeRabbit → triagem → fix → commit até PR limpa. `docs/lei-inquilinato-resumo.md` precisa de revisão de conteúdo pelo Fred antes do merge |
| Bloqueios | — |

---

## Fora de escopo da Fase 2

Boleto automático / provedor PIX (Asaas/Efí), timer auto-retomada 24h do bot, kanban de manutenção, página dedicada de reclamações, timeline do tenant, RLS activation (trilha separada), multi-tenancy.
