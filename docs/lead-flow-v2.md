# Lead Flow v2 — Análise do fluxo atual + Spec do fluxo desejado

> Gerado em 2026-07-02 a partir de auditoria do código (`apps/bot/src`) e entrevista de requisitos.
> Status: **aguardando aprovação** — nada aqui foi implementado ainda.

---

## Parte 1 — Análise: por que o bot trava

### 1.1 Sintomas observados em produção

- Bot repete "preciso que você envie as imagens da sua CNH" mesmo após o lead enviar imagem e afirmar "já enviei" (3x seguidas, lead xingou e o bot não reagiu).
- Bot afirma "a etapa oficial do processo é de interesse" enquanto cobra documentação — contexto contraditório.
- "Cancela a visita" + "Já te mandei a CNH" → resposta genérica que ignora o documento.

### 1.2 Causas-raiz identificadas (em ordem de gravidade)

#### C1. Falha de upload perde o documento sem avisar ninguém — `buffer.ts:67-71` ⟵ **causa raiz provável**

Upload ao Supabase falha → erro engolido → mídia segue sem `url` → `isDocMedia()` retorna `false` → documento não persiste em `LeadDocument`. O lead não recebe erro, o owner não é notificado, o log é a única evidência.

**Evidência de produção (2026-07-02):** o Storage não tem nenhum documento de lead e a tabela `LeadDocument` está vazia — ou seja, **nenhum upload jamais funcionou**. Como o webhook está confirmado com base64 habilitado, a cadeia é: upload falha sempre (bucket `leads` inexistente no Supabase, ou policy bloqueando o service role) → doc nunca persiste → `docsReceivedCount` sempre 0 → bot pede CNH para sempre. **Primeira verificação da Fase 0.**

#### C2. Mídia sem base64 seria descartada em silêncio — `webhooks/evolution.ts:133`

```ts
if ((messageType === 'image' || messageType === 'document') && mediaBase64) { ... }
// sem else: imagem sem base64 cai no vazio, SEM LOG
```

Webhook está com base64 habilitado (confirmado), então não é a causa do incidente atual — mas continua sendo um buraco: se a Evolution deixar de incluir `message.base64` (mudança de config, reinício de instância), documentos somem sem rastro. Vídeos caem em `messageType: 'unknown'` e somem hoje.

#### C3. Nenhum feedback determinístico de recebimento

Turno só com mídia vira a string `"O usuario enviou apenas midia"` entregue ao LLM para improvisar. Não existe caminho de código que responda "Recebi seu documento". O lead não tem como saber se funcionou — e o bot não tem como saber o que recebeu (ver C4).

#### C4. Contagem cega de documentos — `context.ts: buildDocsStage`

`docsReceivedCount = count(LeadDocument)`. O campo `type` recebe o valor de `docsPreference` **no momento do envio** — não o que a imagem realmente é:

- 2 fotos da frente da CNH = "documentação completa"
- Foto do gato = documento válido
- Doc enviado antes de escolher CNH/RG ganha `type: 'image'` e conta mesmo assim

O sistema literalmente não sabe o que tem. "Transparência total" é impossível nesta estrutura.

#### C5. Estado do funil derivado de booleans extraídos por LLM — `context.ts: deriveState`

`visitedProperty`, `wantsApplication`, `wantsSchedule`, `docsPreference`, `residentsComplete` são extraídos pelo GPT-4o mini **a cada turno** e aplicados via `Object.assign` no contexto persistido. Um erro de extração ("Já enviei" → `visited_property: false`) regride o estado e o funil anda para trás. O fix monotônico de `visitedProperty` (jun/2026) tratou um campo; a classe inteira de bug permanece.

#### C6. OCR depende de URL pública — `ocr.ts:43` + `storage.ts:27`

Vision API recebe `imageUri` (busca a URL por conta própria) e o storage usa `getPublicUrl`. Se o bucket `leads` não for público, o OCR retorna `''` silenciosamente → CPF nunca extraído → loop "Não consegui ler o CPF". **E se o bucket for público, documentos pessoais estão expostos na internet** — problema dos dois lados. (Verificar config do bucket; a spec resolve com base64 direto na Vision API.)

#### C7. Zero detecção de loop e de frustração

O bot mandou a mesma mensagem 3x e não percebeu. O lead xingou e não houve reação nem notificação. `wantsHuman` existe no schema de extração mas nenhum código age sobre ele (não pausa, não notifica).

#### C8. "Etapa oficial" mentirosa no contexto do LLM

`currentProcessStep` deriva do estado FSM, que oscila com o `intent` do turno. Lead em plena coleta de docs pergunta algo sobre o imóvel → estado vira `property_info` → contexto diz "etapa: interesse" → agente responde "ainda precisamos agendar a visita". O LLM recebe fatos contraditórios e a resposta sai incoerente.

#### C9. Arquitetura: 3 chamadas LLM por turno, regras duplicadas em 6 prompts

extractor → router → agente. Cada prompt repete (às vezes contradiz) regras dos outros — ex.: router dizia "nunca collection sem visita" enquanto a visita virou opcional. Cada correção de comportamento vira remendo em 2-3 prompts. Custo e latência 3x, superfície de bug 6x.

### 1.3 O que está bom e deve ser preservado

- Saudações determinísticas (`intents.ts`) — rápido e barato
- Envio determinístico de mídia do imóvel (`media.ts`)
- Dedupe + debounce de mensagens no Redis (`buffer.ts`)
- Gate determinístico de confirmação de dados (`index.ts` §data_confirmation) — o padrão certo, só chega tarde demais no funil
- Extração de CPF label-first (`cpf.ts`)
- `shouldUpdateLeadSource` — proteção de correções manuais do painel
- Notificação de KYC ao owner

---

## Parte 2 — Spec: Lead Flow v2

### 2.1 Objetivo

Bot de WhatsApp que conduz leads de locação até a análise (KYC manual do owner) **sem travar**, com o funil crítico controlado por código determinístico e o LLM restrito à conversa. O lead sempre sabe em que pé está; o owner é chamado quando o bot não dá conta.

### 2.2 Princípios (decisões de produto — entrevista 2026-07-02)

| # | Decisão |
|---|---------|
| P1 | Caminho obrigatório: **renda + docs + moradores → confirmação de dados → KYC manual → contrato**. Todo o resto é opcional. |
| P2 | **Visita é opcional.** Nunca bloqueia coleta. Agendável/cancelável a qualquer momento. |
| P3 | **Transparência total:** em conflito ("já enviei"), o bot declara exatamente o que o sistema registrou e quando. |
| P4 | **Checklist flexível:** itens coletados em qualquer ordem; bot pede o próximo pendente. |
| P5 | **Docs auto-detectados:** sem pergunta "CNH ou RG+CPF?" — OCR classifica o que chegar e o checklist se ajusta. |
| P6 | Renda: **valor declarado registra; comprovante é pedido mas não bloqueia**. |
| P7 | Moradores: **perguntar quantidade primeiro**, depois nome/sexo/idade de cada um. Completo quando N atingido. |
| P8 | **Gate de confirmação mantido:** nome + CPF extraídos são confirmados pelo lead antes do KYC. |
| P9 | Escalação (pausa bot + notifica owner): pedido explícito de humano, frustração detectada, loop detectado por código. |
| P10 | **Migração incremental** — produção nunca fica quebrada esperando refactor. |

### 2.3 Arquitetura alvo

```
mensagem chega
    │
    ├── mídia (imagem/documento/vídeo)?
    │     └──► PIPELINE DETERMINÍSTICO (zero LLM)
    │          upload → OCR (base64 direto) → classificar → persistir tipado
    │          → responder checklist: "Recebi a frente da sua CNH ✅ Falta o verso."
    │
    ├── gatilho determinístico? (saudação, confirmação de dados, mídia do imóvel)
    │     └──► resposta hardcoded (como hoje)
    │
    └── texto livre
          └──► AGENTE ÚNICO com tools (1 chamada LLM)
               tools: status_checklist() · registrar_renda(valor)
                      registrar_moradores(...) · info_imovel(id)
                      agendar_visita(data) · cancelar_visita()
                      escalar_humano(motivo)
               Tools leem/escrevem o BANCO — o LLM nunca carrega estado.
```

**Regra de ouro:** o LLM decide *o que dizer*; o código decide *em que etapa o lead está*. Nenhum boolean extraído por LLM alimenta o funil crítico.

### 2.4 Modelo de dados (mudanças)

```prisma
enum LeadDocumentType {
  cnh_front
  cnh_back
  cnh_full       // CNH aberta em foto única — frente e verso juntos
  rg_front
  rg_back
  cpf
  income_proof
  unknown        // não classificado → nunca conta para o checklist
}

model LeadDocument {
  // type: String → LeadDocumentType (classificado por OCR, não por preferência)
  // + classifiedBy: 'ocr' | 'manual'   (owner pode reclassificar no painel)
}

model Lead {
  // + declaredIncome    Decimal?  — P6
  // + expectedResidents Int?      — P7 (quantidade declarada)
  // moradores saem do JSON da conversa → tabela LeadResident
}

model Conversation {
  // context JSON encolhe: sai visitedProperty, wantsApplication, docsPreference,
  // residents, residentsComplete, dataConfirmed... Fica só estado de conversa
  // (lastRequestedMediaType, dataConfirmationSent). Fonte de verdade = tabelas.
}
```

### 2.5 Classificador de documentos (determinístico, OCR-first)

Keywords no texto OCR (Vision recebe **base64**, não URL — resolve C6):

| Match no OCR | Tipo |
|---|---|
| "CARTEIRA NACIONAL DE HABILITAÇÃO" + nome/CPF **+ marcadores de verso** (ex: "OBSERVAÇÕES", "LOCAL", assinatura do emissor) | `cnh_full` — CNH aberta, frente e verso na mesma foto; **satisfaz sozinha o requisito de identidade** |
| "CARTEIRA NACIONAL DE HABILITAÇÃO" + nome/CPF | `cnh_front` |
| "CARTEIRA NACIONAL" sem campos de identificação / verso típico | `cnh_back` |
| "REGISTRO GERAL" / "CARTEIRA DE IDENTIDADE" | `rg_front` / `rg_back` |
| "CADASTRO DE PESSOA[S] FÍSICA[S]" | `cpf` |
| "SALÁRIO" / "HOLERITE" / "DEMONSTRATIVO DE PAGAMENTO" / "EXTRATO" | `income_proof` |
| nada casou | `unknown` |

- `unknown` → bot responde na hora: "Recebi sua imagem, mas não consegui identificar o documento. É a CNH, o RG ou o CPF? Se a foto estiver escura ou cortada, tenta de novo com boa iluminação."
- Duplicata do mesmo tipo → "Você já tinha enviado a frente da CNH ✅ — falta o **verso**."
- Fallback opcional (fase B): GPT-4o mini classifica o texto OCR quando as keywords falham — mas o resultado só **rotula**, nunca avança etapa sozinho.

### 2.6 Checklist de análise (substitui docsStage/deriveState do funil)

```
Análise completa quando:
  renda_declarada        (valor registrado; comprovante pedido, não bloqueia)
  docs_identidade        cnh_full OU (cnh_front + cnh_back) OU (rg_front + rg_back + cpf)
  moradores              (expectedResidents definido E count(LeadResident) == expectedResidents)
  nome                   (declarado OU extraído do doc)
─────────────────────────────────────────────────
  → gate de confirmação (nome + CPF, "sim"/"não")   [mantém código atual]
  → stage = kyc_pending + notificação ao owner       [mantém código atual]
```

Função pura `buildChecklist(lead, documents, residents): ChecklistStatus` — testável por unit test, renderizável como texto para o lead ("✅ Renda · ✅ CNH frente · ⬜ CNH verso · ⬜ Moradores") e como dados para o painel admin.

### 2.7 Transparência e resolução de conflito (P3)

Quando o lead contesta ("já enviei", "já mandei a CNH"):

1. Bot responde com fatos do banco: *"No meu sistema recebi 1 imagem hoje às 21:01, identificada como frente da CNH. Ainda falta o verso. Se você enviou outra e não apareceu, pode reenviar?"*
2. **Contador de contestação** (código, por item do checklist): 2ª contestação sobre o mesmo item → escalar (§2.8), avisando o lead: *"Vou pedir para o Frederico verificar — pode ter havido falha no recebimento. Ele te responde em breve."*

### 2.8 Escalação para humano (P9)

| Gatilho | Detecção | Ação |
|---|---|---|
| Pedido explícito | extração LLM (`wants_human`, já existe) **+ agir sobre ele** | pausa + notifica |
| Frustração/ofensa | lista de termos + sinal do LLM | pausa + notifica |
| Loop | **código:** resposta do bot ≈ resposta anterior (2x) OU 2ª contestação do mesmo item | pausa + notifica |
| Falha de recebimento | upload/webhook falhou 2x para o mesmo lead | notifica (sem pausar) |

Pausa = `Conversation.botPaused = true` (campo já existe) + mensagem ao lead. Notificação via `notifyOwner` (já existe).

### 2.9 Migração incremental (P10)

#### Fase 0 — Hotfix de produção (pequena, deploy imediato)

1. **Verificar/criar o bucket `leads` no Supabase** + policies para o service role (causa raiz provável — Storage está vazio e `LeadDocument` sem linhas em produção). Testar upload ponta a ponta.
2. `buffer.ts`: upload falhou → responder ao lead "Não consegui receber seu arquivo, pode reenviar?" + logar com destaque (mata o buraco negro de C1).
3. Feedback determinístico de recebimento: qualquer doc persistido → confirmar por texto no mesmo turno (versão simples, sem classificação ainda).
4. `webhooks/evolution.ts`: logar + tratar mídia sem base64 (fallback: buscar via endpoint `getBase64FromMediaMessage` da Evolution); tratar `videoMessage`.

#### Fase A — Pipeline determinístico de docs + checklist

5. Migration: `LeadDocumentType`, `declaredIncome`, `expectedResidents`, tabela `LeadResident`.
6. Classificador OCR (§2.5) + `buildChecklist` (§2.6) com unit tests.
7. Intake de mídia sai do fluxo LLM → pipeline próprio com resposta de checklist.
8. Transparência + contador de contestação (§2.7).
9. Escalação completa (§2.8): agir sobre `wantsHuman`, loop detection, frustração.
10. Moradores por quantidade (P7); renda declarada + comprovante opcional (P6).

#### Fase B — Agente único com tools

11. Substituir extractor + router + 4 agentes por 1 agente com function calling (§2.3).
12. Aposentar `deriveState`/FSM do funil crítico; estados restantes viram flags simples.
13. Encolher `Conversation.context` (fonte de verdade = tabelas).
14. Remover prompts antigos e regras duplicadas.

### 2.10 Estratégia de teste

- **Unit (bun test, já há `__tests__/`):** classificador OCR (fixtures de texto real de CNH/RG/CPF/holerite), `buildChecklist` (todas as combinações), contador de contestação, detector de loop.
- **Integração:** webhook → buffer → pipeline com Evolution mockada; casos: imagem sem base64, upload falho, duplicata, vídeo.
- **Regressão do funil:** replay dos diálogos que travaram (screenshots de 2026-06/07) como testes de conversa.

### 2.11 Fronteiras

**Sempre:**
- Banco é a fonte de verdade do funil; LLM só conversa.
- Toda mídia recebida gera resposta (confirmação ou pedido de reenvio) — nunca silêncio.
- Falha de infraestrutura (upload, OCR, Evolution) → lead informado + log.

**Perguntar antes:**
- Reclassificar documento já classificado.
- Qualquer mudança no gate de confirmação ou no disparo de KYC.

**Nunca:**
- Boolean extraído por LLM avança ou regride etapa do funil crítico.
- Bot inventa estado de documento ("já recebi") sem registro no banco.
- Documento pessoal em URL pública sem controle de acesso.
- Pedir docs/renda de forma insistente quando o lead está só tirando dúvidas (comportamento atual preservado).
