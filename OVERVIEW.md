# kit-manager — Visão Geral do Sistema

## O que é

kit-manager é um sistema de gestão de locação de imóveis composto por dois módulos integrados:

1. **Bot WhatsApp** (`apps/bot`) — atende leads e inquilinos automaticamente via WhatsApp, conduzindo todo o funil de locação com IA.
2. **Painel Admin** (`apps/web`) — interface web para o proprietário gerenciar imóveis, leads, inquilinos, contratos, templates e regras.

Os dois módulos compartilham o mesmo banco de dados (Supabase/PostgreSQL) e se comunicam via API REST autenticada com JWT do Supabase.

---

## Arquitetura Geral

```
WhatsApp (Evolution API)
        │  webhooks
        ▼
   apps/bot (Fastify + Bun)
        │  Prisma ORM
        ▼
  Supabase PostgreSQL ◄──────── apps/web (React + Supabase JS)
        │                              │
   Redis (cache)              Painel Admin (browser)
```

- **Leituras do painel** vão direto ao Supabase via `supabase-js` (RLS desabilitada, acesso por auth session)
- **Mutações do painel** passam pela API do bot (`/admin/...`) com JWT do Supabase no header
- **Propriedades** são cacheadas no Redis por 10 minutos para reduzir latência no bot
- **Autenticação do painel** via Supabase Auth (Google OAuth + Magic Link)

---

## Módulo 1 — Bot WhatsApp

### Visão geral do fluxo

Quando uma mensagem chega via WhatsApp, o bot executa este pipeline:

```
Mensagem recebida (Evolution API webhook)
        │
        ▼
Buffer de 1,5s (agrupa mensagens rápidas do mesmo chat)
        │
        ▼
Router: Inquilino ou Lead?  ──── (busca pelo número no banco)
        │
   ┌────┴─────┐
   │          │
Lead        Inquilino (stub — fase 2)
   │
   ▼
1. Saudação determinística? → responde e encerra
2. Extrator LLM → atualiza contexto da conversa
3. Detecta áudio → flag audioReceived
4. Persiste documentos recebidos (imagens) + OCR
5. Resolve imóvel em foco
6. Constrói LeadSnapshot + deriva estado FSM
7. Há mídia a enviar deterministicamente? → envia e encerra
8. Router LLM → escolhe agente (options/info/scheduling/collection)
9. Regras de estado → sobrescreve agente se necessário
10. Agent LLM → gera resposta
11. Persiste conversa + eventos
12. Envia resposta via WhatsApp
```

---

### FSM — Estados do Lead

O estado é derivado a cada mensagem com base no contexto acumulado. Nunca é armazenado diretamente — é recalculado.

| Estado | Quando ocorre |
|---|---|
| `lead.start` | Sem imóvel em foco, sem intenção clara |
| `lead.offer_options` | Lead quer ver opções disponíveis |
| `lead.property_info` | Lead tem imóvel em foco, fazendo perguntas |
| `lead.visit_scheduling` | Lead quer agendar visita |
| `lead.visit_requested` | Visita já solicitada, aguardando |
| `lead.objection_handling` | Lead com objeção identificada |
| `lead.post_visit_decision` | Lead já visitou, ainda não decidiu seguir |
| `lead.collect_application` | Coletando dados para análise (nome, renda, docs, moradores) |
| `lead.review_submitted` | Análise enviada, aguardando decisão |

---

### Agentes LLM

Cada mensagem passa por dois LLMs em sequência:

**1. Extrator** — structured output (Zod), sem texto livre. Extrai:
- `intent` (availability / visit / price_and_terms / location / property_details / restrictions / objection / application / options / unknown)
- `name`, `income`, `visited_property`, `document_choice`
- `wants_options`, `wants_schedule`, `wants_application`
- `residents[]` com nome, sexo, idade
- `property_reference` / `property_interest`

**2. Router** — escolhe um dos 4 agentes: `options`, `info`, `scheduling`, `collection`.

**3. Agente** — gera a resposta em linguagem natural:

| Agente | Responsabilidade |
|---|---|
| `options` | Apresenta imóveis disponíveis. Nunca inventa opções. |
| `info` | Responde dúvidas sobre imóvel, valor, regras, localização, restrições |
| `scheduling` | Conduz agendamento de visita. Não coleta renda nem documentos. |
| `collection` | Coleta nome → renda → escolha documental → documentos → moradores |

As regras de estado (`resolveTargetAgent`) sobrescrevem o router quando o estado já determina o agente correto (ex: `lead.offer_options` sempre vai para `options`).

---

### Comportamentos Determinísticos (sem LLM)

| Gatilho | Comportamento |
|---|---|
| "oi", "olá", "bom dia", "boa noite" | Resposta hardcoded imediata |
| "vi o anúncio", "peguei seu número" | Marca `visitedProperty = false` |
| "não visitei", "ainda não fui" | Marca `visitedProperty = false` |
| "detalhes", "exigências", "condições" | Força `intent = price_and_terms`, cancela visita |
| "não quero visitar" | Força `intent = property_details`, cancela visita |
| Mensagem de áudio | Flag `audioReceived = true` |
| Lead pede foto/vídeo e há mídia no banco | Envia diretamente via `sendMedia()`, sem passar pelo LLM |
| Lead pede link do anúncio (OLX etc.) | Envia URL como texto, sem passar pelo LLM |

---

### Coleta de Documentos

Quando lead está em `lead.collect_application`, o agente `collection` conduz:

1. Nome completo
2. Renda mensal
3. Escolha: CNH ou RG + CPF
4. Documentos:
   - CNH: 2 imagens (frente + verso)
   - RG + CPF: 3 imagens (RG frente + verso + CPF)
5. Moradores adicionais (nome, sexo, idade de cada um)

Cada imagem recebida é processada com **Google Cloud Vision OCR** e salva como `LeadDocument` com o texto extraído. O admin pode visualizar esses documentos e o texto no painel.

---

### Serviços

| Serviço | Descrição |
|---|---|
| `evolution.ts` | Wrapper da Evolution API — `sendText()`, `sendMedia()` |
| `catalog.ts` | Busca e cache de imóveis (Redis 10min). Resolve imóvel por externalId, bairro, nome ou aliases |
| `ocr.ts` | Google Cloud Vision — extrai texto de imagens de documentos |
| `storage.ts` | Upload de mídia para Supabase Storage |

---

### API Admin do Bot

Todos os endpoints em `/admin/...` exigem JWT válido do Supabase no header `Authorization`.

| Endpoint | Descrição |
|---|---|
| `PATCH /admin/leads/:id` | Atualiza nome, source ou propertyId do lead |
| `POST /admin/leads/:id/approve-kyc` | Aprova KYC → avança stage de `kyc_pending` → `kyc_approved` ou `residents_docs_complete`. Notifica lead via WhatsApp. |
| `POST /admin/leads/:id/generate-contract` | Avança stage `residents_docs_complete` → `contract_pending`. Informa dia de vencimento ao lead. |
| `POST /admin/leads/:id/confirm-payment` | Avança stage `contract_signed` → `converted` |
| `POST /admin/properties` | Cria imóvel. Gera externalId automático (IM-0001, IM-0002...) se não informado |
| `PATCH /admin/properties/:id` | Atualiza campos do imóvel. Invalida cache Redis. |
| `DELETE /admin/properties/:id` | Soft delete: `status=archived`, `active=false`. Invalida cache. |
| `POST /admin/properties/:id/media/signed-url` | Gera URL assinada para upload direto no Supabase Storage |
| `POST /admin/properties/:id/media` | Registra mídia após upload (foto/vídeo) |
| `DELETE /admin/properties/:id/media/:mediaId` | Remove mídia do Storage e do banco |
| `PUT /admin/properties/:id/invalidate-cache` | Força invalidação do cache Redis do imóvel |
| `POST /admin/tenants` | Cria inquilino. Muda status do imóvel para `rented`. Gera externalId (IQ-001...). |
| `POST /admin/rule-sets` | Cria conjunto de regras |
| `PATCH /admin/rule-sets/:id` | Atualiza nome/descrição/flags de propagação |
| `DELETE /admin/rule-sets/:id` | Exclui (falha se vinculado a imóveis) |
| `POST /admin/rule-sets/:id/policies` | Adiciona política ao conjunto |
| `PATCH /admin/rule-sets/:id/policies/:policyId` | Atualiza valor/escopo da política |
| `DELETE /admin/rule-sets/:id/policies/:policyId` | Remove política |
| `POST /admin/rule-sets/:id/properties` | Vincula imóvel ao conjunto de regras |
| `DELETE /admin/rule-sets/:id/properties/:propertyId` | Desvincula imóvel |
| `POST /admin/contract-templates` | Cria template (code auto: CT-AA-01, CT-AA-02...) |
| `PATCH /admin/contract-templates/:id` | Atualiza nome, body ou status (draft/published) |
| `DELETE /admin/contract-templates/:id` | Exclui (falha se `usageCount > 0`) |
| `POST /admin/contracts` | Cria contrato com código sequencial (CT-2024-0001...). Incrementa `usageCount` do template. Transação atômica. |
| `PATCH /admin/contracts/:id/status` | Atualiza status (active/terminated/renewal) |

---

## Módulo 2 — Painel Admin

### Autenticação

- Login via Google OAuth ou Magic Link (Supabase Auth)
- Guard em `__root.tsx`: redireciona para `/login` se sem sessão
- JWT anexado automaticamente em todas as chamadas para a API do bot

---

### Dashboard (`/`)

Visão geral do negócio com:
- **4 KPI Cards**: Taxa de ocupação · Leads ativos · KYC pendente · Em atraso
- **Ocupação por imóvel**: barras de progresso horizontais com status de cada unidade
- **Feed de atividade**: últimos 10 leads ordenados por `updatedAt`, com stage e horário relativo
- **Pagamentos futuros**: linhas estáticas de exemplo (dados fictícios por ora)

Queries com `refetchInterval: 5000ms`.

---

### Imóveis (`/properties`)

#### Lista (`/properties`)
- Toggle Grade/Lista (Segmented control)
- Filtros por status: Todos / Disponível / Inativo
- Busca/filtro client-side
- Card em grade: foto de capa (ou placeholder), status, endereço, valor
- Card em lista: versão compacta horizontal
- Botão "Novo imóvel" → navega para `/properties/new`

#### Detalhe (`/properties/:propertyId`)
- Galeria de fotos em grid CSS (`2fr 1fr 1fr`)
- SpecBar: Aluguel · Área · Quartos · Banheiros
- Abas: Detalhes / Regras / Galeria / Documentos / Histórico
- Sidebar: status de inquilino atual
- "Limpar cache" → `PUT /admin/properties/:id/invalidate-cache` + toast

#### Edição (`/properties/:propertyId/edit`)
- Formulário completo com todos os campos do imóvel
- Upload de mídia: solicita signed URL → upload direto no Supabase Storage → registra no banco
- Gerenciamento de fotos/vídeos existentes com remoção
- Salvar → `PATCH /admin/properties/:id`

#### Novo (`/properties/new`)
- Formulário em 2 colunas: seções de dados + sidebar sticky
- Header com 3 botões: Cancelar / Salvar rascunho / Publicar
- Campos: nome, endereço, bairro, aluguel, caução, quartos, banheiros, área, regras, descrição, etc.

---

### Leads (`/leads`)

#### Lista Kanban + Tabela (`/leads`)
- Toggle Kanban/Tabela (Segmented control)

**Kanban**: 6 colunas representando etapas do funil
| Coluna | Stages mapeados |
|---|---|
| Interesse | interest, property_info |
| Visitando | visit_scheduled, visited |
| Documentação | docs_pending |
| Análise KYC | kyc_pending |
| Contrato | residents_docs_complete, kyc_approved, contract_pending, contract_sent, contract_signed |
| Convertido | converted |

Cada card mostra: telefone (mono) · stage · tempo relativo desde `updatedAt`.

**Tabela**: telefone · stage · `updatedAt` · seta para detalhe.

#### Detalhe (`/leads/:leadId`)
- **Stepper** de 9 etapas com etapa atual destacada
- **Grid de documentos**: thumbnail + texto OCR extraído
- **Ações por stage**:
  - `kyc_pending` → botão "Aprovar KYC" → `POST /admin/leads/:id/approve-kyc` + toast
  - `residents_docs_complete` → botão "Gerar Contrato" → modal com campo `paymentDayOfMonth` → `POST /admin/leads/:id/generate-contract` + toast
  - `contract_signed` → botão "Confirmar Pagamento" → `POST /admin/leads/:id/confirm-payment` + toast

---

### Inquilinos (`/tenants`)

#### Lista (`/tenants`)
- Toggle Tabela/Cards
- Dados: nome · telefone · imóvel · pontuação · status (Ativo/Atrasado/Inadimplente)
- Status derivado de `onTimeRate` (>80% = ativo, >50% = atrasado, ≤50% = inadimplente)
- Clique → detalhe

#### Detalhe (`/tenants/:tenantId`)
- SpecBar: Pontuação · Pagamentos em dia · Vencimento · Imóvel
- Histórico de pagamentos (dados do banco)
- Sidebar: telefone, e-mail, CPF, lista de documentos

#### Novo Inquilino (`/tenants/new`)
Wizard de 4 etapas com stepper visual:
1. **Dados pessoais**: nome, CPF, e-mail
2. **Contato & endereço**: telefone, endereço
3. **Contrato**: imóvel (lista real do banco), data de início, data de fim, dia de vencimento
4. **Documentos**: upload (placeholder)

Validação por etapa. "Concluir" → `POST /admin/tenants`.

---

### Contratos (`/contracts`)

#### Lista (`/contracts`)
- Tabela: Nº (código mono) · Inquilino · Imóvel · Vigência · Valor · Status
- **Status efetivo calculado**: se `status=active` e faltam ≤60 dias para o fim, exibe `renewal` (Renovação/amarelo)
- Clique na linha → detalhe do contrato
- Botão download na linha (stub, "Em breve")
- Modal "Novo contrato":
  - Selects: Template (apenas publicados) · Inquilino · Imóvel
  - Datas: Início + Fim (opcional)
  - Aluguel mensal
  - Cria via `POST /admin/contracts`
  - Invalida query `['contracts']` no sucesso

#### Detalhe (`/contracts/:contractId`)
- 4 cards: Inquilino · Imóvel · Vigência · Aluguel
- **Corpo do contrato** renderizado com destaque em `{{variáveis}}` (span com fundo accent)
- Botão "Baixar PDF" (stub)
- Seta de voltar → `/contracts`

---

### Templates de Contrato (`/templates`)

Layout split: painel esquerdo (lista de templates) + painel direito (editor).

#### Lista de templates
- Cards com nome, código, status (Rascunho/Publicado), contagem de uso
- Botão "Novo template" → cria via `POST /admin/contract-templates`
- Botão excluir (apenas se `usageCount === 0`)

#### Editor de template (painel direito)
- Campo de nome (inline editável)
- **Editor de corpo**: `contentEditable` div com rendering rico
  - Variáveis (`{{nome}}`, `{{cpf}}` etc.) renderizadas como chips coloridos, não editáveis, deletáveis como bloco único
  - Chips de variáveis disponíveis na toolbar: clique insere no cursor atual
  - `onMouseDown: preventDefault()` nos chips de inserção para não perder o foco/cursor
  - `useEffect` atualiza `innerHTML` imperativamente ao trocar de template (não em foco)
- Botões: Cancelar · Salvar (PATCH body) · Publicar/Despublicar (PATCH status)
- Cada ação invalida query `['contract-templates']`

---

### Regras (`/rules`)

Sistema de conjuntos de regras (rule sets) aplicáveis a imóveis.

#### Lista de conjuntos
- Cards com: nome · descrição · contagem de políticas · contagem de imóveis vinculados
- Botão "Novo conjunto" → modal com nome e descrição
- Botão duplicar (copia nome + "-cópia")
- Botão excluir (falha se vinculado a imóveis)

#### Detalhe do conjunto (layout 2 colunas)
- **Coluna esquerda — Políticas**:
  - Tabela de políticas: nome · valor (yes/no/conditional) · escopo
  - Inline editing de valor e escopo
  - Botão "Nova política" → inline form
  - Delete por política
- **Coluna direita — Reuso**:
  - Lista de imóveis vinculados (pelo externalId)
  - Vincular/desvincular imóveis
  - Flags de propagação: Políticas · Cláusulas · Campos (toggles)

---

### Financeiro (`/finance`)

Visão financeira com:
- 4 KPI Cards (dados estáticos por ora)
- Tab bar: Visão geral / Receitas / Despesas / Relatórios
- Placeholder de gráfico de barras SVG
- Integração real pendente (Fase 3)

---

### Configurações (`/config`)

Layout: sidebar de navegação (220px) + painel de conteúdo.

**7 seções**:

| Seção | Conteúdo |
|---|---|
| **Workspace** | Campos somente leitura: nome da empresa, CNPJ, domínio, idioma, moeda, fuso horário (hardcoded por ora) |
| **Equipe & permissões** | Stub — aguardando multi-tenancy (Fase 3) |
| **Plano & cobrança** | Stub — "Em breve" |
| **Integrações** | URL da API Evolution + instância Evolution (campos de input, salvar → toast "Em breve") |
| **Notificações** | Toggle "Notificações ativas" + Toggle "Atualização automática" |
| **Aparência** | Toggle modo escuro (wired ao `useUiStore`) + Select de idioma |
| **Segurança** | Formulário de troca de senha (3 campos, sem ação real por ora) |

---

## Shell do Painel

### Sidebar (248px / rail 64px)
- Logo: quadrado escuro "KM" + texto "kit-manager" + subtítulo "Proprietário"
- Grupos de navegação:
  - **Principal**: Dashboard · Imóveis · Inquilinos · Leads (com badge de count em tempo real)
  - **Gestão**: Regras · Templates · Contratos · Financeiro
  - **Sistema**: Configurações
- Item ativo: `bg-accent-soft` + borda esquerda 3px laranja
- Collapse: botão circular 22px, estado em `useUiStore`
- Rail mode: apenas ícones + tooltip
- Footer: Avatar + nome + e-mail + botão logout

### Header (60px sticky)
- Fundo translúcido com blur (`backdrop-filter: blur(8px)`)
- Esquerda: hamburger (mobile) + título da página
- Centro: input de busca (UI only)
- Direita: toggle dark mode · sino · dropdown "Quick create"
  - Quick create: "Novo imóvel" → `/properties/new` · "Novo inquilino" → `/tenants/new`

---

## Banco de Dados — Modelos Principais

| Modelo | Descrição |
|---|---|
| `Owner` | Proprietário do sistema (único por instalação) |
| `Property` | Imóvel com ~30 campos: endereço, valor, caução, quartos, banheiros, regras, flags booleanos |
| `PropertyMedia` | Fotos e vídeos do imóvel (URLs Supabase Storage) |
| `Lead` | Pessoa que contactou via WhatsApp. Stage FSM manual (`interest` → `converted`) |
| `LeadDocument` | Documentos enviados pelo lead (imagem URL + texto OCR) |
| `Tenant` | Inquilino ativo. Vinculado a imóvel. Score e taxa de pontualidade. |
| `Payment` | Pagamentos de aluguel por mês (status, valor, tipo) |
| `RuleSet` | Conjunto nomeado de regras de locação |
| `RuleSetPolicy` | Política individual: nome + valor (yes/no/conditional) + escopo |
| `PropertyRuleSet` | Tabela de junção N:N entre imóveis e conjuntos de regras |
| `ContractTemplate` | Template de contrato com corpo em texto plano + `{{variáveis}}` |
| `Contract` | Contrato gerado: vincula template + inquilino + imóvel, com código sequencial (CT-2024-0001) |
| `Event` | Histórico de mensagens por chatId (para contexto do LLM) |
| `Conversation` | Estado persistido da conversa (LeadContext em JSON) |
| `ActivityLog` | Registro de ações do admin (quem fez o quê e quando) |

---

## Stack Técnica

### Bot (`apps/bot`)
- **Runtime**: Bun + TypeScript
- **Servidor**: Fastify
- **LLM**: OpenAI GPT-4o mini via LangChain JS (structured output com Zod)
- **Banco**: Supabase (PostgreSQL) via Prisma ORM
- **Cache**: Redis via ioredis
- **WhatsApp**: Evolution API (REST)
- **OCR**: Google Cloud Vision
- **Storage**: Supabase Storage

### Painel (`apps/web`)
- **Bundler**: Vite + React 19 + TypeScript strict
- **Roteamento**: TanStack Router (file-based, type-safe)
- **Data fetching**: TanStack Query (refetch interval 5s)
- **Estado global**: Zustand (UI state: darkMode, sidebarCollapsed)
- **Auth**: Supabase Auth
- **UI**: Tailwind CSS v4 + tailwind-variants + Lucide React
- **Toast**: Sonner
- **Deploy**: Vercel

### Infraestrutura local (Docker)
- Redis
- Evolution API
- Banco: Supabase cloud (não dockerizado)

---

## Roadmap de Fases

| Fase | Status | Escopo |
|---|---|---|
| **Fase 1** | ✅ Em produção | Bot WhatsApp completo — funil lead → análise → contrato |
| **Fase 2** | 🟡 Em desenvolvimento | Painel admin completo (imóveis, leads, inquilinos, contratos, regras, templates) |
| **Fase 3** | 🔲 Planejado | Multi-tenancy: organizations + members, financeiro real, geração de PDF, relatórios |

---

## Design System — Tokens Exatos

### Cores (Tailwind `@theme`)

```css
/* Backgrounds */
--color-surface: #F5F3F0          /* fundo base da página */
--color-surface-raised: #FFFFFF   /* cards, modais, painéis */

/* Brand — laranja */
--color-primary: #C2410C
--color-primary-hover: #9A3410
--color-primary-foreground: #FFFFFF
--color-accent-soft: #FDEAD9      /* fundo de item ativo no sidebar */
--color-accent-ink: #7C2D12       /* texto sobre accent-soft */

/* Neutros */
--color-muted: #F0ECE6
--color-border: #E7E2DC
--color-border-subtle: #EFEAE3

/* Texto */
--color-foreground: #2A2520
--color-foreground-subtle: #4A433C
--color-muted-foreground: #9A928A

/* Semântico */
--color-success: #2F7D4F
--color-warning: #B07B15
--color-destructive: #B5391F
--color-destructive-foreground: #FFFFFF
```

### Sombras (CSS custom properties, não Tailwind)

```css
--shadow-sm: 0 1px 0 rgba(42,37,32,.04), 0 1px 2px rgba(42,37,32,.03);
--shadow-md: 0 1px 0 rgba(42,37,32,.04), 0 4px 12px rgba(42,37,32,.06);
```

Usadas diretamente como `style={{ boxShadow: 'var(--shadow-sm)' }}`.

### Dark Mode

Ativado via `html[data-dark="true"]`. Controlado por `useUiStore.setDarkMode()` que escreve `document.documentElement.dataset.dark`.

```css
html[data-dark="true"] {
  --color-surface: #17140F;
  --color-surface-raised: #1F1B16;
  --color-foreground: #F5F1EA;
  --color-foreground-subtle: #C9C0B4;
  --color-muted-foreground: #8B8278;
  --color-border: #2A251F;
  --color-border-subtle: #231F1A;
  --color-muted: #2A251F;
  --color-accent-soft: #4A1F0B;
  --color-accent-ink: #FFD2B5;
  --shadow-sm: 0 1px 0 rgba(0,0,0,.2), 0 1px 2px rgba(0,0,0,.15);
  --shadow-md: 0 1px 0 rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.25);
}
```

### Tipografia

Fontes via Google Fonts (preconnect + stylesheet no `index.html`):
- **Inter** 400/500/600 → texto geral (`--font-sans`)
- **JetBrains Mono** 400/500 → códigos, números de contrato, telefones, valores monetários (`--font-mono`)

### Raios e espaçamentos recorrentes

| Elemento | Valor |
|---|---|
| Cards / painéis | `rounded-[10px]` |
| Modais | `rounded-[12px]` |
| Botões internos de nav | `rounded-[7px]` |
| Sidebar expandida | `248px` |
| Sidebar rail (colapsada) | `64px` |
| Header | `60px` height, sticky |
| Transição sidebar | `width 200ms` |

---

## Padrão de Componentes React

Regra aplicada a **todos** os componentes de `apps/web`:

### Obrigatório

```tsx
// 1. Named export (nunca export default)
export function Button(...) {}

// 2. Arquivo lowercase com hífens
// lead-card.tsx, contract-modal.tsx

// 3. Sem barrel files (index.ts) em pastas internas

// 4. tv() para variantes
export const buttonVariants = tv({
  base: 'inline-flex items-center ...',
  variants: { variant: { primary: '...', secondary: '...' }, size: { sm: '...', md: '...' } },
  defaultVariants: { variant: 'primary', size: 'md' },
})

// 5. twMerge sempre no className
className={twMerge(buttonVariants({ variant, size }), className)}

// 6. data-slot no elemento raiz
<div data-slot="card">

// 7. Estados via data-attributes (não classes condicionais)
data-disabled={disabled ? '' : undefined}
className="data-[disabled]:opacity-50"

// 8. Focus visible em todos os interativos
'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// 9. aria-label obrigatório em botões de ícone
<button aria-label="Fechar"><X className="size-4" /></button>

// 10. props spread no final
{...props}

// 11. Sem forwardRef (React 19 não precisa)
// 12. Sem React.FC, sem any
// 13. Cores sempre via CSS variables — nunca hardcoded (bg-blue-500)
```

### Tipos

```tsx
import type { ComponentProps } from 'react'
import type { VariantProps } from 'tailwind-variants'

export interface ButtonProps
  extends ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {}
```

---

## Prompts LLM Completos (Bot)

### Extrator (structured output)

```
Voce extrai apenas dados estruturados explicitamente presentes na mensagem do lead.

Regras:
- Identifique a intencao principal atual do lead.
- Nunca invente informacoes ausentes.
- Use o contexto atual para interpretar respostas curtas como "sim", "quero", "pode ser", "cpf".
- "CPF" ou "RG" como resposta na etapa de escolha documental significa "rg_cpf".
- Se a pessoa disser "ja visitei", "ja vi", "ja conheco", "eu ja fui" ou equivalente, visited_property = true.
- "Vi uma quitinete alugando", "vi o anuncio", "vi esse numero", "peguei seu numero na OLX" ou equivalente
  significa que a pessoa viu o anuncio/contato, nao que visitou o imovel.
- visited_property = true apenas se a pessoa deixar claro que ja visitou o imovel.
- visited_property = false se a pessoa disser que ainda nao visitou, pedir visita ou negociar horario de visita.
- name_is_explicit = true quando a pessoa informar o nome claramente, inclusive em resposta direta a um pedido de nome.
- income_is_explicit = true apenas quando a pessoa informar renda, salario ou valor recebido por mes.
- wants_options = true quando a pessoa pedir opcoes, disponibilidade geral ou disser que ainda nao sabe qual imovel quer.
- wants_schedule = true quando a pessoa pedir visita, negociar horario ou demonstrar intencao de agendar visita.
- wants_application = true quando a pessoa indicar que quer seguir com a locacao ou com a analise.
- Residents so devem ser preenchidos quando a pessoa informar nome, sexo e idade dos moradores.
- Para property_interest: se a mensagem pede informacao sobre um imovel sem mencionar qual, e houver apenas um
  imovel na lista de disponiveis, preencha com o externalId desse imovel.
```

Schema de saída (Zod):
- `intent`: `availability | visit | price_and_terms | location | property_details | restrictions | objection | application | options | unknown`
- `name`, `name_is_explicit`, `property_reference`, `property_interest`
- `visited_property` (boolean | null)
- `income`, `income_is_explicit`
- `document_choice`: `cnh | rg_cpf | null`
- `wants_options`, `wants_schedule`, `wants_application` (booleans)
- `residents[]`: `{ name, sex, age }`
- `residents_complete` (boolean | null)
- `wants_pause`, `wants_human` (booleans)

### Router

```
Voce e um roteador de atendimento para leads de locacao.

Escolha apenas um agente:
- options: quando a pessoa ainda nao sabe qual imovel quer, pede opcoes ou disponibilidade geral.
- info: quando a pessoa quer tirar duvidas, saber valor, regras, localizacao, detalhes do imovel ou tratar objecoes.
- scheduling: quando a pessoa quer visitar, negociar horario ou confirmar visita.
- collection: quando a pessoa ja visitou, quer seguir com a locacao e o assunto agora e coleta para analise.

Regras:
- Use o estado atual e os fatos do contexto.
- Se a pessoa ainda nao visitou, nunca escolha collection.
- Se o estado atual estiver em visita, prefira scheduling.
- Se o estado atual estiver em analise, prefira collection.
- Se houver um imovel em foco e a pessoa fizer uma pergunta sobre ele, prefira info.
- Se houver um imovel em foco travado, nao mande a conversa para options a menos que o usuario peca explicitamente outras opcoes.
- Respostas curtas como "sim", "quero", "pode ser" devem ser interpretadas com ajuda do contexto.
```

### Agente `options`

```
Voce cuida apenas de apresentar opcoes disponiveis de imoveis para leads.

Regras ABSOLUTAS:
- Mencione APENAS os imoveis que aparecem em "Imoveis disponiveis no banco" no contexto do sistema.
- Nunca invente, sugira ou mencione imoveis que nao estejam nessa lista.
- Se a lista tiver apenas um imovel, apresente somente esse.
- Se a lista estiver vazia, diga que nao ha imoveis disponiveis no momento.
- Se a pessoa apenas cumprimentar, responda somente com uma saudacao curta e educada.
- Se ja houver um imovel em foco, nao volte a listar tudo sem necessidade.
- Nao peca renda nem documentos.
- Nunca mencione URLs, links ou enderecos de midia no texto.
```

### Agente `info`

```
Voce cuida apenas de responder duvidas sobre o imovel e sobre as condicoes da locacao.

Regras:
- Responda primeiro a pergunta atual da pessoa.
- Use apenas os fatos do contexto do sistema.
- Se a pessoa apenas cumprimentar, responda somente com uma saudacao curta.
- Pode responder sobre disponibilidade, valor, localizacao, regras, restricoes, estado do imovel e objecoes.
- Pode informar documentos/requisitos antes da visita quando perguntado; nao peca que a pessoa envie.
- Nunca mencione URLs, links ou enderecos de midia no texto. O sistema envia midia automaticamente.
- Se houver video ou foto cadastrada, responda apenas "estou enviando agora". Nunca cole a URL.
- Nunca antecipe contrato, pagamento ou entrega das chaves antes da etapa correta.
- Nunca contradiga campos booleanos do contexto (ex: "Aceita animais: nao" → resposta deve ser nao).
- Se um fato nao estiver no contexto, diga que nao consta no sistema. Nunca use "geralmente" ou "normalmente".
- Nao peca renda nem documentos.
- Faca no maximo uma pergunta por vez.
```

### Agente `scheduling`

```
Voce cuida apenas do agendamento de visita.

Regras:
- Foque em visita, horario e disponibilidade.
- Se a pessoa disser que so quer ver o imovel, nao insista em renda nem documentos.
- Nao peca nome se a pessoa so pediu endereco, horario ou dia disponivel.
- Se a pessoa disser que ja visitou, nao tente reagendar; reconheca e devolva para o proximo passo.
- Nao entre em analise documental.
- Seja pratico, cordial e breve.
```

### Agente `collection`

```
Voce cuida apenas da coleta de dados para analise do lead apos a visita.

Regras:
- So deve atuar quando o lead ja visitou o imovel e quer seguir.
- Se o estado for decisao apos visita, confirme se a pessoa quer seguir e nao volte para visita.
- Nao fale que o proximo passo e contrato antes de confirmar que a documentacao foi enviada.
- Colete apenas o proximo item pendente informado no contexto.
- Ordem da analise: nome → renda → escolha documental → documentos → moradores (nome, sexo, idade)
- CNH: frente e verso (2 imagens). RG + CPF: RG frente e verso + CPF (3 imagens).
- "CPF" ou "RG" como escolha = rg_cpf.
- Se os dados estiverem completos, confirme que seguirao para analise.
- Faca no maximo uma pergunta por vez.
```

---

## Variáveis de Ambiente

### Bot (`apps/bot/.env`)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | Chave da OpenAI |
| `OPENAI_MODEL_NAME` | default `gpt-4o-mini` | Modelo usado nos agentes |
| `EVOLUTION_API_URL` | ✅ | URL da instância Evolution API |
| `EVOLUTION_INSTANCE_NAME` | ✅ | Nome da instância WhatsApp |
| `EVOLUTION_API_KEY` | ✅ | API key da Evolution API |
| `DATABASE_URL` | ✅ | Connection string PostgreSQL (Supabase pooler) |
| `DIRECT_URL` | ✅ | Connection string direta (sem pooler, para Prisma migrate) |
| `SUPABASE_URL` | ✅ | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | ✅ | Service role key do Supabase (para Storage admin) |
| `REDIS_URL` | default `redis://localhost:6379` | URL do Redis |
| `PORT` | default `3000` | Porta do servidor Fastify |
| `DEBOUNCE_SECONDS` | default `5` | Tempo de espera para agrupar mensagens |
| `BUFFER_TTL_SECONDS` | default `3600` | TTL do buffer no Redis |
| `LOG_PAYLOADS` | default `false` | Loga payloads de webhook (debug) |
| `GOOGLE_CREDENTIALS_JSON` | opcional | JSON da service account do Google Cloud Vision (OCR) |

### Painel (`apps/web/.env`)

| Variável | Descrição |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key do Supabase (auth client-side) |
| `VITE_BOT_API_URL` | URL base da API do bot (ex: `http://localhost:3000`) |

---

## Webhook — Formato Evolution API

O bot recebe eventos no `POST /webhook`. Apenas o evento `messages.upsert` é processado. Mensagens de grupo (`@g.us`) são ignoradas.

Tipos de mensagem suportados:

| Tipo | Campo no payload | Comportamento |
|---|---|---|
| Texto simples | `message.conversation` | Bufferizado + processado |
| Texto estendido | `message.extendedTextMessage.text` | Bufferizado + processado |
| Imagem | `message.imageMessage` + `base64` | Upload para Supabase Storage + OCR |
| Documento | `message.documentMessage` + `base64` | Upload para Supabase Storage + OCR |
| Áudio | `message.audioMessage` | Flag `audioReceived = true`, sem OCR |

---

## Buffer e Deduplicação de Mensagens

O bot implementa um sistema de buffer em Redis para:

1. **Agrupar** mensagens enviadas em rajada (ex: usuário manda 3 mensagens rápidas)
2. **Deduplica** por `messageId` para evitar processar o mesmo webhook duas vezes
3. **Upload imediato**: imagens/documentos sobem para o Supabase Storage antes de entrar no buffer, substituindo base64 por URL pública

Fluxo:
```
Webhook recebido → isDuplicate? → descarta
                 ↓ não
         bufferMessage/bufferMedia no Redis
                 ↓
         resetDebounce(DEBOUNCE_SECONDS)   ← reinicia timer a cada nova msg
                 ↓ timer dispara
         flushAndProcess → junta textos com ' '.join() → routeMessage
```

Keys Redis:
- `msg_buffer:{chatId}` — lista de textos acumulados
- `media_buffer:{chatId}` — lista de MediaItem JSON
- `{chatId}:dedupe:{messageId}` — flag de deduplicação (TTL = BUFFER_TTL_SECONDS)
- `property:{id}` — cache do imóvel (TTL 10min)
- `properties:available` — cache da lista de disponíveis (TTL 5min)

---

## Padrões de Código — Restrições

### O que nunca fazer

- `export default` em componentes React
- Cores hardcoded (`bg-blue-500`) — sempre CSS variables
- Barrel files (`index.ts`) em pastas internas de componentes
- `React.FC`, `forwardRef`, `any`
- Python (projeto é 100% TypeScript/JavaScript)
- Caminhos locais de arquivo — sempre URLs do Supabase Storage
- Versionar arquivos de mídia binários no Git
- Prompt monolítico para controlar tudo no bot (cada agente tem responsabilidade única)

### Padrões de dados no bot

- Lead vs. Inquilino decidido **pelo banco** (busca por `phone`) — nunca perguntado ao usuário
- Regras de negócio no **código** — linguagem natural no LLM
- LLM nunca improvisa regras, taxas, permissões ou disponibilidade de mídia
- Toda informação factual vem do banco via `catalog.ts`
- Imóvel em foco **travado** após identificado — não oferecer outro sem pedido explícito

### Convenções de código

- **bun** para tudo (não npm, não yarn)
- **Oxlint** para lint
- Commits descritivos no imperativo
- `bunx tsc --noEmit` antes de considerar qualquer implementação concluída

---

## Dependências do Painel (`apps/web`)

```json
{
  "@supabase/supabase-js": "^2",
  "@tanstack/react-query": "^5",
  "@tanstack/react-router": "^1",
  "axios": "^1",
  "lucide-react": "^1",
  "react": "^19",
  "recharts": "^3",
  "sonner": "^2",
  "tailwind-merge": "^3",
  "tailwind-variants": "^3",
  "tailwindcss": "^4",
  "zod": "^4",
  "zustand": "^5",
  "msw": "^2"
}
```
