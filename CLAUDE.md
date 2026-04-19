# CLAUDE.md — kit-manager

## O que é este projeto

Monorepo para sistema de locação de imóveis via WhatsApp.

- `apps/bot` — bot WhatsApp Node.js/TypeScript (Fase 1, em produção)
- `apps/web` — painel admin React (Fase 2, em desenvolvimento)
- `packages/types` — tipos TypeScript compartilhados

Dev principal: JS/TS (React + Node). **Não usar Python. Não sugerir Python.**

Documentação de domínio: `@docs/domain.md`
Design do banco: `@docs/schema.md`
Spec completo: `@SPEC.md`
Roadmap: `@ROADMAP.md`
Padrão de componentes: `.claude/skills/create-component/SKILL.md`

---

## Regras Gerais

- Usar **bun** (não npm, não yarn)
- Usar **Oxlint** para lint: https://oxc.rs/docs/guide/usage/linter.html
- Não versionar arquivos de mídia binários no Git
- Não usar caminhos locais — sempre URLs do Supabase Storage
- Não usar Python

---

## Monorepo

```
kit-manager/
├── apps/
│   ├── bot/         ← Fastify + Prisma + OpenAI + Evolution API
│   └── web/         ← Vite + React 19 + TanStack + shadcn/ui
├── packages/
│   └── types/       ← tipos compartilhados (@kit-manager/types)
├── package.json     ← bun workspaces
└── bun.lockb
```

```bash
bun install                          # instala todos os workspaces
cd apps/bot && bun run dev           # bot
cd apps/web && bun run dev           # admin
bunx tsc --noEmit                    # checar tipos (rodar em cada app)
```

---

## Stack — Bot (`apps/bot`)

| Concern | Choice |
|---|---|
| Runtime | Bun + TypeScript |
| Servidor | Fastify |
| LLM | OpenAI GPT-4o mini via `openai` SDK |
| Banco | Supabase (PostgreSQL + Storage) |
| ORM | Prisma |
| Cache | Redis via `ioredis` |
| Validação | Zod |
| WhatsApp | Evolution API (REST, porta 8080) |
| OCR | Google Cloud Vision (service account JSON em `GOOGLE_CREDENTIALS_JSON`) |

### Arquitetura (`apps/bot/src`)

```
src/
├── app.ts
├── config.ts                   # env vars com Zod
├── webhooks/
│   └── evolution.ts            # recebe eventos Evolution API
├── flows/
│   ├── router.ts               # tenant vs lead (pelo banco)
│   ├── lead/
│   │   ├── index.ts            # orquestrador
│   │   ├── context.ts          # snapshot + FSM de estados
│   │   ├── rules.ts            # resolve agente por estado
│   │   ├── intents.ts          # overrides determinísticos
│   │   └── media.ts            # detecta e envia mídia
│   └── tenant/
│       └── index.ts            # stub fase 2
├── agents/
│   └── lead.ts                 # GPT-4o mini structured output
├── services/
│   ├── evolution.ts            # wrapper Evolution API
│   ├── ocr.ts                  # Google Cloud Vision
│   ├── catalog.ts              # imóveis com cache Redis
│   └── storage.ts              # Supabase Storage upload
└── db/
    ├── client.ts               # Prisma singleton
    └── schema.prisma
```

### Docker (local)
Sobem localmente: `redis` + `evolution-api`. Banco/storage: Supabase cloud.
```bash
docker compose up -d --build bot
docker compose logs -f bot
```

### Regras invioláveis do bot
1. **Tenant vs lead decidido pelo banco** — nunca perguntar ao usuário
2. **Regras de negócio no código** — linguagem natural no LLM
3. **LLM nunca improvisa** regras, taxas, permissões ou disponibilidade de mídia
4. **Toda informação factual vem do banco** via `catalog.ts`
5. **Imóvel em foco travado** — não oferecer outro sem pedido explícito

### Comportamentos determinísticos (nunca passam pelo LLM)
| Gatilho | Ação |
|---|---|
| `oi`, `olá`, `bom dia`, `boa noite` | Saudação hardcoded |
| `vi o anúncio`, `peguei seu número` | Marcar lead sem visita |
| `não quero visitar`, `quais exigências` | Manter em `property_info` |
| Pedido de vídeo com vídeo no banco | `sendMedia()` direto |
| Mensagem de áudio | Resposta hardcoded |

---

## Stack — Admin (`apps/web`)

| Concern | Choice |
|---|---|
| Bundler | Vite |
| Framework | React 19 + TypeScript strict |
| Routing | TanStack Router (file-based, full type safety) |
| Data fetching | TanStack Query (`refetchInterval: 5000` por ora) |
| Global state | Zustand (sessão + UI state only) |
| Auth | Supabase Auth — Google OAuth + Magic Link |
| UI primitives | shadcn/ui (Radix UI) |
| Estilização | Tailwind CSS v4 |
| Variantes | tailwind-variants (`tv()`) |
| Merge de classes | tailwind-merge (`twMerge()`) |
| Ícones | Lucide React |
| Mocking | MSW (Mock Service Worker) — dev only |
| Deploy | Vercel |

### Arquitetura de dados
- **Leituras** → `supabase-js` direto (RLS filtra por owner automaticamente)
- **Ações** → endpoints Fastify do bot (`/admin/...`) com Supabase JWT no header
- **Endpoint não pronto** → MSW handler (remover quando real endpoint existir)

### Estrutura (`apps/web/src`)

```
src/
├── routes/
│   ├── __root.tsx               ← layout raiz + auth guard
│   ├── _auth/login.tsx
│   └── _dashboard/
│       ├── index.tsx            ← KPIs + feed de atividade
│       ├── leads/
│       │   ├── index.tsx        ← tabela de leads
│       │   └── $leadId.tsx      ← detalhe + ações por estado
│       ├── properties/
│       │   ├── index.tsx        ← grid de imóveis
│       │   └── $propertyId.tsx  ← edição + media manager
│       └── tenants/index.tsx
├── components/
│   ├── ui/                      ← primitivos shadcn/ui
│   └── [feature]/               ← componentes por feature
├── lib/
│   ├── supabase.ts
│   ├── api.ts                   ← fetch wrappers tipados (bot endpoints)
│   └── utils.ts                 ← cn(), formatters
├── hooks/
├── store/                       ← Zustand
└── mocks/
    └── handlers.ts              ← MSW handlers
```

### Componentes

**Todo componente segue `COMPONENT_PATTERN.md`.** Ao criar qualquer componente React, usar a skill `create-component` (`.claude/skills/create-component/`).

Resumo das regras:
- Named export — nunca `export default`
- Arquivo: lowercase com hífens (`lead-card.tsx`)
- Sem barrel files dentro de pastas de componentes
- `tv()` para variantes, `twMerge()` para merge de classes
- `data-slot="nome"` no elemento raiz
- Estados via `data-[state]:` attributes
- Cores via CSS variables — sem valores hardcoded
- `aria-label` em botões de ícone
- `{...props}` no final

**Shadcn MCP disponível:** https://ui.shadcn.com/docs/mcp

---

## O que NÃO fazer

- ❌ Python
- ❌ `export default` em componentes React
- ❌ Cores hardcoded em componentes (`bg-blue-500`) — usar CSS variables
- ❌ Barrel files (`index.ts`) em pastas internas
- ❌ Prompt monolítico para controlar tudo no bot
- ❌ Insistir em visita quando lead pede detalhes
- ❌ Pedir renda/docs antes da visita
- ❌ Inventar regras sobre pets, moradores, entrada
- ❌ Prometer mídia em texto — enviar via integração
- ❌ Caminhos locais de arquivo — sempre URLs Supabase
- ❌ Mídia binária versionada no Git
