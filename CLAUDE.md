# CLAUDE.md

## O que é este projeto

Reescrita do projeto existente de Python para JS/TS (React + Node) reutilizando/aperfeiçoando o que ja existe

Bot de WhatsApp para locação de imóveis, escrito em Node.js + TypeScript.
Este é a **fase 1** de um sistema maior. A fase 2 é um painel admin web onde o proprietário gerencia seus próprios imóveis.

O desenvolvedor principal é dev JS/TS (React + Node). Não usar Python. Não sugerir Python.

use o bun
use Oxlint para lint https://oxc.rs/docs/guide/usage/linter.html

Documentação de domínio: @docs/domain.md
Design do banco: @docs/schema.md

---

## Stack

- **Runtime:** Node.js 20+ com TypeScript
- **Servidor:** Fastify
- **LLM:** OpenAI GPT-4o mini via `openai` SDK
- **Banco:** Supabase (PostgreSQL gerenciado + Storage + Auth)
- **ORM:** Prisma apontando para o Supabase
- **Cache:** Redis via `ioredis`
- **Validação:** Zod
- **WhatsApp:** Evolution API (REST, container separado, porta 8080)
- **OCR:** Microsoft Azure Computer Vision (chamada HTTP)

---

## Arquitetura

```
src/
├── app.ts
├── config.ts                   # env vars validadas com Zod
├── webhooks/
│   └── evolution.ts            # recebe eventos da Evolution API
├── flows/
│   ├── router.ts               # decide tenant vs lead pelo banco
│   ├── lead/
│   │   ├── index.ts            # orquestrador
│   │   ├── context.ts          # snapshot factual do lead
│   │   ├── rules.ts            # resolve agente por estado
│   │   ├── intents.ts          # overrides determinísticos
│   │   └── media.ts            # detecta e envia mídia
│   └── tenant/
│       └── index.ts            # fase 2
├── agents/
│   └── lead.ts                 # chamada estruturada ao GPT-4o mini
├── services/
│   ├── evolution.ts            # wrapper Evolution API
│   ├── ocr.ts                  # Azure Computer Vision
│   └── catalog.ts              # consulta Supabase + cache Redis
└── db/
    ├── client.ts               # Prisma client
    └── schema.prisma
```

---

## Mídia e Storage

- Fotos e vídeos dos imóveis são armazenados no **Supabase Storage**
- O banco guarda apenas a URL pública gerada pelo Supabase
- O bot nunca usa caminhos locais para mídia — sempre URLs
- Não versionar arquivos de mídia binários no Git

---

## Catálogo de imóveis

- **Fonte de verdade:** Supabase (PostgreSQL)
- **Cache:** Redis com TTL (o bot nunca consulta o banco a cada mensagem)
- **Invalidação de cache:** quando um imóvel for atualizado, `DEL property:{id}` no Redis
- O `services/catalog.ts` é uma query ao banco com cache — não um seed hardcoded

---

## Regras invioláveis

1. **Tenant vs lead é decidido pelo banco.** Nunca perguntar ao usuário.
2. **Regras de negócio ficam no código.** Linguagem natural fica no LLM.
3. **O LLM nunca improvisa** regras, taxas, permissões, restrições ou disponibilidade de mídia.
4. **Toda informação factual vem do banco** via `catalog.ts`.
5. **Imóvel em foco travado** — não oferecer outro sem pedido explícito do lead.

---

## Comportamentos determinísticos (nunca passam pelo LLM)

| Gatilho | Ação |
|---|---|
| `oi`, `olá`, `bom dia`, `boa noite` | Saudação hardcoded |
| `vi uma quitinete alugando`, `vi o anúncio`, `peguei seu número` | Marcar como lead sem visita |
| `não quero visitar`, `quero detalhes`, `quais exigências`, `requisitos` | Manter em `property_info`, não insistir em visita |
| Pedido de vídeo com vídeo cadastrado no banco | Chamar `sendMedia()` direto, sem LLM |
| Mensagem de áudio | Responder que o bot não entende áudio |

---

## O que NÃO fazer

- ❌ Não usar prompt monolítico para controlar tudo
- ❌ Não insistir em visita quando o lead pede detalhes ou restrições
- ❌ Não pedir renda ou documentos antes da visita
- ❌ Não inventar regras sobre crianças, pets, moradores, entrada independente
- ❌ Não prometer envio de mídia no texto — enviar via integração ou não mencionar
- ❌ Não usar caminhos locais de arquivo — sempre URLs do Supabase Storage
- ❌ Não versionar arquivos de mídia binários no Git

---

## Infraestrutura (docker-compose)

Apenas dois serviços sobem localmente: `redis` e `evolution-api`.
O banco e o storage são gerenciados pelo Supabase cloud — sem container postgres local.

```bash
docker compose up -d --build bot   # rebuild do bot
docker compose logs -f bot         # logs
npx tsc --noEmit                   # checar TypeScript
npm test                           # rodar testes
```

---

## Fase 2 — Painel Admin (ainda não implementado)

O schema do banco deve ser desenhado desde o início para suportar:

- Múltiplos proprietários com autenticação (Supabase Auth)
- Múltiplos imóveis por proprietário
- Upload e gestão de fotos e vídeos via Supabase Storage
- Histórico de leads e contratos por imóvel

O repositório do admin (React + Node) pode ser separado ou monorepo — decisão pendente.

---

## Estado atual

- [ ] Estrutura inicial Node/TS
- [ ] docker-compose com `bot`, `redis` e `evolution-api`
- [ ] Schema Prisma + Supabase configurado
- [ ] Webhook da Evolution API
- [ ] Router tenant vs lead
- [ ] `catalog.ts` com cache Redis
- [ ] Comportamentos determinísticos
- [ ] Fluxo de lead pré-visita
- [ ] Agente LLM com GPT-4o mini
- [ ] Envio de mídia via Evolution API
- [ ] OCR Azure
- [ ] Fluxo de lead (documentação → contrato)
- [ ] Fluxo de tenant (fase 2)
- [ ] Painel admin (fase 2)
