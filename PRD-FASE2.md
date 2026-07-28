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
- [ ] PR de docs aberta e mergeada pelo Fred

### T1 — Fundação

- [x] 1. Brainstorm da slice — delta T-D7 registrado na spec (§2): `escalar_owner` entra já na T1 pra cobrir trilhas ainda não implementadas (manutenção/financeiro), nunca silêncio
- [x] 2. Spec da slice fechada — design §3 (arquitetura + snapshot + tools) + T-D7 cobrem os critérios de aceite; sem TBDs
- [ ] 3. Plan (`docs/superpowers/plans/…-t1-fundacao-plan.md`)
- [ ] 4. Build (TDD): snapshot + cache + invalidação
- [ ] 4. Build (TDD): fix `botPaused` no branch tenant do `router.ts`
- [ ] 4. Build (TDD): overrides determinísticos (saudação / áudio / emergência+notif)
- [ ] 4. Build (TDD): agente único `agents/tenant-v2.ts` + prompt + dúvidas informativas via snapshot
- [ ] 4. Build: `Event` em toda interação; `ActivityLog` nos eventos relevantes (escalação, emergência) — mesmo padrão do lead flow
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

### T2 — Reclamações

- [ ] 1. Brainstorm da slice
- [ ] 2. Spec da slice fechada
- [ ] 3. Plan
- [ ] 4. Build (TDD): migration `Complaint` + RLS inerte + types
- [ ] 4. Build (TDD): tool `registrar_reclamacao` + notif owner + confirmação ao tenant
- [ ] 4. Build (TDD): endpoints `PATCH /admin/complaints/:id` + leitura web
- [ ] 4. Build: seção "Chamados & Reclamações" no detalhe do tenant (parte reclamações)
- [ ] 5. Simplify
- [ ] 6. Review local → PR → CodeRabbit limpo
- [ ] Merge (Fred)

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
| Última atualização | 2026-07-27 |
| Etapa atual | P0 — PR de docs (spec + PRD-FASE2 + correções ROADMAP/PRD) |
| Próxima etapa | T1 etapa 1 (brainstorm da slice) após merge da PR de docs |
| Bloqueios | — |

---

## Fora de escopo da Fase 2

Boleto automático / provedor PIX (Asaas/Efí), timer auto-retomada 24h do bot, kanban de manutenção, página dedicada de reclamações, timeline do tenant, RLS activation (trilha separada), multi-tenancy.
