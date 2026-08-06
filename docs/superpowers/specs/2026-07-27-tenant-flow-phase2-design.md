# Tenant Flow — Fase 2 — Design aprovado

> Data: 2026-07-27 · Status: **aprovado pelo Fred** (sessão de brainstorming)
> Documento-mestre de execução: [`PRD-FASE2.md`](../../../PRD-FASE2.md)
> Substitui a arquitetura do [`tenant-flow.md`](../../../tenant-flow.md) §2 (router LLM + agentes por trilha — padrão v1, descartado). As regras de negócio do tenant-flow.md (§3–§9) permanecem válidas e estão incorporadas aqui.

---

## 1. Objetivo

Hoje inquilino que manda mensagem recebe **silêncio** (`flows/tenant/index.ts` é stub de 6 linhas). Fase 2: o bot atende as 3 trilhas do inquilino (financeiro, manutenção, info/reclamação) como intermediário formal, registra tudo no banco e escala ao owner quando não dá conta.

**Regra de ouro herdada do lead v2:** o LLM decide *o que dizer*; o código decide *o que aconteceu*. Registro e funil sempre via tools que escrevem no banco — nunca boolean extraído por LLM.

## 2. Decisões fechadas (entrevista 2026-07-27)

| # | Decisão |
|---|---------|
| T-D1 | Escopo: **bot + painel mínimo** (CRUD ServiceProvider, chamados/reclamações no detalhe do tenant). Kanban de manutenção, página de reclamações e timeline ficam no backlog |
| T-D2 | Arquitetura: **agente único + tools, padrão v2** (1 chamada LLM; mesmo shape de `agents/tools.ts`). Sem router LLM de trilha |
| T-D3 | Handoff: **`Conversation.botPaused` + retomada manual** pelo toggle existente no painel. Sem timer de 24h (YAGNI) |
| T-D4 | Comprovante PIX: **fallback OCR sem provedor** — bot extrai e notifica; owner confirma manualmente. Provedor (Asaas/Efí) fica no backlog |
| T-D5 | Chamados aceitam **fotos anexadas** (`mediaUrls`); triagem visual por LLM entra na fase 2.1 como sugestão, nunca decisão |
| T-D6 | Áudio: **transcrição via OpenAI** (`gpt-4o-mini-transcribe`, fallback `whisper-1`), transversal lead+tenant, fase 2.1, atrás de flag |
| T-D7 | (brainstorm T1, 2026-07-27) Comportamento interino: **`escalar_owner` entra já na T1**. Pedido de trilha ainda não implementada (manutenção antes da T3, financeiro antes da T4) → bot informa que encaminhou + notifica owner. Nunca silêncio; T2–T4 substituem a escalação por atendimento real |

## 3. Arquitetura do bot

```
mensagem de tenant (router identifica pelo banco, como hoje)
    │
    ├── conversation.botPaused? ──► silêncio
    │     (FIX: hoje o branch tenant do router.ts BYPASSA esse check)
    │
    ├── mídia (imagem/documento)? ──► PIPELINE DETERMINÍSTICO (zero LLM)
    │     upload Storage (tenants/{tenantId}/...) → OCR base64
    │       ├─ comprovante PIX/transferência? → extrai valor+data
    │       │    → notifica owner "sinalizou pagamento"
    │       │    → confirma ao tenant "encaminhei, aguarde confirmação"
    │       ├─ chamado aberto (open/acknowledged) OU conversa em contexto
    │       │  de manutenção? → anexa em MaintenanceRequest.mediaUrls
    │       │    → "Recebi a foto, anexei ao chamado ✅"
    │       └─ senão → encaminha ao owner + confirma recebimento
    │
    ├── override determinístico? ──► resposta hardcoded (zero LLM)
    │     · saudação simples → cumprimento com nome do inquilino
    │     · áudio → hardcoded "não entendo áudio" (até T7)
    │     · EMERGÊNCIA (incêndio | fogo | cheiro de gás | alagamento)
    │       → orientar bombeiros/emergência + notificar owner IMEDIATO
    │
    └── texto livre ──► AGENTE ÚNICO (1 chamada LLM) com tools
```

### 3.1 Snapshot do tenant

Cache Redis `tenant:{phone}`, TTL 30 min, invalidado em writes do admin que toquem tenant/payment/contrato. Conteúdo: nome, imóvel (T1 implementou via `include` direto na query de `Tenant`, não via `catalog.ts` — imóvel do inquilino já vem no mesmo round-trip; `catalog.ts` seria uma segunda consulta+cache redundante para um dado que já está embutido no snapshot), contrato (início/fim/`dueDay`), owner, últimos pagamentos com status. É o **único** contexto factual do LLM — nada factual fora dele.

### 3.2 Tools (`agents/tenant-tools.ts`, mesmo shape de `buildLeadTools`)

| Tool | Faz |
|---|---|
| `status_pagamentos()` | Lê `Payment` do tenant — vencimento, pagos, pendentes. Só leitura |
| `abrir_chamado(tipo, severidade, resumo)` | Cria `MaintenanceRequest`. Responsabilidade (`tenant\|owner\|unclear`) classificada com base no resumo da Lei do Inquilinato injetado no prompt + contrato. `owner`/`unclear`/`urgente` → notifica owner sempre |
| `indicar_profissional(tipo)` | Lê `ServiceProvider` ativo do tipo; vazio → diz honestamente que não há cadastrado |
| `registrar_reclamacao(resumo, conteudo)` | Cria `Complaint` + notifica owner + confirma registro ao tenant |
| `escalar_owner(motivo)` | `botPaused = true` + `notifyOwner`. Gatilhos: negociação financeira, pedido de humano, frustração, ambiguidade contratual |

- Novo arquivo estático `docs/lei-inquilinato-resumo.md` — injetado apenas no contexto de manutenção.
- Caso `tenant` simples → dica DIY + oferta de profissional cadastrado. O bot **nunca** decide caso ambíguo sozinho.
- Reusa: `notifyOwner`, `logActivity`, escalation do lead v2, buffer/dedupe Redis, `catalog.ts`.

**Nota T3 (brainstorm 2026-07-29, achado explorando o código):** o texto acima ("upload Storage `tenants/{tenantId}/...`") descreve a intenção, não a implementação real — `buffer.ts` já sobe toda mídia não-áudio pro bucket `leads` (`uploadLeadDocument`) antes do router saber se o remetente é lead ou tenant. T3 reusa esse storage path já gerado (bucket `leads`) em `MaintenanceRequest.mediaUrls`, sem bucket novo. Além disso, "chamado aberto OU conversa em contexto de manutenção" foi restrito a: chamado `open`/`acknowledged` real no banco (mais recente, se houver mais de um) OU mídia sem texto acompanhando; com texto presente e sem chamado aberto, os `mediaUrls` pendentes ficam disponíveis pra tool `abrir_chamado` anexar na criação — a heurística de "contexto de conversa" sem chamado real foi cortada (YAGNI).

## 4. Modelo de dados — 3 models novos

Padrão do schema atual: `ownerId` + FK (`onDelete: Restrict` pro Owner) + `@@index`, status como `String` (consistente com `Payment.status`, `Lead.stage`), RLS policies **inertes** na mesma migration (padrão `20260726020000_coordinator_rls_inert`), tipos compartilhados em `packages/types`.

```prisma
model MaintenanceRequest {
  id             String   @id @default(uuid())
  ownerId        String   // relation Owner, onDelete: Restrict
  tenantId       String   // relation Tenant, onDelete: Cascade
  propertyId     String   // relation Property
  type           String   // eletrica | hidraulica | civil | limpeza_conservacao
  responsibility String   // tenant | owner | unclear
  severity       String   // baixa | media | urgente
  summary        String
  status         String   @default("open") // open | acknowledged | in_progress | resolved
  mediaUrls      String[] @default([])     // fotos do problema (Supabase Storage)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([ownerId])
  @@index([tenantId])
}

model Complaint {
  id        String   @id @default(uuid())
  ownerId   String
  tenantId  String
  summary   String
  content   String
  status    String   @default("open") // open | acknowledged | resolved
  createdAt DateTime @default(now())
  @@index([ownerId])
  @@index([tenantId])
}

model ServiceProvider {
  id        String   @id @default(uuid())
  ownerId   String
  name      String
  phone     String
  type      String   // eletrica | hidraulica | civil | limpeza_conservacao
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  @@index([ownerId])
}
```

**Não** criar: `humanTakeover`/`takeoverUntil` (botPaused resolve), `Payment.dueDate` (schema real usa `month` + `Tenant.dueDay`).

## 5. Painel admin (mínimo operável)

1. **`/providers`** — tabela (nome, telefone, tipo, ativo) + modal criar/editar + toggle ativar/desativar. Endpoints `GET/POST/PATCH /admin/providers`. Padrão `create-component`.
2. **Detalhe do tenant** (`$tenantId.tsx`) — seção "Chamados & Reclamações": lista unificada com status pill + transição de status (open → acknowledged → resolved; chamado tem `in_progress` no meio) + galeria de fotos anexadas. Leitura via supabase-js; mutação via `PATCH /admin/maintenance/:id` e `PATCH /admin/complaints/:id`.
3. **Notificações** — de graça: tudo passa por `notifyOwner` + `logActivity` (WhatsApp, email, sino in-app, activity feed).

## 6. Slices

### Fase 2.0 — Core tenant

| # | Slice | Conteúdo | Valor entregue |
|---|---|---|---|
| **T1** | Fundação | Snapshot + cache; fix `botPaused` no branch tenant do router; overrides (saudação/áudio/emergência); agente único respondendo dúvidas informativas do snapshot | Tenant deixa de receber silêncio; emergência coberta |
| **T2** | Reclamações | Model `Complaint` + tool `registrar_reclamacao` + notif + seção no painel | Trilha mais simples valida o padrão tool→registro→notif |
| **T3** | Manutenção | Models `MaintenanceRequest` + `ServiceProvider`; `lei-inquilinato-resumo.md`; tools `abrir_chamado`/`indicar_profissional`; anexo de fotos no pipeline de mídia; página `/providers`; chamados+galeria no painel | Trilha mais complexa, maior valor |
| **T4** | Financeiro | Tool `status_pagamentos` + escalação de negociação | Trilha financeiro completa |
| **T5** | Comprovante PIX | Classificador OCR de comprovante no pipeline de mídia + notif "sinalizou pagamento" + confirmação manual no painel (`Payment.status = paid`) | Fecha o ciclo mensal real |

Dependências: T2–T5 dependem de T1. T4/T5 independentes de T2/T3.

### Fase 2.1 — Percepção (só começa com 2.0 em produção)

| # | Slice | Conteúdo |
|---|---|---|
| **T6** | Triagem visual | Foto anexada → GPT-4o mini vision **sugere** `tipo` + `severidade` + descrição ("vazamento sob a pia, conexão do sifão"), validado por Zod (mesmos enums). Pré-preenche `abrir_chamado`; agente confirma com o inquilino antes de gravar. Vision **nunca** abre/escala chamado sozinha. Falha → fluxo segue sem sugestão |
| **T7** | Áudio (transversal lead+tenant) | Evolution entrega áudio base64 → `audio.transcriptions` (`gpt-4o-mini-transcribe`, fallback `whisper-1`) → texto entra no pipeline normal. Guardrails: máx. 2 min (acima → pede texto), falha → fallback hardcoded atual, transcrição logada no `Event` com marcador `[áudio]`, flag `AUDIO_TRANSCRIPTION_ENABLED`. Substitui o item "Transcrição de áudio (Whisper)" da Fase 7 do ROADMAP |

## 7. Regras invioláveis

As 6 do tenant-flow.md §9, preservadas integralmente:

1. Nunca decidir sozinho questão contratual ambígua — encaminha ao owner
2. Nunca inventar regras da Lei do Inquilinato — só o resumo injetado
3. Nunca confirmar pagamento sem registro no banco
4. Nunca prometer prazos de resolução em nome do owner
5. Emergências têm resposta hardcoded, sem LLM
6. Toda interação relevante gera registro no banco (`Event` + `ActivityLog`)

Mais duas, lições do lead v1:

7. Falha de infra (OCR, upload, Evolution) → tenant informado + log — **nunca silêncio** (lição C1)
8. Snapshot ausente/corrompido → notifica owner + mensagem neutra ao tenant

## 8. Estratégia de teste

- **Unit (bun test, padrão `__tests__/`):** cada tenant-tool com Prisma mockado; classificador de comprovante PIX (fixtures de texto OCR real); overrides de emergência; snapshot builder + invalidação de cache; fix do `botPaused` no router; (T6) parser da sugestão vision; (T7) guardrails de duração/falha.
- **Integração:** replay de conversas simuladas por trilha (padrão `lead-v2-runner.test.ts`).

## 9. Fora de escopo (explícito)

Boleto automático / provedor PIX (Asaas/Efí), timer de auto-retomada 24h, kanban de manutenção, página dedicada de reclamações, timeline do tenant, RLS activation (trilha separada, já gated), multi-tenancy.

## 10. Auditoria de docs executada nesta sessão (2026-07-27)

Corrigidos na mesma PR desta spec:

- `ROADMAP.md:348` — Calendário V2 marcado done (Coordinator/PropertyCoordinator implementados, PR #36 mergeada em `cbc2963`)
- `ROADMAP.md:223` — CPF no payload `kyc_pending` confirmado implementado (`notify.ts`)
- `ROADMAP.md:371` — "[~] Funil completo" → done (Slice 10)
- `ROADMAP.md:207` — Slice 5 commit → done
- `PRD.md` — notificação in-app saiu de "Fora do MVP" (implementada 2026-07-26)
- `tenant-flow.md` — nota de superseded no topo

Confirmados como realmente pendentes (checkbox correto): RLS activation, backups Supabase, domínio+SSL, email diário Resend, `SENTRY_DSN` no Railway, variáveis globais de template, V3/V4/V5 calendário, responsivo mobile, cron `payment_overdue`, filtro `ownerId` no web (Fase 5).
